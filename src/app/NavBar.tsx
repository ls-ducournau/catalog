"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Plus,
  CalendarDays,
  Ellipsis,
  Layers,
  Library,
  Popcorn,
  Sparkles,
  Swords,
  Trophy,
  type LucideProps,
} from "lucide-react";
import { SettingsMenu } from "@/components/SettingsMenu";
import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui";

type NavLink = {
  href: string;
  label: string;
  /** Libellé de la barre d'onglets, quand le libellé complet n'y tient pas. */
  short?: string;
  icon: ComponentType<LucideProps>;
  /** Sur téléphone : onglet direct (les autres pages passent dans « Plus »). */
  primary: boolean;
  /** Une ligne sous le nom, dans « Plus ». */
  hint?: string;
};

// Ordre de la barre du haut, repris tel quel par la barre d'onglets : on retrouve les pages au
// même endroit d'un écran à l'autre. Onglets directs sur téléphone : ce qui se fait au pouce, en
// soirée ; le classement et les duels, plus posés, passent dans « Plus ».
const NAV_LINKS: NavLink[] = [
  { href: "/library", label: "Bibliothèque", short: "Biblio", icon: Library, primary: true },
  { href: "/classement", label: "Classement", icon: Trophy, primary: false, hint: "Tes titres rangés, note par note" },
  { href: "/duels", label: "Duels", icon: Swords, primary: false, hint: "Deux titres, tu gardes ton préféré" },
  { href: "/tri", label: "Tri rapide", icon: Layers, primary: true },
  { href: "/recommendations", label: "Recommandations", short: "Recos", icon: Sparkles, primary: true },
  { href: "/sorties", label: "Sorties", icon: CalendarDays, primary: false, hint: "Ce qui arrive au ciné et en séries" },
  { href: "/ce-soir", label: "Ce soir", icon: Popcorn, primary: true },
];

const OVERFLOW_LINKS = NAV_LINKS.filter((link) => !link.primary);

/** Demande à la bibliothèque, déjà ouverte, d'ouvrir sa fenêtre d'ajout. */
export const ADD_TITLE_EVENT = "catalog:ajouter-un-titre";
/** Barre du haut : « Ce soir » en sort, il devient l'action principale (le « Download » de Raycast). */
const TOP_LINKS = NAV_LINKS.filter((link) => link.href !== "/ce-soir");

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function NavBar() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButton = useRef<HTMLButtonElement | null>(null);
  const firstMoreLink = useRef<HTMLAnchorElement | null>(null);
  const overflowActive = OVERFLOW_LINKS.some((link) => isActive(pathname, link.href));

  // « Plus » ouvert : focus dans la feuille, Échap la ferme, la page dessous ne défile pas. Si
  // l'écran s'élargit (téléphone tourné), la barre montre tous les onglets : la feuille se ferme.
  useEffect(() => {
    if (!moreOpen) return;
    const button = moreButton.current;
    firstMoreLink.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMoreOpen(false);
    }
    const wide = window.matchMedia("(min-width: 40rem)");
    function onResize() {
      if (wide.matches) setMoreOpen(false);
    }
    window.addEventListener("keydown", onKey);
    wide.addEventListener("change", onResize);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      wide.removeEventListener("change", onResize);
      document.body.style.overflow = overflow;
      button?.focus();
    };
  }, [moreOpen]);

  return (
    <>
      {/* Barre de DESIGN.md (« Glass Navigation Bar ») : pilule flottante en verre, arête `--border`,
          rayon 8. Logo à gauche, liens au centre (Ash, blancs au survol et pour la page ouverte),
          réglages, « Ajouter » et l'action principale « Ce soir » à droite. */}
      <header className="sticky top-0 z-40 pt-3">
        <div className="frame px-4 sm:px-6">
          <nav aria-label="Navigation principale" className="nav-glass flex h-12 items-center gap-4 pl-3 pr-2">
            <Link href="/" aria-label="Catalog, accueil" className="flex shrink-0 items-center rounded-md text-foreground">
              <Logo className="h-7 w-auto" title="Catalog, accueil" />
            </Link>
            {/* Les liens ne tiennent qu'à partir de 1024 px : en dessous, la barre d'onglets du bas
                prend le relais. */}
            <TopLinks pathname={pathname} />
            <div className="ml-auto flex items-center gap-1.5">
              <SettingsMenu />
              {/* Ajouter un titre, depuis n'importe quelle page : la fenêtre d'ajout de la
                  bibliothèque s'ouvre (sur place si on y est déjà). */}
              <Button
                href="/library?ajouter=1"
                onClick={(e) => {
                  if (pathname !== "/library") return;
                  e.preventDefault();
                  window.dispatchEvent(new Event(ADD_TITLE_EVENT));
                }}
                aria-label="Ajouter un titre"
                title="Ajouter un titre"
                variant="secondary"
                className="max-lg:btn-icon"
              >
                <Plus size={15} aria-hidden="true" />
                <span className="hidden lg:inline">Ajouter</span>
              </Button>
              <Button
                href="/ce-soir"
                aria-current={isActive(pathname, "/ce-soir") ? "page" : undefined}
                variant="primary"
                className="hidden lg:inline-flex"
              >
                <Popcorn size={15} aria-hidden="true" />
                Ce soir
              </Button>
            </div>
          </nav>
        </div>
      </header>

      {/* Barre d'onglets, au pouce : téléphone et tablette. Sur téléphone, quatre onglets et
          « Plus » ; sur tablette, les sept. Sa hauteur est réservée en bas de page
          (--bottom-nav-h, globals.css). */}
      <nav
        aria-label="Navigation"
        className="nav-glass fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-40 mx-auto max-w-3xl lg:hidden"
      >
        <ul className="flex h-16 items-stretch px-1">
          {NAV_LINKS.map((link) => {
            const active = isActive(pathname, link.href);
            return (
              <li key={link.href} className={`min-w-0 flex-1 ${link.primary ? "flex" : "hidden sm:flex"}`}>
                <Link
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className="group flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg outline-none transition-transform duration-100 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-focus"
                >
                  <TabContent icon={link.icon} label={link.short ?? link.label} active={active} />
                </Link>
              </li>
            );
          })}
          <li className="flex min-w-0 flex-1 sm:hidden">
            <button
              ref={moreButton}
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              className="group flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg outline-none transition-transform duration-100 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-focus"
            >
              <TabContent icon={Ellipsis} label="Plus" active={overflowActive} />
            </button>
          </li>
        </ul>
      </nav>

      {/* « Plus » : les pages sans onglet sur téléphone, en feuille depuis le bas. Hors de la barre :
          son flou d'arrière-plan piégerait une surcouche fixe placée dedans. */}
      {moreOpen && (
        <div className="fixed inset-0 z-[60] sm:hidden">
          <div aria-hidden="true" className="fade-in absolute inset-0 bg-black/60" onClick={() => setMoreOpen(false)} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Autres pages"
            className="sheet-in absolute inset-x-0 bottom-0 rounded-t-3xl bg-surface px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2 shadow-[var(--shadow-key)]"
          >
            <div aria-hidden="true" className="mx-auto mb-2 h-1 w-10 rounded-full bg-line-strong" />
            <ul className="flex flex-col gap-1">
              {OVERFLOW_LINKS.map((link, index) => {
                const active = isActive(pathname, link.href);
                const Icon = link.icon;
                return (
                  <li key={link.href}>
                    <Link
                      ref={index === 0 ? firstMoreLink : undefined}
                      href={link.href}
                      onClick={() => setMoreOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={`flex min-h-14 items-center gap-3 rounded-lg px-3 py-2 outline-none transition-colors duration-100 focus-visible:ring-2 focus-visible:ring-focus ${
                        active ? "bg-selection" : "hover:bg-selection"
                      }`}
                    >
                      <span className={`icon-circle h-9 w-9 ${active ? "text-foreground" : "text-muted"}`}>
                        <Icon size={18} aria-hidden="true" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-base text-foreground">{link.label}</span>
                        <span className="block text-xs text-muted">{link.hint}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Liens de la barre du haut (ordinateur), comme les « Ghost Nav Link » de DESIGN.md : Ash, sans
 * marge ni fond ; blancs au survol et pour la page ouverte (annoncée par `aria-current`).
 */
function TopLinks({ pathname }: { pathname: string }) {
  return (
    <div className="hidden flex-1 items-center justify-center gap-5 lg:flex xl:gap-7">
      {TOP_LINKS.map((link) => {
        const active = isActive(pathname, link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap rounded-sm text-xs font-medium outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-focus ${
              active ? "text-foreground" : "text-muted hover:text-foreground"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </div>
  );
}

/** Icône dans une pastille (allumée pour la page ouverte), libellé dessous. */
function TabContent({
  icon: Icon,
  label,
  active,
}: {
  icon: ComponentType<LucideProps>;
  label: string;
  active: boolean;
}) {
  return (
    <>
      <span
        className={`flex h-7 w-14 items-center justify-center rounded-full transition ${
          active ? "tab-pop bg-selection text-foreground" : "text-muted group-hover:text-foreground"
        }`}
      >
        <Icon size={20} aria-hidden="true" />
      </span>
      <span className={`max-w-full truncate px-0.5 text-2xs ${active ? "font-medium text-foreground" : "text-muted"}`}>
        {label}
      </span>
    </>
  );
}
