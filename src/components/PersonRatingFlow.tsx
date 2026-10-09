"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Star, UsersRound } from "lucide-react";
import { CommandWindow, EmptyState } from "@/components/sections";
import { RatingKeys, ratedAs } from "@/components/RatingKeys";
import { StarCount } from "@/components/StarRating";
import { usePressedKey } from "@/components/TierFlow";
import { Badge, Button, Card, Skeleton, Toast } from "@/components/ui";
import { RoleBadges } from "@/components/PersonRoles";
import type { PersonView } from "@/lib/peopleService";

// Noter une à une les personnes aimées qui n'ont pas encore de note (classement-v1 FR-13, demande
// de l'utilisateur du 2026-09-28) : dans le Tri rapide, famille Personnes, mode « Noter ». La
// carte d'une personne, puis six touches : 0 (💩) à 5 étoiles ; Espace passe, Ctrl+Z annule.

type Entry = { person: PersonView; kind: "rate" | "skip"; rating?: number };

/** Enregistre la note d'une personne aimée ; `null` la retire. */
async function saveRating(person: PersonView, rating: number | null): Promise<boolean> {
  const res = await fetch("/api/people/opinions", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: person.id, name: person.name, opinion: 1, rating }),
  }).catch(() => null);
  return Boolean(res?.ok);
}

export function PersonRatingFlow({ head }: { head: ReactNode }) {
  const [queue, setQueue] = useState<PersonView[] | null>(null);
  const [history, setHistory] = useState<Entry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pressed, press] = usePressedKey();

  // Les personnes aimées sans note, les plus présentes dans tes titres vus d'abord.
  useEffect(() => {
    fetch("/api/people/opinions")
      .then((res) => res.json() as Promise<{ people: PersonView[] }>)
      .then(({ people }) =>
        setQueue(people.filter((p) => p.opinion === 1 && p.rating === null).sort((a, b) => b.seen.length - a.seen.length))
      )
      .catch(() => {
        setQueue([]);
        setError("Impossible de charger les personnes.");
      });
  }, []);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(timer);
  }, [error]);

  const current = queue?.[0] ?? null;
  const rated = history.filter((e) => e.kind === "rate").length;
  const last = history[history.length - 1] ?? null;

  const rate = useCallback(
    (n: number) => {
      if (!current) return;
      press(String(n));
      setQueue((q) => q?.slice(1) ?? q);
      const entry: Entry = { person: current, kind: "rate", rating: n };
      setHistory((h) => [...h, entry]);
      void saveRating(current, n).then((ok) => {
        if (ok) return;
        // Note refusée : la personne revient en tête, rien n'est compté.
        setHistory((h) => h.filter((e) => e !== entry));
        setQueue((q) => (q ? [current, ...q.filter((p) => p.id !== current.id)] : q));
        setError("La note n'a pas été enregistrée.");
      });
    },
    [current, press]
  );

  const skip = useCallback(() => {
    if (!current) return;
    press("Espace");
    setQueue((q) => q?.slice(1) ?? q);
    setHistory((h) => [...h, { person: current, kind: "skip" }]);
  }, [current, press]);

  const undo = useCallback(async () => {
    const entry = history[history.length - 1];
    if (!entry) return;
    setHistory((h) => h.slice(0, -1));
    setQueue((q) => [entry.person, ...(q ?? []).filter((p) => p.id !== entry.person.id)]);
    if (entry.kind === "rate" && !(await saveRating(entry.person, null))) {
      setError("L'annulation n'a pas pu être appliquée.");
    }
  }, [history]);

  // 0 à 5 : la note ; Espace : passer ; Ctrl+Z (⌘Z) : annuler.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable]")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        void undo();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (/^[0-5]$/.test(e.key)) {
        e.preventDefault();
        rate(Number(e.key));
      } else if (e.key === " " && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        skip();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rate, skip, undo]);

  const remaining = queue?.length ?? 0;

  return (
    <>
      <CommandWindow
        head={head}
        className="max-w-3xl"
        context={
          <>
            <Star size={14} aria-hidden="true" className="shrink-0" />
            <span className="truncate" aria-live="polite">
              {queue === null ? (
                "Personnes aimées à noter"
              ) : (
                <>
                  <span className="font-medium text-foreground">{remaining}</span> à noter
                  {rated > 0 && ` · ${rated} notée${rated > 1 ? "s" : ""}`}
                </>
              )}
            </span>
          </>
        }
        primary={{ label: "Annuler", keys: ["Ctrl", "Z"], onClick: () => void undo(), disabled: history.length === 0 }}
        secondary={[{ label: "Passer", keys: ["Espace"], onClick: skip, disabled: !current }]}
      >
        <div className="p-3 sm:p-4">
          {queue === null ? (
            <Skeleton className="h-[330px] w-full rounded-card" />
          ) : current ? (
            <PersonFace person={current} />
          ) : (
            <div className="flex min-h-[330px] items-center justify-center">
              <EmptyState
                icon={<UsersRound size={20} aria-hidden="true" />}
                title="Toutes les personnes que tu aimes sont notées"
                action={
                  <Button variant="secondary" size="sm" href="/classement?vue=personnes">
                    Voir le classement des personnes
                  </Button>
                }
              >
                Aime d&apos;autres personnes dans « Trier », elles arriveront ici.
              </EmptyState>
            </div>
          )}
        </div>
      </CommandWindow>

      {/* Six notes, chacune avec sa touche : de 💩 à cinq étoiles. */}
      <RatingKeys onRate={rate} disabled={!current} pressed={pressed} />

      {/* Retour de la dernière note : au clavier, c'est le seul signe visible. */}
      <p className="-mt-2 min-h-5 text-center text-xs text-muted" aria-live="polite">
        {last &&
          (last.kind === "skip"
            ? `« ${last.person.name} » passé`
            : `« ${last.person.name} » ${ratedAs(last.rating ?? 0)}`)}
      </p>

      {error && <Toast>{error}</Toast>}
    </>
  );
}

/** Carte d'une personne : portrait, rôles, tes titres vus avec tes notes, et leur moyenne. */
function PersonFace({ person }: { person: PersonView }) {
  const initials = person.name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("");
  const average = person.averageStars === null ? null : person.averageStars.toFixed(1).replace(".", ",");
  return (
    <Card as="article" className="flex min-h-[330px] flex-col overflow-hidden sm:flex-row">
      <div className="relative h-60 w-full shrink-0 bg-surface-2 sm:h-auto sm:w-[220px]">
        {person.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={person.photoUrl} alt={person.name} draggable={false} className="h-full w-full object-cover object-top" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-heading text-muted">{initials}</div>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-4 sm:p-5">
        <div>
          <h2 className="line-clamp-2 text-subheading text-foreground">{person.name}</h2>
          <RoleBadges roles={person.roles} className="mt-2" />
        </div>
        <p className="text-sm text-foreground">
          Dans <span className="font-semibold">{person.seen.length}</span> de tes titres vus
          {average && (
            <>
              {" "}
              · tes notes : moyenne <StarCount value={average} size={12} />
            </>
          )}
        </p>
        <ul className="flex flex-wrap items-center gap-1.5 overflow-hidden">
          {person.seen.slice(0, 8).map((t) => (
            <li key={t.id} className="max-w-full">
              <Badge className="max-w-full truncate">
                {t.name}
                {t.stars !== null && (t.stars === 0 ? " 💩" : <StarCount value={t.stars} size={10} className="ml-1" />)}
              </Badge>
            </li>
          ))}
          {person.seen.length > 8 && <li className="px-1 text-xs text-muted">+{person.seen.length - 8}</li>}
        </ul>
      </div>
    </Card>
  );
}
