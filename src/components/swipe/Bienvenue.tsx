"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowRight,
  Layers,
  Loader2,
  Sparkles,
  Star,
  Swords,
} from "lucide-react";
import { useEtatCompte } from "@/components/CompteBouton";
import { HeroLayout } from "@/components/layouts";
import { Button } from "@/components/ui/Button";
import {
  lireEtatVisite,
  oublierEtatVisite,
} from "@/components/visite/VisiteEtat";
import { verserVisite } from "@/components/visite/verser";
import {
  ajouterAuBout,
  apresReponse,
  carteDepuisDecouverte,
  carteDepuisVitrine,
  composerPaquet,
  insererDansFile,
  OBJECTIF_NOTES,
  OBJECTIF_TITRES,
  pourLaVitrine,
  type CarteSwipe,
  type Progression,
  type ReponseSwipe,
} from "@/lib/demarrage";
import type { DiscoveredItem } from "@/lib/discoveryService";
import type { ShowcaseTitle } from "@/lib/showcase";
import { aGarder } from "@/lib/visite";
import type { Vitrine } from "@/lib/vitrine";
import { DepartageEtape, NoteEtape, RecosEtape } from "./Etapes";
import { ProgressionBienvenue, type EtapeProgres } from "./Progression";
import { SwipeDeck, useFiches } from "./SwipeDeck";

// Bienvenue — spec: specs/bienvenue-v1.md. Le parcours d'un nouveau venu, en quatre étapes (FR-14) : balayer,
// noter, départager, ses recommandations. La page tient dans l'écran (FR-15). Le balayage : des cartes qui
// remplissent la bibliothèque (→ dans ta pile, ↑ vu) et apprennent tes goûts (← écarté pour de bon),
// avec la jauge de démarrage en haut. Chaque geste s'enregistre aussitôt, l'un après l'autre (en ligne, le
// premier ouvre la session invitée) ; « Annuler » défait exactement le dernier. Un compte qui a déjà des
// titres bien notés reçoit aussi des cartes plus personnelles (la découverte) glissées dans la file. Ce qu'on
// a fait sans compte (visite, page d'arrivée) entre dans la bibliothèque à l'arrivée (FR-13).

const JSON_HEADERS = { "Content-Type": "application/json" };
/** Après combien de réponses on redemande des cartes personnelles. */
const RELANCE = 8;
/** Sous ce nombre de cartes, la page suivante est demandée : le paquet ne s'arrête pas (FR-10). */
const RESERVE = 8;
/** À ce nombre de titres, un invité se voit proposer de garder sa bibliothèque (e-mail et mot de passe). */
const GARDER_A = 10;
/** Assez de duels pour sentir le classement se préciser. */
const DUELS_OBJECTIF = 5;

/**
 * Le parcours unique (FR-14, « Tester » et « Fais le tour » fusionnés) : balayer remplit la bibliothèque et
 * ouvre la suite. Chaque étape : un titre, pourquoi en une ligne, le geste.
 */
const ETAPES = [
  {
    id: "balaie",
    nom: "Balaie",
    titre: "Ça te tente ?",
    pourquoi:
      "À droite si ça te tente, à gauche si ce n'est pas pour toi, vers le haut si tu l'as vu. Ta bibliothèque se remplit, et tout le reste s'ouvre.",
  },
  {
    id: "note",
    nom: "Note",
    titre: "Note ce que tu as vu.",
    pourquoi:
      "0 pour 💩, de 1 à 5 étoiles, d'une touche. Chaque note apprend tes goûts : dix suffisent pour tes recommandations.",
  },
  {
    id: "departage",
    nom: "Départage",
    titre: "Deux titres, un seul passe devant.",
    pourquoi:
      "Entre deux titres que tu as notés, garde ton préféré : ton classement se précise duel après duel.",
  },
  {
    id: "recos",
    nom: "Tes recos",
    titre: "Ce qui devrait te plaire.",
    pourquoi:
      "Ta pile, rangée dans l'ordre de tes goûts. Et la suite t'attend dans Catalog : Ce soir, ton classement, tes listes, les sorties.",
  },
] as const;
type EtapeId = (typeof ETAPES)[number]["id"];

type Entree = {
  carte: CarteSwipe;
  reponse: ReponseSwipe;
  annulation: Promise<unknown>;
};

/** Enregistre un geste ; rend de quoi le défaire (`POST /api/triage/undo`), ou null. */
async function ecrire(
  carte: CarteSwipe,
  reponse: ReponseSwipe,
): Promise<unknown> {
  if (reponse.kind === "vu") {
    const res = await fetch("/api/items", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        tmdbId: carte.tmdbId,
        type: carte.type,
        source: "triage",
      }),
    });
    const corps = (await res.json().catch(() => null)) as {
      item?: { id: number };
    } | null;
    const id = corps?.item?.id;
    if (!res.ok || typeof id !== "number") return null;
    await fetch(`/api/items/${id}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ watchStatus: "Watched" }),
    });
    return { kind: "remove", itemId: id };
  }
  const res = await fetch("/api/triage/answer", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      card: { family: "unseen", tmdbId: carte.tmdbId, mediaType: carte.type },
      answer: reponse.kind === "envie" ? "like" : "dislike",
    }),
  });
  const corps = (await res.json().catch(() => null)) as {
    undo?: unknown;
  } | null;
  return res.ok ? (corps?.undo ?? null) : null;
}

function phrase(carte: CarteSwipe, r: ReponseSwipe): string {
  if (r.kind === "envie") return `« ${carte.name} » rejoint ta pile.`;
  if (r.kind === "non") return `« ${carte.name} » ne te sera plus proposé.`;
  return `« ${carte.name} » : déjà vu.`;
}

export function Bienvenue({
  vitrine,
  depart,
  importer,
}: {
  vitrine: Vitrine;
  depart: Progression;
  importer: boolean;
}) {
  const [file, setFile] = useState<CarteSwipe[]>(() => composerPaquet(vitrine));
  const [progression, setProgression] = useState<Progression>(depart);
  const [historique, setHistorique] = useState<Entree[]>([]);
  const [retour, setRetour] = useState<ReactNode>(null);
  const [cherche, setCherche] = useState(false);
  const [suite, setSuite] = useState(false);
  const fiches = useFiches(file);
  const compte = useEtatCompte();
  // Les écritures passent l'une après l'autre ; les clés déjà répondues ne reviennent pas.
  const chaine = useRef<Promise<unknown>>(Promise.resolve());
  const repondues = useRef(new Set<string>());
  const reponses = useRef(0);
  const derniereRelance = useRef<number | null>(null);
  const page = useRef(1);
  const encore = useRef(true);
  const enCharge = useRef(false);

  // La suite du paquet : des titres très vus et populaires, page après page, quand la vitrine s'épuise.
  const chargerSuite = useCallback(async () => {
    if (enCharge.current || !encore.current) return;
    enCharge.current = true;
    setSuite(true);
    try {
      const res = await fetch(`/api/welcome/cards?page=${page.current}`);
      const corps = (await res.json().catch(() => null)) as {
        items?: ShowcaseTitle[];
        more?: boolean;
      } | null;
      page.current += 1;
      if (!res.ok || !corps) return;
      encore.current = corps.more !== false;
      const nouvelles = (corps.items ?? []).filter(pourLaVitrine).map(carteDepuisVitrine);
      setFile((f) => ajouterAuBout(f, nouvelles, repondues.current));
    } catch {
      // Réseau : on réessaiera au prochain geste.
    } finally {
      enCharge.current = false;
      setSuite(false);
    }
  }, []);

  // Une vitrine maigre (TMDB lent, bibliothèque qui en couvre déjà une partie) : la suite tout de suite.
  useEffect(() => {
    if (composerPaquet(vitrine).length <= RESERVE) void chargerSuite();
  }, [vitrine, chargerSuite]);

  const enrichir = useCallback(async () => {
    if (
      derniereRelance.current !== null &&
      reponses.current - derniereRelance.current < RELANCE
    )
      return;
    derniereRelance.current = reponses.current;
    setCherche(true);
    try {
      await chaine.current;
      const res = await fetch("/api/recommendations/discover?limit=24");
      const corps = (await res.json().catch(() => null)) as {
        items?: DiscoveredItem[];
      } | null;
      const nouvelles = (corps?.items ?? []).map(carteDepuisDecouverte);
      if (nouvelles.length > 0)
        setFile((f) => insererDansFile(f, nouvelles, repondues.current));
    } catch {
      // Pas de découverte (réseau, pas encore de titre bien noté) : la vitrine continue.
    } finally {
      setCherche(false);
    }
  }, []);

  // Un compte qui a déjà des titres : des cartes à son goût dès l'arrivée.
  useEffect(() => {
    if (depart.notes > 0) void enrichir();
  }, [depart.notes, enrichir]);

  // Ce qu'il a fait sans compte le suit (FR-13) : les cartes déjà répondues ne reviennent pas ; ses titres,
  // ses notes et ses duels entrent dans la bibliothèque (un invité, ou un compte encore vide). Une seule fois.
  const importe = useRef(false);
  useEffect(() => {
    if (importe.current) return;
    importe.current = true;
    const etat = lireEtatVisite();
    const deja = Object.keys(etat.tri);
    if (deja.length === 0) return;
    for (const cle of deja) repondues.current.add(cle);
    setFile((f) => f.filter((c) => !repondues.current.has(c.cle)));
    if (!importer || aGarder(etat).titres.length === 0) return;
    setRetour("Je range tes titres d'avant…");
    chaine.current = chaine.current
      .then(async () => {
        const verse = await verserVisite(etat);
        oublierEtatVisite();
        setProgression((p) => ({
          titres: p.titres + verse.titres,
          notes: p.notes + verse.notes,
          vusSansNote: p.vusSansNote + verse.vusSansNote,
        }));
        setRetour(
          verse.titres > 0
            ? `Tes ${verse.titres} titre${verse.titres > 1 ? "s" : ""} d'avant ${verse.titres > 1 ? "sont" : "est"} dans ta bibliothèque.`
            : null,
        );
      })
      .catch(() => setRetour(null));
  }, [importer]);

  const repondre = useCallback(
    (carte: CarteSwipe, reponse: ReponseSwipe) => {
      setFile((f) => f.filter((c) => c.cle !== carte.cle));
      repondues.current.add(carte.cle);
      reponses.current += 1;
      setProgression((p) => apresReponse(p, reponse));
      // Dix titres pour un invité : le moment de lui proposer de garder sa bibliothèque (rétention, audit
      // 2026-11-09), dans la ligne des messages, sans rien pousser hors de l'écran.
      const avant = progression.titres;
      const apres = avant + (reponse.kind === "non" ? 0 : 1);
      if (importer && avant < GARDER_A && apres >= GARDER_A)
        setRetour(
          <>
            {`${GARDER_A} titres déjà. `}
            <Link href="/connexion?retour=/bienvenue" className="text-foreground underline decoration-divider underline-offset-4 hover:decoration-current">
              Garde ta bibliothèque
            </Link>
          </>
        );
      else setRetour(phrase(carte, reponse));
      const annulation = (chaine.current = chaine.current
        .then(() => ecrire(carte, reponse))
        .catch(() => null));
      setHistorique((h) => [...h.slice(-29), { carte, reponse, annulation }]);
      // La découverte part des titres vus bien notés : seulement pour un compte qui en a.
      if (depart.notes > 0) void enrichir();
      if (file.length - 1 <= RESERVE) void chargerSuite();
    },
    [enrichir, chargerSuite, file.length, depart.notes, importer, progression.titres],
  );

  const annuler = useCallback(() => {
    const dernier = historique.at(-1);
    if (!dernier) return;
    setHistorique((h) => h.slice(0, -1));
    setFile((f) => [
      dernier.carte,
      ...f.filter((c) => c.cle !== dernier.carte.cle),
    ]);
    repondues.current.delete(dernier.carte.cle);
    setProgression((p) => apresReponse(p, dernier.reponse, -1));
    setRetour(`« ${dernier.carte.name} » : annulé.`);
    chaine.current = chaine.current
      .then(async () => {
        const undo = await dernier.annulation;
        if (!undo) return;
        await fetch("/api/triage/undo", {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ undo }),
        });
      })
      .catch(() => null);
  }, [historique]);

  const anonyme = compte?.connecte === true && compte.anonyme;

  // ---------- les étapes (FR-14) ----------
  const params = useSearchParams();
  const etape: EtapeId = (ETAPES.find((e) => e.id === params.get("etape"))
    ?.id ?? "balaie") as EtapeId;
  const aller = useCallback((vers: string) => {
    window.history.pushState(
      null,
      "",
      vers === "balaie" ? "/bienvenue" : `/bienvenue?etape=${vers}`,
    );
  }, []);
  const [duels, setDuels] = useState(0);
  const { titres, notes, vusSansNote } = progression;
  const progres: EtapeProgres[] = [
    {
      id: "balaie",
      nom: "Balaie",
      icone: Layers,
      n: titres,
      max: OBJECTIF_TITRES,
      unite: "titres",
      verrou: null,
    },
    {
      id: "note",
      nom: "Note",
      icone: Star,
      n: notes,
      max: OBJECTIF_NOTES,
      unite: "notes",
      verrou:
        notes === 0 && vusSansNote === 0 ? "s'ouvre avec « Déjà vu »" : null,
    },
    {
      id: "departage",
      nom: "Départage",
      icone: Swords,
      n: duels,
      max: DUELS_OBJECTIF,
      unite: "duels",
      verrou: notes < 2 ? "il faut 2 titres notés" : null,
    },
    {
      id: "recos",
      nom: "Tes recos",
      icone: Sparkles,
      n: notes,
      max: OBJECTIF_NOTES,
      unite: "notes",
      verrou:
        notes < OBJECTIF_NOTES
          ? `encore ${OBJECTIF_NOTES - notes} notes`
          : null,
    },
  ];
  const ici = progres.find((e) => e.id === etape) ?? progres[0];
  const suivante = ETAPES[ETAPES.findIndex((e) => e.id === etape) + 1];
  const texte = ETAPES.find((e) => e.id === etape) ?? ETAPES[0];

  // L'étape suivante, en bout de ligne : pleine quand l'objectif de l'étape est atteint.
  const pied = suivante ? (
    <Button
      size="sm"
      variant={ici.n >= ici.max ? "primary" : "secondary"}
      onClick={() => aller(suivante.id)}
    >
      {suivante.nom}
      <ArrowRight size={14} aria-hidden="true" />
    </Button>
  ) : notes >= OBJECTIF_NOTES ? (
    <>
      {anonyme && (
        <Button size="sm" href="/connexion?retour=/" variant="ghost">
          Garder mon compte
        </Button>
      )}
      <Button
        size="sm"
        variant="primary"
        onClick={() => {
          // Un vrai rechargement : la découverte est finie, la barre du haut devient celle de l'application.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- rechargement complet voulu
          window.location.href = "/";
        }}
      >
        Ouvrir Catalog
      </Button>
    </>
  ) : null;

  const fin =
    cherche || suite ? (
      <p className="flex items-center gap-2 text-sm text-muted">
        <Loader2 size={16} aria-hidden="true" className="animate-spin" />
        Je cherche des titres à ton goût…
      </p>
    ) : (
      <>
        <p className="text-subheading text-foreground">
          Tu as fait le tour de ces titres.
        </p>
        <p className="text-sm text-muted">
          Note ce que tu as vu : tes recommandations partent de là.
        </p>
        <Button size="sm" variant="primary" onClick={() => aller("note")}>
          Noter mes titres vus
        </Button>
      </>
    );

  return (
    <HeroLayout
      stage
      plein
      hero={
        <>
          <ProgressionBienvenue
            etapes={progres}
            courante={etape}
            onAller={aller}
          />
          <h1 className="mt-1 text-balance text-subheading text-foreground sm:text-heading-sm">
            {texte.titre}
          </h1>
          <p className="line-clamp-2 max-w-xl text-balance text-sm text-muted">
            {texte.pourquoi}
          </p>
        </>
      }
    >
      {etape === "balaie" && (
        <SwipeDeck
          cartes={file}
          fiches={fiches}
          onRepondre={repondre}
          onAnnuler={annuler}
          peutAnnuler={historique.length > 0}
          retour={retour}
          fin={fin}
          pied={pied}
        />
      )}
      {etape === "note" && (
        <NoteEtape
          onNote={() =>
            setProgression((p) => ({
              ...p,
              notes: p.notes + 1,
              vusSansNote: Math.max(0, p.vusSansNote - 1),
            }))
          }
          versBalaie={() => aller("balaie")}
          pied={pied}
        />
      )}
      {etape === "departage" && (
        <DepartageEtape
          onDuel={() => setDuels((d) => d + 1)}
          versNote={() => aller("note")}
          pied={pied}
        />
      )}
      {etape === "recos" && (
        <RecosEtape versNote={() => aller("note")} pied={pied} />
      )}
    </HeroLayout>
  );
}
