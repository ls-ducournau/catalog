"use client";

import { buttonClass } from "@/components/ui/Button";
import { useEffect, useRef, useState } from "react";
import { Settings } from "lucide-react";
import { useTrailerMode, writeTrailerMode, type TrailerMode } from "@/components/trailerMode";

// Réglages de l'appareil — spec: specs/bandes-annonces-v1.md (FR-7)

const TRAILER_CHOICES: { value: TrailerMode; label: string; hint: string }[] = [
  { value: "embed", label: "Lire dans l'app", hint: "Le lecteur s'ouvre par-dessus la page." },
  { value: "youtube", label: "Ouvrir sur YouTube", hint: "Dans un nouvel onglet, avec ton compte YouTube." },
  { value: "hidden", label: "Ne pas afficher", hint: "Plus aucun bouton de bande-annonce." },
];

export function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const mode = useTrailerMode();
  const root = useRef<HTMLDivElement | null>(null);
  const toggle = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        toggle.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative shrink-0">
      <button
        ref={toggle}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="app-settings"
        aria-label="Réglages"
        title="Réglages"
        className={buttonClass({ variant: "secondary", icon: true })}
      >
        <Settings size={18} aria-hidden="true" />
      </button>
      {open && (
        <div
          id="app-settings"
          role="dialog"
          aria-label="Réglages"
          className="menu-pop menu-panel absolute right-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] p-2"
        >
          <fieldset>
            <legend className="px-1 text-sm font-semibold text-foreground">Bandes-annonces</legend>
            <div className="mt-2 flex flex-col gap-1">
              {TRAILER_CHOICES.map((choice) => (
                <label
                  key={choice.value}
                  className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 transition hover:bg-[var(--surface-hover)] has-[:checked]:bg-surface-2 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent"
                >
                  <input
                    type="radio"
                    name="trailer-mode"
                    value={choice.value}
                    checked={mode === choice.value}
                    onChange={() => writeTrailerMode(choice.value)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)] focus-visible:outline-none"
                  />
                  <span>
                    <span className="block text-sm text-foreground">{choice.label}</span>
                    <span className="block text-xs text-muted">{choice.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <p className="mt-2 px-1 text-xs text-muted">Mémorisé sur cet appareil.</p>
        </div>
      )}
    </div>
  );
}
