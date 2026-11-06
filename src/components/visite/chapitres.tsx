"use client";

import { useCallback, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { ArrowRight, Check, Heart, Plus, Undo2 } from "lucide-react";
import { useEtatCompte } from "@/components/CompteBouton";
import { RatingKeys, ratedAs } from "@/components/RatingKeys";
import { StarCount } from "@/components/StarRating";
import { SegmentedControl as Tabs } from "@/components/SegmentedControl";
import { Button } from "@/components/ui/Button";
import { Badge, Card, Kbd, Keycap, MetaRow } from "@/components/ui/primitives";
import { genreLine } from "@/lib/genres";
import type { Category } from "@/lib/libraryItem";
import type { ShowcaseTitle } from "@/lib/showcase";
import { MOOD_LABELS, type Mood } from "@/lib/tonight";
import { aGarder, apresDuel, classement, cleTitre, eloDe, pourCeSoir, prochainePaire, recommandations, type Gagnant, type Tri } from "@/lib/visite";
import { useVisite } from "./VisiteEtat";

// Les chapitres jouables de la visite (specs/visite-interactive-v1.md § 4) et leurs démonstrations sur
// l'accueil (§ 5). Chaque chapitre : le geste de l'application, sur de vrais titres, sans compte ; l'état
// vit dans le navigateur (VisiteEtat) jusqu'à « Garder ce que j'ai fait ».

const CATEGORY_LABEL: Record<Category, string> = { Movie: "Film", "TV Series": "Série", Documentary: "Documentaire" };
const JSON_HEADERS = { "Content-Type": "application/json" };

function Poster({ url, className }: { url: string | null; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt="" loading="lazy" draggable={false} className={className} /> : null;
}

function useParCle(titres: ShowcaseTitle[]) {
  return useMemo(() => new Map(titres.map((t) => [cleTitre(t), t])), [titres]);
}

/** Touche affichée enfoncée un instant, comme dans le Tri rapide. */
function usePressed(): [string | null, (key: string) => void] {
  const [pressed, setPressed] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const press = useCallback((key: string) => {
    setPressed(key);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setPressed(null), 150);
  }, []);
  return [pressed, press];
}

/** Fin d'étape : une phrase et le pas suivant. */
function Suite({ titre, href, action }: { titre: string; href: string; action: string }) {
  return (
    <div className="flex flex-col items-start gap-4 py-8">
      <h3 className="text-subheading text-foreground">{titre}</h3>
      <Button href={href} size="sm">
        {action}
        <ArrowRight size={14} aria-hidden="true" />
      </Button>
    </div>
  );
}

/** « Ça me tente » : le titre rejoint ta pile (dans la visite, rien n'est encore écrit). */
function EnvieBouton({ titre, onImage = false }: { titre: ShowcaseTitle; onImage?: boolean }) {
  const { etat, maj } = useVisite();
  const cle = cleTitre(titre);
  const envie = etat.tri[cle] === "envie";
  return (
    <Button
      size="sm"
      variant={onImage ? "overlay" : envie ? "ghost" : "secondary"}
      aria-pressed={envie}
      aria-label={envie ? `Retirer « ${titre.name} » de ta pile` : `« ${titre.name} » me tente`}
      onClick={() =>
        maj((e) => {
          const tri = { ...e.tri };
          if (envie) delete tri[cle];
          else tri[cle] = "envie";
          return { ...e, tri };
        })
      }
    >
      {envie ? <Check size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
      {envie ? "Dans ta pile" : "Ça me tente"}
    </Button>
  );
}

// ---------- 1. Tri rapide ----------

const TRIS: { tri: Tri; label: string; touche: string }[] = [
  { tri: "vu", label: "Vu", touche: "1" },
  { tri: "pasvu", label: "Pas vu", touche: "2" },
  { tri: "envie", label: "Ça me tente", touche: "3" },
];

export function TriVisite({ titres }: { titres: ShowcaseTitle[] }) {
  const { etat, maj } = useVisite();
  const [dernier, setDernier] = useState<string | null>(null);
  const [pressed, press] = usePressed();
  const file = titres.filter((t) => !etat.tri[cleTitre(t)]);
  const courant = file[0] ?? null;
  const tries = titres.length - file.length;

  function trier(tri: Tri, touche: string) {
    if (!courant) return;
    press(touche);
    const cle = cleTitre(courant);
    maj((e) => ({ ...e, tri: { ...e.tri, [cle]: tri } }));
    setDernier(cle);
  }

  function annuler() {
    const cle = dernier;
    if (!cle) return;
    maj((e) => {
      const tri = { ...e.tri };
      const notes = { ...e.notes };
      delete tri[cle];
      delete notes[cle];
      return { ...e, tri, notes };
    });
    setDernier(null);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.altKey || e.repeat) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      annuler();
      return;
    }
    const choix = TRIS.find((t) => t.touche === e.key);
    if (choix && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      trier(choix.tri, choix.touche);
    }
  }

  const vus = Object.values(etat.tri).filter((t) => t === "vu").length;
  const envies = Object.values(etat.tri).filter((t) => t === "envie").length;
  return (
    <div className="feature-stage" style={courant?.tint ? ({ "--tint": courant.tint } as CSSProperties) : undefined} onKeyDown={onKeyDown}>
      {courant ? (
        <>
          <div className="flex items-center gap-5 sm:gap-6">
            <div className="poster aspect-[2/3] w-24 shrink-0 sm:w-32">
              <Poster url={courant.posterUrl} className="h-full w-full object-cover" />
            </div>
            <div className="flex min-w-0 flex-col items-start gap-3">
              <Badge>Tu l&apos;as vu ?</Badge>
              <div className="flex min-w-0 flex-col gap-1">
                <h3 className="line-clamp-2 text-subheading text-foreground">{courant.name}</h3>
                <MetaRow>
                  <span>{CATEGORY_LABEL[courant.category]}</span>
                  {courant.year && <span>{courant.year}</span>}
                  {courant.genres.length > 0 && <span>{genreLine(courant.genres, 2)}</span>}
                </MetaRow>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {TRIS.map((t) => (
              <Card
                key={t.tri}
                as="button"
                type="button"
                variant="tile"
                onClick={() => trier(t.tri, t.touche)}
                aria-keyshortcuts={t.touche}
                className="flex flex-col items-center gap-2 px-2 py-3 text-sm text-foreground"
              >
                <Keycap pressed={pressed === t.touche} aria-hidden="true">
                  {t.touche}
                </Keycap>
                {t.label}
              </Card>
            ))}
          </div>
        </>
      ) : (
        <Suite titre={`Tri terminé : ${vus} vus, ${envies} qui te tentent.`} href="#notation" action="Noter mes titres vus" />
      )}
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm text-muted">
        <span aria-live="polite">{`${tries} sur ${titres.length} triés`}</span>
        {dernier && (
          <Button size="sm" variant="ghost" onClick={annuler} aria-keyshortcuts="Control+Z">
            <Undo2 size={14} aria-hidden="true" />
            Annuler
            <span className="hidden items-center gap-1 sm:inline-flex">
              <Kbd>Ctrl</Kbd>
              <Kbd>Z</Kbd>
            </span>
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------- 2. Notation ----------

export function NotationVisite({ titres }: { titres: ShowcaseTitle[] }) {
  const { etat, maj } = useVisite();
  const [dernier, setDernier] = useState<{ cle: string; nom: string; note: number } | null>(null);
  const [pressed, press] = usePressed();
  const vus = titres.filter((t) => etat.tri[cleTitre(t)] === "vu");
  const file = vus.filter((t) => etat.notes[cleTitre(t)] === undefined);
  const courant = file[0] ?? null;

  const noter = (n: number) => {
    if (!courant) return;
    press(String(n));
    const cle = cleTitre(courant);
    maj((e) => ({ ...e, notes: { ...e.notes, [cle]: n } }));
    setDernier({ cle, nom: courant.name, note: n });
  };

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!e.ctrlKey && !e.metaKey && !e.altKey && /^[0-5]$/.test(e.key)) {
      e.preventDefault();
      noter(Number(e.key));
    }
  }

  return (
    <div className="feature-stage" style={courant?.tint ? ({ "--tint": courant.tint } as CSSProperties) : undefined} onKeyDown={onKeyDown}>
      {vus.length === 0 ? (
        <Suite titre="Marque d'abord des titres que tu as vus." href="#tri" action="Revenir au tri" />
      ) : courant ? (
        <>
          <div className="flex items-center gap-5 sm:gap-6">
            <div className="poster aspect-[2/3] w-24 shrink-0 sm:w-32">
              <Poster url={courant.posterUrl} className="h-full w-full object-cover" />
            </div>
            <div className="flex min-w-0 flex-col items-start gap-3">
              <Badge>Vu, pas encore noté</Badge>
              <h3 className="line-clamp-2 text-subheading text-foreground">{courant.name}</h3>
              <MetaRow>
                <span>{CATEGORY_LABEL[courant.category]}</span>
                {courant.year && <span>{courant.year}</span>}
              </MetaRow>
            </div>
          </div>
          <RatingKeys onRate={noter} disabled={false} pressed={pressed} fitContainer className="max-w-none" />
        </>
      ) : (
        <Suite titre="Tes titres vus sont notés." href="#duels" action="Passer aux duels" />
      )}
      <p aria-live="polite" className="min-h-8 text-sm text-muted">
        {dernier ? `« ${dernier.nom} » ${ratedAs(dernier.note)}` : vus.length > 0 ? "Une note par clic, ou au clavier de 0 à 5." : ""}
      </p>
    </div>
  );
}

// ---------- 3. Duels ----------

/** `libre` : des titres sans note (démonstration de l'accueil). */
export function DuelsVisite({ titres, libre = false }: { titres: ShowcaseTitle[]; libre?: boolean }) {
  const { etat, maj } = useVisite();
  const parCle = useParCle(titres);
  const [pressed, press] = usePressed();
  const cles = libre ? titres.map(cleTitre) : undefined;
  const paire = prochainePaire(etat, cles);
  const a = paire ? parCle.get(paire[0]) : undefined;
  const b = paire ? parCle.get(paire[1]) : undefined;

  const choisir = (gagnant: Gagnant) => {
    if (!paire) return;
    press(gagnant === "A" ? "1" : "2");
    maj((e) => apresDuel(e, paire[0], paire[1], gagnant));
  };

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "1" || e.key === "2") {
      e.preventDefault();
      choisir(e.key === "1" ? "A" : "B");
    }
  }

  const tete = libre
    ? [...new Set(etat.duels.flatMap((d) => [d.a, d.b]))].sort((x, y) => eloDe(etat, y) - eloDe(etat, x)).slice(0, 3)
    : [];
  return (
    <div className="feature-stage" onKeyDown={onKeyDown}>
      {a && b ? (
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          {[a, b].map((t, i) => (
            <Card
              key={cleTitre(t)}
              as="button"
              type="button"
              variant="tile"
              onClick={() => choisir(i === 0 ? "A" : "B")}
              aria-keyshortcuts={String(i + 1)}
              className="mx-auto flex w-full min-w-0 max-w-52 flex-col gap-3 p-2 text-left"
              style={i === 1 ? { gridColumn: 3 } : undefined}
            >
              <div className="poster aspect-[2/3] w-full rounded-control">
                <Poster url={t.posterUrl} className="h-full w-full object-cover" />
              </div>
              <div className="flex min-w-0 items-center gap-3 px-1 pb-1">
                <p className="line-clamp-2 min-h-[2lh] min-w-0 flex-1 text-sm font-medium text-foreground">{t.name}</p>
                <Keycap pressed={pressed === String(i + 1)} aria-hidden="true" className="hidden sm:inline-flex">
                  {i + 1}
                </Keycap>
              </div>
            </Card>
          ))}
          <span aria-hidden="true" className="col-start-2 row-start-1 text-xs text-muted">
            ou
          </span>
        </div>
      ) : (
        <Suite titre="Note au moins deux titres pour lancer les duels." href="#notation" action="Noter mes titres vus" />
      )}
      <p aria-live="polite" className="min-h-8 text-sm text-muted">
        {tete.length > 0
          ? `Ton ordre : ${tete.map((cle) => parCle.get(cle)?.name).filter(Boolean).join(", ")}`
          : etat.duels.length > 0
            ? `${etat.duels.length} duel${etat.duels.length > 1 ? "s" : ""} : ton classement se précise.`
            : a
              ? "Clique ton préféré, ou tape 1 ou 2."
              : ""}
      </p>
    </div>
  );
}

// ---------- 4. Classement ----------

export function ClassementVisite({ titres }: { titres: ShowcaseTitle[] }) {
  const { etat } = useVisite();
  const parCle = useParCle(titres);
  const paliers = classement(etat);
  if (paliers.length === 0) {
    return (
      <div className="feature-stage">
        <Suite titre="Ton classement se forme dès ta première note." href="#notation" action="Noter mes titres vus" />
      </div>
    );
  }
  // Le rang de chaque titre, du premier palier au dernier.
  const rangs = new Map(paliers.flatMap((p) => p.cles).map((cle, i) => [cle, i + 1]));
  return (
    <div className="feature-stage justify-start">
      <ol className="flex flex-col gap-4">
        {paliers.map((palier) => (
          <li key={palier.note} className="flex flex-col gap-2">
            <h3 className="flex h-5 items-center text-sm text-foreground">{palier.note === 0 ? "💩" : <StarCount value={palier.note} size={14} />}</h3>
            <ol className="flex flex-wrap gap-2">
              {palier.cles.map((cle) => {
                const t = parCle.get(cle);
                return t ? (
                  <li key={cle} className="flex w-20 flex-col gap-1">
                    <div className="poster relative aspect-[2/3] w-full rounded-control">
                      <Poster url={t.posterUrl} className="h-full w-full object-cover" />
                      <span className="overlay-pill absolute left-1 top-1 text-xs">{rangs.get(cle)}</span>
                    </div>
                    <p className="line-clamp-2 text-xs text-muted">{t.name}</p>
                  </li>
                ) : null;
              })}
            </ol>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ---------- 5. Recommandations ----------

export function RecosVisite({ titres, pool }: { titres: ShowcaseTitle[]; pool: ShowcaseTitle[] }) {
  const { etat } = useVisite();
  const parCle = useParCle([...titres, ...pool]);
  const recos = recommandations(etat, pool, parCle);
  if (recos.length === 0) {
    return (
      <div className="feature-stage">
        <Suite titre="Note un titre 4 ou 5 étoiles : tes recommandations partent de là." href="#notation" action="Noter mes titres vus" />
      </div>
    );
  }
  return (
    <div className="feature-stage justify-start">
      <ul className="grid gap-3 sm:grid-cols-2">
        {recos.map(({ titre, parce }) => (
          <Card as="li" key={cleTitre(titre)} className="flex gap-3 p-2">
            <div className="poster aspect-[2/3] w-14 shrink-0 rounded-control">
              <Poster url={titre.posterUrl} className="h-full w-full object-cover" />
            </div>
            <div className="flex min-w-0 flex-col items-start gap-1.5">
              <p className="line-clamp-1 text-sm font-medium text-foreground">{titre.name}</p>
              <p className="line-clamp-2 flex items-start gap-1.5 text-xs text-muted">
                <Heart size={12} aria-hidden="true" className="mt-0.5 shrink-0" />
                Parce que tu as aimé {parce.name}
              </p>
              <EnvieBouton titre={titre} />
            </div>
          </Card>
        ))}
      </ul>
    </div>
  );
}

// ---------- 6. Ce soir ----------

const ENVIES = Object.keys(MOOD_LABELS) as Exclude<Mood, "any">[];

export function CeSoirVisite({ pool }: { pool: ShowcaseTitle[] }) {
  const { etat } = useVisite();
  const [envie, setEnvie] = useState<Exclude<Mood, "any">>("light");
  const choix = pourCeSoir(etat, pool, envie);
  return (
    <div className="feature-stage justify-start">
      <div className="scroll-row -mx-1 overflow-x-auto px-1 [&_.segmented]:flex-nowrap">
        <Tabs label="Ce soir : envie" options={ENVIES.map((v) => ({ value: v, label: MOOD_LABELS[v] }))} value={envie} onChange={(v) => setEnvie(v as Exclude<Mood, "any">)} />
      </div>
      {choix.length === 0 ? (
        <p className="py-8 text-sm text-muted">Rien pour cette envie : essaie une autre.</p>
      ) : (
        <ul className="grid grid-cols-3 gap-3">
          {choix.map((t) => (
            <li key={cleTitre(t)} className="flex min-w-0 flex-col gap-2">
              <div className="poster aspect-[2/3] w-full rounded-control">
                <Poster url={t.posterUrl} className="h-full w-full object-cover" />
              </div>
              <p className="line-clamp-2 text-sm text-foreground">{t.name}</p>
              {etat.tri[cleTitre(t)] === "envie" && <Badge>Dans ta pile</Badge>}
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-muted">Tes envies passent en premier.</p>
    </div>
  );
}

// ---------- 7. Playlists ----------

/** Ta liste d'envies, dans l'ordre : « ensuite », et « Vu » fait avancer. Sans envie : un exemple. */
export function PlaylistVisite({ titres, exemple }: { titres: ShowcaseTitle[]; exemple: ShowcaseTitle[] }) {
  const { etat, maj } = useVisite();
  const parCle = useParCle([...titres, ...exemple]);
  const envies = Object.keys(etat.tri).filter((cle) => etat.tri[cle] === "envie" || (etat.tri[cle] === "vu" && etat.notes[cle] === undefined));
  const liste = (envies.length >= 2 ? envies.map((cle) => parCle.get(cle)).filter((t): t is ShowcaseTitle => Boolean(t)) : exemple).slice(0, 6);
  const vu = (t: ShowcaseTitle) => etat.tri[cleTitre(t)] === "vu";
  const ensuite = liste.find((t) => !vu(t)) ?? null;
  const faits = liste.filter(vu).length;
  return (
    <div className="feature-stage justify-start">
      <div className="flex flex-wrap items-center gap-3">
        <Badge>{envies.length >= 2 ? "Ta liste d'envies" : "Exemple"}</Badge>
        <span className="text-sm text-muted">{`${faits} sur ${liste.length} vus`}</span>
      </div>
      <ol className="flex flex-col gap-2">
        {liste.map((t, i) => {
          const courant = ensuite && cleTitre(ensuite) === cleTitre(t);
          return (
            <Card as="li" key={cleTitre(t)} className={`grid grid-cols-[1.5rem_2.5rem_minmax(0,1fr)_auto] items-center gap-3 p-2 ${courant ? "" : "opacity-80"}`}>
              <span className="text-center text-sm text-muted">{i + 1}</span>
              <div className="poster aspect-[2/3] w-10 rounded-control">
                <Poster url={t.posterUrl} className="h-full w-full object-cover" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm text-foreground">{t.name}</p>
                {courant && <p className="text-xs text-muted">Ensuite</p>}
              </div>
              {vu(t) ? (
                <Badge variant="success">Vu</Badge>
              ) : (
                <Button
                  size="sm"
                  variant={courant ? "secondary" : "ghost"}
                  onClick={() => maj((e) => ({ ...e, tri: { ...e.tri, [cleTitre(t)]: "vu" } }))}
                  aria-label={`J'ai vu « ${t.name} »`}
                >
                  <Check size={14} aria-hidden="true" />
                  Vu
                </Button>
              )}
            </Card>
          );
        })}
      </ol>
    </div>
  );
}

// ---------- 8. Sorties ----------

export function SortiesVisite({ sorties }: { sorties: ShowcaseTitle[] }) {
  return (
    <div className="feature-stage justify-start">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="success">Au cinéma</Badge>
        <span className="text-sm text-muted">À l&apos;affiche et bientôt en France</span>
      </div>
      <ul className="flex flex-col gap-2">
        {sorties.slice(0, 5).map((t) => (
          <Card as="li" key={cleTitre(t)} className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-3 p-2 pr-3">
            <div className="poster aspect-[2/3] w-12 rounded-control">
              <Poster url={t.posterUrl} className="h-full w-full object-cover" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{t.name}</p>
              <MetaRow className="flex-nowrap">
                {t.year && <span>{t.year}</span>}
                {t.genres.length > 0 && <span className="truncate">{genreLine(t.genres, 1)}</span>}
              </MetaRow>
            </div>
            <EnvieBouton titre={t} />
          </Card>
        ))}
      </ul>
    </div>
  );
}

// ---------- Garder ----------

/** Verse la visite dans un compte : les titres (vus, envies), leurs notes, puis les duels. */
export function GarderVisite() {
  const { etat, oublier } = useVisite();
  const compte = useEtatCompte();
  const [envoi, setEnvoi] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const bilan = aGarder(etat);

  async function garder() {
    setErreur(null);
    const ids = new Map<string, number>();
    try {
      // L'une après l'autre : en ligne, la première écriture ouvre la session invitée.
      for (const [i, cle] of bilan.titres.entries()) {
        setEnvoi(`${i + 1} sur ${bilan.titres.length}`);
        const [type, tmdbId] = [cle.slice(0, cle.lastIndexOf(":")), Number(cle.slice(cle.lastIndexOf(":") + 1))];
        const res = await fetch("/api/items", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ tmdbId, type, source: "home" }) });
        const corps = (await res.json().catch(() => null)) as { item?: { id: number } } | null;
        if (!res.ok || typeof corps?.item?.id !== "number") continue;
        ids.set(cle, corps.item.id);
        if (etat.tri[cle] === "vu") {
          const note = etat.notes[cle];
          await fetch(`/api/items/${corps.item.id}`, {
            method: "PATCH",
            headers: JSON_HEADERS,
            body: JSON.stringify(note === undefined ? { watchStatus: "Watched" } : { watchStatus: "Watched", rating: note === 0 ? "💩" : "⭐️".repeat(note) }),
          });
        }
      }
      for (const duel of etat.duels) {
        const [itemAId, itemBId] = [ids.get(duel.a), ids.get(duel.b)];
        if (itemAId === undefined || itemBId === undefined) continue;
        await fetch("/api/duels/result", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ itemAId, itemBId, result: duel.gagnant }) });
      }
    } catch {
      setEnvoi(null);
      setErreur("La connexion a coupé : réessaie, ce qui est déjà gardé ne sera pas doublé.");
      return;
    }
    oublier();
    // Un invité garde maintenant son compte (e-mail et mot de passe) ; un compte durable va à sa bibliothèque.
    const durable = compte && compte.connecte && !compte.anonyme;
    window.location.href = compte && !durable ? "/connexion?retour=/library" : "/library";
  }

  const rien = bilan.titres.length === 0;
  return (
    <div className="feature-stage">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Vus", bilan.vus],
          ["Envies", bilan.envies],
          ["Notes", bilan.notes],
          ["Duels", bilan.duels],
        ].map(([label, n]) => (
          <Card key={label} variant="tile" className="flex flex-col gap-1 p-3">
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="font-heading text-heading-sm text-foreground">{n}</dd>
          </Card>
        ))}
      </dl>
      <div className="flex flex-col items-start gap-3">
        <Button variant="primary" size="lg" onClick={() => void garder()} loading={envoi !== null} disabled={rien}>
          {envoi ? `Je garde… ${envoi}` : "Garder ce que j'ai fait"}
        </Button>
        <p role="alert" className="min-h-5 text-sm text-muted">
          {erreur ?? (rien ? "Trie au moins un titre pour commencer ta bibliothèque." : "Tes titres, tes notes et tes duels deviennent ta bibliothèque. Sans code de confirmation.")}
        </p>
      </div>
    </div>
  );
}
