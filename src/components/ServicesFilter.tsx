"use client";

import { MonitorPlay, Settings2 } from "lucide-react";

/**
 * Filtre « Sur mes abonnements » (spec disponibilite-streaming-v1 FR-5), avec l'accès au choix
 * des abonnements. Sans abonnement déclaré, activer le filtre ouvre le choix au lieu de vider la
 * liste (EC-2).
 */
export function ServicesFilter({
  active,
  subscriptionCount,
  onToggle,
  onOpenPicker,
}: {
  active: boolean;
  subscriptionCount: number;
  onToggle: (next: boolean) => void;
  onOpenPicker: () => void;
}) {
  return (
    <div
      className={`flex items-center rounded-full border transition ${
        active
          ? "border-transparent bg-surface-2 text-foreground"
          : "border-field-edge text-muted hover:border-field-edge-hover hover:text-foreground"
      }`}
    >
      <button
        type="button"
        aria-pressed={active}
        onClick={() => {
          if (subscriptionCount === 0) onOpenPicker();
          else onToggle(!active);
        }}
        className="flex items-center gap-1.5 py-1.5 pl-3.5 pr-2 text-sm"
      >
        <MonitorPlay size={14} aria-hidden="true" />
        Sur mes abonnements
      </button>
      <button
        type="button"
        onClick={onOpenPicker}
        aria-label="Choisir mes abonnements"
        title={
          subscriptionCount > 0
            ? `${subscriptionCount} abonnement${subscriptionCount > 1 ? "s" : ""}, modifier`
            : "Choisir mes abonnements"
        }
        className="mr-1.5 flex items-center gap-1 rounded-full px-1.5 py-1 text-xs transition hover:bg-white/10 hover:text-foreground active:scale-90"
      >
        <Settings2 size={13} aria-hidden="true" />
        {subscriptionCount > 0 && <span>{subscriptionCount}</span>}
      </button>
    </div>
  );
}
