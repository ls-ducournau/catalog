"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useEtatCompte } from "@/components/CompteBouton";
import { HeroLayout } from "@/components/layouts";
import { ratedAs } from "@/components/RatingKeys";
import { Button } from "@/components/ui/Button";
import {
  ajouterAuBout,
  apresReponse,
  carteDepuisDecouverte,
  carteDepuisVitrine,
  composerPaquet,
  estPrete,
  insererDansFile,
  type CarteSwipe,
  type Progression,
  type ReponseSwipe,
} from "@/lib/demarrage";
import type { DiscoveredItem } from "@/lib/discoveryService";
import type { ShowcaseTitle } from "@/lib/showcase";
import type { Vitrine } from "@/lib/vitrine";
import { JaugeDemarrage } from "./Jauge";
import { SwipeDeck, useFiches } from "./SwipeDeck";

// Bienvenue — spec: specs/bienvenue-v1.md. Le premier écran d'un compte : des cartes à balayer qui
// remplissent la bibliothèque (→ dans ta pile, ↑ vu et noté) et apprennent tes goûts (← écarté pour de bon),
// avec la jauge de démarrage en haut. Chaque geste s'enregistre aussitôt, l'un après l'autre (en ligne, le
// premier ouvre la session invitée) ; « Annuler » défait exactement le dernier. Dès tes premiers titres bien
// notés, la découverte glisse des cartes plus personnelles dans la file.

const JSON_HEADERS = { "Content-Type": "application/json" };
/** Après combien de réponses on redemande des cartes personnelles. */
const RELANCE = 8;
/** Sous ce nombre de cartes, la page suivante est demandée : le paquet ne s'arrête pas (FR-10). */
const RESERVE = 8;

type Entree = { carte: CarteSwipe; reponse: ReponseSwipe; annulation: Promise<unknown> };

/** Enregistre un geste ; rend de quoi le défaire (`POST /api/triage/undo`), ou null. */
async function ecrire(carte: CarteSwipe, reponse: ReponseSwipe): Promise<unknown> {
  if (reponse.kind === "vu") {
    const res = await fetch("/api/items", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ tmdbId: carte.tmdbId, type: carte.type, source: "triage" }),
    });
    const corps = (await res.json().catch(() => null)) as { item?: { id: number } } | null;
    const id = corps?.item?.id;
    if (!res.ok || typeof id !== "number") return null;
    await fetch(`/api/items/${id}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify(
        reponse.note === null ? { watchStatus: "Watched" } : { watchStatus: "Watched", rating: reponse.note === 0 ? "💩" : "⭐️".repeat(reponse.note) }
      ),
    });
    return { kind: "remove", itemId: id };
  }
  const res = await fetch("/api/triage/answer", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ card: { family: "unseen", tmdbId: carte.tmdbId, mediaType: carte.type }, answer: reponse.kind === "envie" ? "like" : "dislike" }),
  });
  const corps = (await res.json().catch(() => null)) as { undo?: unknown } | null;
  return res.ok ? (corps?.undo ?? null) : null;
}

function phrase(carte: CarteSwipe, r: ReponseSwipe): string {
  if (r.kind === "envie") return `« ${carte.name} » rejoint ta pile.`;
  if (r.kind === "non") return `« ${carte.name} » ne te sera plus proposé.`;
  return r.note === null ? `« ${carte.name} » : vu.` : `« ${carte.name} » ${ratedAs(r.note)}.`;
}

export function Bienvenue({ vitrine, depart }: { vitrine: Vitrine; depart: Progression }) {
  const [file, setFile] = useState<CarteSwipe[]>(() => composerPaquet(vitrine));
  const [progression, setProgression] = useState<Progression>(depart);
  const [historique, setHistorique] = useState<Entree[]>([]);
  const [retour, setRetour] = useState<string | null>(null);
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
      const corps = (await res.json().catch(() => null)) as { items?: ShowcaseTitle[]; more?: boolean } | null;
      page.current += 1;
      if (!res.ok || !corps) return;
      encore.current = corps.more !== false;
      const nouvelles = (corps.items ?? []).map(carteDepuisVitrine);
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
    if (derniereRelance.current !== null && reponses.current - derniereRelance.current < RELANCE) return;
    derniereRelance.current = reponses.current;
    setCherche(true);
    try {
      await chaine.current;
      const res = await fetch("/api/recommendations/discover?limit=24");
      const corps = (await res.json().catch(() => null)) as { items?: DiscoveredItem[] } | null;
      const nouvelles = (corps?.items ?? []).map(carteDepuisDecouverte);
      if (nouvelles.length > 0) setFile((f) => insererDansFile(f, nouvelles, repondues.current));
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

  const repondre = useCallback(
    (carte: CarteSwipe, reponse: ReponseSwipe) => {
      setFile((f) => f.filter((c) => c.cle !== carte.cle));
      repondues.current.add(carte.cle);
      reponses.current += 1;
      setProgression((p) => apresReponse(p, reponse));
      setRetour(phrase(carte, reponse));
      const annulation = (chaine.current = chaine.current.then(() => ecrire(carte, reponse)).catch(() => null));
      setHistorique((h) => [...h.slice(-29), { carte, reponse, annulation }]);
      const aime = reponse.kind === "vu" && reponse.note !== null && reponse.note >= 4;
      if (aime) void enrichir();
      if (file.length - 1 <= RESERVE) void chargerSuite();
    },
    [enrichir, chargerSuite, file.length]
  );

  const annuler = useCallback(() => {
    const dernier = historique.at(-1);
    if (!dernier) return;
    setHistorique((h) => h.slice(0, -1));
    setFile((f) => [dernier.carte, ...f.filter((c) => c.cle !== dernier.carte.cle)]);
    repondues.current.delete(dernier.carte.cle);
    setProgression((p) => apresReponse(p, dernier.reponse, -1));
    setRetour(`« ${dernier.carte.name} » : annulé.`);
    chaine.current = chaine.current
      .then(async () => {
        const undo = await dernier.annulation;
        if (!undo) return;
        await fetch("/api/triage/undo", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ undo }) });
      })
      .catch(() => null);
  }, [historique]);

  const prete = estPrete(progression);
  const anonyme = compte?.connecte === true && compte.anonyme;

  const fin = cherche || suite ? (
    <p className="flex items-center gap-2 text-sm text-muted">
      <Loader2 size={16} aria-hidden="true" className="animate-spin" />
      Je cherche des titres à ton goût…
    </p>
  ) : (
    <>
      <p className="text-subheading text-foreground">Tu as fait le tour de ces titres.</p>
      <p className="text-sm text-muted">Reviens plus tard : de nouveaux titres arrivent chaque semaine.</p>
      <Button href="/" variant="primary">
        Aller à l&apos;accueil
      </Button>
    </>
  );

  return (
    <HeroLayout
      stage
      hero={
        <>
          <JaugeDemarrage progression={progression} className="mb-4" />
          <h1 className="text-balance text-heading-sm text-foreground sm:text-heading">Ça te tente ?</h1>
          {/* Au téléphone, les trois boutons sous la carte disent les gestes : la place va à l'affiche. */}
          <p className="hidden max-w-md text-balance text-base text-muted sm:block">
            Chaque geste remplit ta bibliothèque et apprend tes goûts. Les flèches du clavier marchent aussi.
          </p>
          {prete && (
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
              <Button href="/recommendations" variant="primary" size="sm">
                Voir mes recommandations
              </Button>
              {anonyme ? (
                <Button href="/connexion?retour=/bienvenue" size="sm">
                  Garder mon compte
                </Button>
              ) : (
                <Button href="/" size="sm">
                  Aller à l&apos;accueil
                </Button>
              )}
            </div>
          )}
        </>
      }
    >
      <SwipeDeck cartes={file} fiches={fiches} onRepondre={repondre} onAnnuler={annuler} peutAnnuler={historique.length > 0} retour={retour} fin={fin} />
    </HeroLayout>
  );
}
