"use client";

import { buttonClass } from "@/components/ui/Button";
import { useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { SearchField } from "@/components/ui";
import { serviceFamily, type Provider } from "@/lib/availability";
import { ProviderLogo } from "@/components/ProviderLogo";

/**
 * Choix de tes abonnements (spec disponibilite-streaming-v1 FR-3). Les formules avec publicité
 * n'y figurent pas : elles sont couvertes d'office par leur service (FR-4).
 */
export function ServicesPicker({
  catalog,
  selected,
  onSave,
  onClose,
}: {
  catalog: Provider[];
  selected: number[];
  onSave: (ids: number[]) => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Set<number>>(() => new Set(selected));
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Un seul représentant par service : celui dont le nom est le service lui-même.
  const services = useMemo(() => {
    const byFamily = new Map<string, Provider>();
    for (const provider of catalog) {
      const family = serviceFamily(provider.name);
      const current = byFamily.get(family);
      const isPlain = provider.name.toLowerCase() === family;
      if (!current || (isPlain && current.name.toLowerCase() !== family)) {
        byFamily.set(family, provider);
      }
    }
    // Conserve l'ordre de popularité du catalogue.
    const kept = new Set([...byFamily.values()].map((p) => p.id));
    return catalog.filter((p) => kept.has(p.id));
  }, [catalog]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? services.filter((p) => p.name.toLowerCase().includes(q)) : services;
  }, [services, query]);

  function toggle(id: number) {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    await onSave([...draft]);
    setSaving(false);
    onClose();
  }

  return (
    <div
      onClick={onClose}
      className="fade-in fixed inset-0 z-50 flex items-start justify-center bg-overlay px-3 py-6 sm:px-6 sm:py-16"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Mes abonnements"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[calc(100dvh-3rem)] w-full max-w-xl flex-col card p-4 sm:max-h-[calc(100dvh-8rem)] sm:p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg text-foreground">Mes abonnements</h2>
            <p className="mt-1 text-sm text-muted">
              Coche les services auxquels tu es abonné. Les formules avec publicité sont incluses
              d&apos;office.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Fermer"
            className="text-muted transition hover:text-foreground active:scale-90"
          >
            ✕
          </button>
        </div>

        {/* Le champ de recherche de l'app, comme partout ailleurs (audit UX W2-7). */}
        <SearchField
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onClear={() => setQuery("")}
          placeholder="Chercher un service…"
          aria-label="Chercher un service"
          className="mt-4"
        />

        <div className="mt-4 grid min-h-0 flex-1 grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2 overflow-y-auto pb-1">
          {visible.map((provider) => {
            const active = draft.has(provider.id);
            return (
              <button
                key={provider.id}
                role="checkbox"
                aria-checked={active}
                onClick={() => toggle(provider.id)}
                className={`relative flex items-center gap-2.5 rounded-xl border p-2 text-left text-sm transition active:scale-[0.98] ${
                  active
                    ? "border-field-edge-focus bg-selection text-foreground"
                    : "border-card-edge text-muted hover:border-field-edge-hover hover:text-foreground"
                }`}
              >
                <ProviderLogo provider={provider} size={28} />
                <span className="min-w-0 flex-1 truncate">{provider.name}</span>
                {active && <Check size={14} className="shrink-0 text-accent" aria-hidden="true" />}
              </button>
            );
          })}
          {visible.length === 0 && <p className="text-sm text-muted">Aucun service ne correspond.</p>}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-surface-border pt-4">
          {/* Mention exigée par les conditions d'utilisation de TMDB. */}
          <span className="text-xs text-muted">Disponibilités : JustWatch, via TMDB</span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className={buttonClass({ variant: "secondary" })}
            >
              Annuler
            </button>
            <button
              onClick={save}
              disabled={saving}
              className={buttonClass({ variant: "primary" })}
            >
              {saving
                ? "Enregistrement…"
                : `Enregistrer${draft.size > 0 ? ` (${draft.size})` : ""}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
