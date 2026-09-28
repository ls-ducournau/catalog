"use client";

import { useRef, useState } from "react";
import { Heart, Laugh, Rocket, Zap } from "lucide-react";
import { Button, Chip, MonoMeta, SearchField, Select, Switch, Tabs } from "@/components/ui";
import { StarRating } from "@/components/StarRating";
import { DURATION, preset, prefersReducedMotion, useGSAP } from "@/lib/motion";

// Démonstrations interactives du guide /design (spec design-system-v2 § 8.3). Aucune écriture :
// les contrôles ne changent que leur état local.

export function ChipDemo() {
  const [picked, setPicked] = useState<string[]>(["intense"]);
  const toggle = (v: string) => setPicked((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]));
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Chip pressed={picked.includes("leger")} onClick={() => toggle("leger")} icon={<Laugh size={14} aria-hidden="true" />}>
        Léger
      </Chip>
      <Chip pressed={picked.includes("intense")} onClick={() => toggle("intense")} icon={<Zap size={14} aria-hidden="true" />}>
        Intense
      </Chip>
      <Chip pressed={picked.includes("emouvant")} onClick={() => toggle("emouvant")} icon={<Heart size={14} aria-hidden="true" />}>
        Émouvant
      </Chip>
      <Chip className="is-hover" icon={<Rocket size={14} aria-hidden="true" />}>
        Survol
      </Chip>
      <Chip className="is-focus">Focus</Chip>
    </div>
  );
}

export function ControlsDemo() {
  const [tab, setTab] = useState<"pile" | "decouvrir">("pile");
  const [kind, setKind] = useState<"tout" | "films" | "series">("tout");
  const [sort, setSort] = useState("name");
  const [genre, setGenre] = useState("");
  const [rating, setRating] = useState<string | null>("⭐️⭐️⭐️⭐️");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4">
        <Tabs
          label="Source"
          options={[
            { value: "pile", label: "Ma pile à voir" },
            { value: "decouvrir", label: "À découvrir" },
          ]}
          value={tab}
          onChange={setTab}
        />
        <Tabs
          label="Catégorie"
          subtle
          options={[
            { value: "tout", label: "Tout" },
            { value: "films", label: "Films" },
            { value: "series", label: "Séries" },
          ]}
          value={kind}
          onChange={setKind}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          placeholder="Tout genre"
          value={genre}
          onChange={setGenre}
          options={[
            { value: "drame", label: "Drame" },
            { value: "thriller", label: "Thriller" },
            { value: "comedie", label: "Comédie" },
          ]}
        />
        <Select
          placeholder="Tri"
          prefix="Trier par"
          value={sort}
          onChange={setSort}
          clearable={false}
          options={[
            { value: "name", label: "Nom" },
            { value: "rating", label: "Note" },
            { value: "year", label: "Année" },
          ]}
        />
      </div>
      <StarRating rating={rating} onRate={setRating} showLabel />
    </div>
  );
}

export function FieldDemo() {
  return (
    <div className="grid max-w-3xl gap-3 sm:grid-cols-2">
      <SearchField placeholder="Rechercher un titre…" shortcut={["/"]} aria-label="Rechercher (démonstration)" />
      <SearchField placeholder="Recherche en cours" searching defaultValue="Dune" aria-label="Recherche en cours (démonstration)" />
      <SearchField placeholder="Survol" className="is-hover" aria-label="Survol (démonstration)" />
      <SearchField placeholder="Erreur" className="is-error" aria-invalid aria-label="Erreur (démonstration)" />
    </div>
  );
}

export function SwitchDemo() {
  const [on, setOn] = useState(true);
  const [off, setOff] = useState(false);
  return (
    <div className="flex items-center gap-6">
      <label className="flex items-center gap-2 text-sm text-foreground">
        <Switch checked={on} onChange={setOn} label="Bandes-annonces dans l'app" />
        Bandes-annonces dans l&apos;app
      </label>
      <label className="flex items-center gap-2 text-sm text-foreground">
        <Switch checked={off} onChange={setOff} label="Toujours ouvrir sur YouTube" />
        Toujours ouvrir sur YouTube
      </label>
    </div>
  );
}

const DURATIONS = Object.entries(DURATION) as [string, number][];

export function MotionDemo() {
  const scope = useRef<HTMLDivElement | null>(null);
  const [pill, setPill] = useState(0);
  const { contextSafe } = useGSAP({ scope });

  // Les gestionnaires retrouvent leur zone depuis l'élément cliqué : ils ne lisent aucune ref.
  const zone = (el: Element) => el.closest("[data-demo-motion]");
  const replayEnter = contextSafe((e: React.MouseEvent<HTMLElement>) => {
    if (prefersReducedMotion()) return;
    preset.enter(zone(e.currentTarget)?.querySelectorAll("[data-demo-item]") ?? []);
  });
  const replaySwap = contextSafe((e: React.MouseEvent<HTMLElement>) => {
    if (prefersReducedMotion()) return;
    const el = zone(e.currentTarget)?.querySelector("[data-demo-swap]");
    if (el) preset.swap(el);
  });
  const slide = contextSafe((e: React.MouseEvent<HTMLElement>, to: number) => {
    setPill(to);
    const target = e.currentTarget;
    const marker = target.parentElement?.querySelector<HTMLElement>("[data-demo-marker]");
    if (!marker) return;
    preset.slide(marker, { x: target.offsetLeft - 4, width: target.offsetWidth });
  });

  return (
    <div ref={scope} data-demo-motion className="flex flex-col gap-8">
      <div className="flex flex-wrap gap-6">
        {DURATIONS.map(([name, s]) => (
          <MonoMeta key={name}>
            --dur-{name} | {Math.round(s * 1000)} ms
          </MonoMeta>
        ))}
      </div>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Button size="sm" onClick={replayEnter}>
            Rejouer « enter »
          </Button>
          <MonoMeta>arrivée : 8 px et opacité, 30 ms d&apos;écart, 8 pas au plus</MonoMeta>
        </div>
        <div className="flex gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} data-demo-item className="h-14 w-10 rounded-frame bg-surface shadow-[var(--shadow-key)]" />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Button size="sm" onClick={replaySwap}>
            Rejouer « swap »
          </Button>
          <MonoMeta>changement de vue : fondu de 150 ms, rien ne bouge</MonoMeta>
        </div>
        <p data-demo-swap className="text-base text-foreground">
          Le contenu change sur place.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        <MonoMeta>« slide » : un repère glisse jusqu&apos;à sa cible, 300 ms</MonoMeta>
        <div className="relative flex w-max gap-1 rounded-full p-1 shadow-[inset_0_0_0_1px_var(--border)]">
          <span data-demo-marker aria-hidden="true" className="absolute left-1 top-1 h-7 w-20 rounded-full bg-selection" />
          {["Titres", "Personnes", "Paliers"].map((label, i) => (
            <button
              key={label}
              type="button"
              onClick={(e) => slide(e, i)}
              aria-pressed={pill === i}
              className="relative h-7 w-20 rounded-full text-xs font-medium text-muted aria-pressed:text-foreground"
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
