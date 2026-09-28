"use client";

import { useEffect, useRef } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

const MIN_YEAR = 1900;
const MAX_YEAR = new Date().getFullYear() + 2;
/** Attente avant la répétition quand on maintient une flèche, puis cadence de défilement. */
const HOLD_DELAY_MS = 350;
const HOLD_INTERVAL_MS = 60;

function clamp(year: number): number {
  return Math.min(MAX_YEAR, Math.max(MIN_YEAR, year));
}

/**
 * Champ d'année : saisie libre au clavier, plus deux flèches pour avancer ou reculer d'un an.
 *
 * - Maintenir une flèche fait défiler les années (on traverse vite une décennie sans cliquer
 *   dix fois).
 * - Dans le champ, ↑/↓ font ±1 et Maj+↑/↓ font ±10.
 * - Champ vide : la première pression part de `fallback`, pas de 1900.
 */
export function YearInput({
  value,
  onChange,
  placeholder,
  fallback,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Année proposée à la première pression sur une flèche quand le champ est vide. */
  fallback: number;
  label: string;
}) {
  // Valeur courante pendant un défilement maintenu : les ticks du minuteur ne voient pas les
  // nouveaux rendus, ils doivent repartir de la dernière année posée, pas de la prop figée.
  const holdValue = useRef<number | null>(null);
  const holdTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  function step(delta: number) {
    const base =
      holdValue.current ?? (value === "" ? fallback - delta : Number(value) || fallback - delta);
    const next = clamp(base + delta);
    holdValue.current = next;
    onChange(String(next));
  }

  function stopHold() {
    if (holdTimeout.current) clearTimeout(holdTimeout.current);
    if (holdInterval.current) clearInterval(holdInterval.current);
    holdTimeout.current = null;
    holdInterval.current = null;
    holdValue.current = null;
  }

  function startHold(delta: number) {
    stopHold();
    step(delta);
    holdTimeout.current = setTimeout(() => {
      holdInterval.current = setInterval(() => step(delta), HOLD_INTERVAL_MS);
    }, HOLD_DELAY_MS);
  }

  useEffect(() => stopHold, []);

  const arrowClass =
    "flex h-3.5 w-4 items-center justify-center rounded text-muted transition hover:bg-white/10 hover:text-foreground active:scale-90";

  return (
    <div className="flex items-center gap-0.5">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 4))}
        onKeyDown={(e) => {
          if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
          e.preventDefault();
          const size = e.shiftKey ? 10 : 1;
          holdValue.current = null;
          step(e.key === "ArrowUp" ? size : -size);
        }}
        placeholder={placeholder}
        inputMode="numeric"
        maxLength={4}
        aria-label={label}
        className="w-11 bg-transparent text-sm text-foreground outline-none placeholder:text-muted"
      />
      {/* Hors de l'ordre de tabulation : au clavier, les flèches du champ font déjà le travail. */}
      <div className="flex flex-col">
        <button
          type="button"
          tabIndex={-1}
          aria-label={`${label} : année suivante`}
          onPointerDown={(e) => {
            e.preventDefault();
            startHold(1);
          }}
          onPointerUp={stopHold}
          onPointerLeave={stopHold}
          className={arrowClass}
        >
          <ChevronUp size={11} aria-hidden="true" />
        </button>
        <button
          type="button"
          tabIndex={-1}
          aria-label={`${label} : année précédente`}
          onPointerDown={(e) => {
            e.preventDefault();
            startHold(-1);
          }}
          onPointerUp={stopHold}
          onPointerLeave={stopHold}
          className={arrowClass}
        >
          <ChevronDown size={11} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
