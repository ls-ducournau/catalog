"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search, X } from "lucide-react";

export type FilterOption = { value: string; label: string };

const VIEWPORT_MARGIN = 8;
const GAP = 6;

/**
 * Filtre déroulant : pastille + panneau stylé, à la place d'un `<select>` natif dont la liste
 * est dessinée par l'OS (fond clair, police système) et jure avec le thème sombre.
 *
 * Le panneau est rendu en portal et positionné à la mesure : sous la pastille, basculé au-dessus
 * s'il manque la place, et borné dans le viewport. Il se referme au clic extérieur, à Échap, au
 * défilement et au redimensionnement.
 */
export function FilterSelect({
  placeholder,
  value,
  options,
  onChange,
  searchable = false,
  clearable = true,
  prefix,
}: {
  /** Libellé affiché quand rien n'est sélectionné — sert aussi d'entrée « tout » dans la liste. */
  placeholder: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
  /** Champ de recherche dans le panneau — pour les listes longues (genres). */
  searchable?: boolean;
  /** `false` pour un réglage toujours défini (le tri, par exemple). */
  clearable?: boolean;
  /** Texte court devant la valeur, ex. « Trier par ». */
  prefix?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [triggerEl, setTriggerEl] = useState<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [layout, setLayout] = useState<{ top: number; left: number; minWidth: number } | null>(null);

  const selected = options.find((o) => o.value === value) ?? null;
  const active = value !== "";

  const visible = useMemo(() => {
    if (!searchable || query.trim() === "") return options;
    const q = query.trim().toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query, searchable]);

  // Entrée « tout » en tête, quand le filtre peut être remis à zéro.
  const rows: FilterOption[] = clearable ? [{ value: "", label: placeholder }, ...visible] : visible;

  function close() {
    setOpen(false);
    setQuery("");
  }

  /** La valeur courante est pré-surlignée : les flèches partent d'où on en est. */
  function openMenu() {
    setHighlight(Math.max(0, rows.findIndex((r) => r.value === value)));
    setOpen(true);
  }

  function pick(next: string) {
    onChange(next);
    close();
    triggerEl?.focus();
  }

  useLayoutEffect(() => {
    if (!open || !triggerEl) return;
    const panel = panelRef.current;
    if (!panel) return;

    const trigger = triggerEl.getBoundingClientRect();
    const rect = panel.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const fitsBelow = trigger.bottom + GAP + rect.height <= vh - VIEWPORT_MARGIN;
    const top = fitsBelow
      ? trigger.bottom + GAP
      : Math.max(VIEWPORT_MARGIN, trigger.top - GAP - rect.height);
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, trigger.left),
      Math.max(VIEWPORT_MARGIN, vw - VIEWPORT_MARGIN - rect.width)
    );

    setLayout({ top, left, minWidth: trigger.width });
  }, [open, triggerEl, rows.length]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || triggerEl?.contains(target)) return;
      close();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        triggerEl?.focus();
      }
    }
    // Le défilement de la page déplace l'ancre, donc on referme — mais pas quand c'est la liste
    // elle-même qu'on fait défiler (sinon la liste des genres se referme dès qu'on la parcourt).
    function onScroll(e: Event) {
      if (panelRef.current?.contains(e.target as Node)) return;
      close();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open, triggerEl]);

  // À l'ouverture, le focus entre dans le panneau (champ de recherche s'il y en a un, sinon le
  // panneau lui-même) : sans ça son gestionnaire de touches ne reçoit jamais rien et les flèches
  // comme Entrée sont mortes sur les filtres sans recherche.
  useEffect(() => {
    if (!open) return;
    if (searchable) searchRef.current?.focus();
    else panelRef.current?.focus();
  }, [open, searchable]);

  // La ligne surlignée reste visible quand on parcourt une longue liste (genres) aux flèches.
  useEffect(() => {
    if (!open) return;
    panelRef.current
      ?.querySelector(`[data-idx="${highlight}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, highlight]);

  function onListKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((i) => {
        const next = e.key === "ArrowDown" ? i + 1 : i - 1;
        return (next + rows.length) % rows.length;
      });
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[highlight];
      if (row) pick(row.value);
    }
  }

  return (
    <>
      <div
        className={`inline-flex h-8 items-center rounded-full transition [@media(pointer:coarse)]:h-10 ${
          active
            ? "bg-surface-2 text-foreground"
            : "text-muted shadow-[inset_0_0_0_1px_var(--surface-border)] hover:text-foreground hover:shadow-[inset_0_0_0_1px_var(--line-strong)]"
        }`}
      >
        <button
          ref={setTriggerEl}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => (open ? close() : openMenu())}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && !open) {
              e.preventDefault();
              openMenu();
            }
          }}
          className={`flex h-full items-center gap-1.5 pl-3 text-sm ${active && clearable ? "pr-1" : "pr-3"}`}
        >
          <span className="max-w-[11rem] truncate">
            {prefix && <span className="text-muted">{prefix} </span>}
            {selected ? selected.label : placeholder}
          </span>
          <ChevronDown
            size={13}
            aria-hidden="true"
            className={`shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""} ${
              active ? "text-foreground/70" : "text-muted"
            }`}
          />
        </button>

        {/* Retirer un filtre sans ouvrir la liste : le geste le plus fréquent une fois filtré. */}
        {active && clearable && (
          <button
            type="button"
            aria-label={`Retirer le filtre : ${selected?.label ?? value}`}
            onClick={() => onChange("")}
            className="mr-1.5 rounded-full p-1 text-foreground/60 transition hover:bg-white/10 hover:text-foreground active:scale-90"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="listbox"
            tabIndex={-1}
            onKeyDown={onListKeyDown}
            style={
              {
                position: "fixed",
                top: layout?.top ?? 0,
                left: layout?.left ?? 0,
                minWidth: layout?.minWidth ?? undefined,
                visibility: layout ? "visible" : "hidden",
                "--menu-origin": "top left",
              } as CSSProperties
            }
            className="menu-pop menu-panel z-[60] max-h-[min(20rem,60vh)] w-max max-w-[calc(100vw-1rem)] overflow-y-auto outline-none"
          >
            {searchable && (
              <div className="sticky top-0 z-10 mb-1 flex items-center gap-2 border-b border-surface-border bg-surface-raised px-2 pb-2 pt-1.5">
                <Search size={13} aria-hidden="true" className="shrink-0 text-muted" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setHighlight(0);
                  }}
                  placeholder="Filtrer…"
                  aria-label="Filtrer la liste"
                  className="w-full min-w-[9rem] bg-transparent text-sm text-foreground outline-none placeholder:text-muted"
                />
              </div>
            )}

            {rows.length === 0 && <p className="px-2 py-1.5 text-sm text-muted">Aucun résultat.</p>}

            {rows.map((row, i) => {
              const isSelected = row.value === value;
              return (
                <button
                  key={row.value || "__all__"}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  data-idx={i}
                  aria-selected={isSelected}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => pick(row.value)}
                  data-highlighted={highlight === i}
                  className="menu-item"
                >
                  <span className="truncate">{row.label}</span>
                  {isSelected && <Check size={14} aria-hidden="true" className="shrink-0 text-foreground" />}
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
}
