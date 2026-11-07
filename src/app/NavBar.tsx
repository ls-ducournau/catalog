"use client";

import { useCallback, useEffect, useRef, useState, type ComponentType, type CSSProperties } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowRight,
  ChevronDown,
  Plus,
  CalendarDays,
  Ellipsis,
  Layers,
  Library,
  ListVideo,
  Popcorn,
  Sparkles,
  Swords,
  Trophy,
  type LucideProps,
} from "lucide-react";
import { CompteBouton } from "@/components/CompteBouton";
import { SettingsMenu } from "@/components/SettingsMenu";
import { Logo } from "@/components/brand/Logo";
import { versVisite } from "@/lib/visite";
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
  { href: "/playlists", label: "Playlists", icon: ListVideo, primary: false, hint: "Tes listes, faites à la main" },
  { href: "/duels", label: "Duels", icon: Swords, primary: false, hint: "Deux titres, tu gardes ton préféré" },
  { href: "/tri", label: "Tri rapide", icon: Layers, primary: true },
  { href: "/recommendations", label: "Recommandations", short: "Recos", icon: Sparkles, primary: true },
  { href: "/sorties", label: "Sorties", icon: CalendarDays, primary: false, hint: "Ce qui arrive au ciné et en séries" },
  { href: "/ce-soir", label: "Ce soir", icon: Popcorn, primary: true },
];

const OVERFLOW_LINKS = NAV_LINKS.filter((link) => !link.primary);

/** Demande à la bibliothèque, déjà ouverte, d'ouvrir sa fenêtre d'ajout. */
export const ADD_TITLE_EVENT = "catalog:ajouter-un-titre";

type MenuEntry = { href: string; label: string; hint: string };
type Menu = {
  key: string;
  label: string;
  entries: MenuEntry[];
  feature: { href: string; icon: ComponentType<LucideProps>; title: string; text: string };
  footer: { strong: string; rest: string; href: string; cta: string };
};

/**
 * Barre du haut (ordinateur), rangée par intention (décision de l'utilisateur, 2026-09-28) :
 * ce que tu as, ce que tu vas regarder, ce qui apprend tes goûts. Duels et Tri rapide sont des
 * gestes : chaque entrée ouvre le mode qui sert l'intention du menu. « Ce soir » reste le bouton
 * d'action, à droite.
 */
const MENUS: Menu[] = [
  {
    key: "collection",
    label: "Ta collection",
    entries: [
      { href: "/library", label: "Bibliothèque", hint: "Ce que tu as vu, ce que tu veux voir" },
      { href: "/classement", label: "Classement", hint: "Tes titres rangés, note par note" },
      { href: "/playlists", label: "Playlists", hint: "Tes listes, dans l'ordre où tu veux les voir" },
      { href: "/classement?vue=personnes", label: "Personnes", hint: "Les actrices, acteurs et cinéastes que tu aimes" },
    ],
    feature: {
      href: "/library",
      icon: Library,
      title: "Toute ta vidéothèque, à ton goût.",
      text: "Note d'un clic, change le statut depuis l'affiche, ouvre une fiche pour le reste.",
    },
    footer: { strong: "Tout ce que tu as vu", rest: "et tout ce qui t'attend", href: "/library", cta: "Ouvrir la bibliothèque" },
  },
  {
    key: "discover",
    label: "Découvrir",
    entries: [
      { href: "/recommendations", label: "Recommandations", hint: "Ta pile, dans le bon ordre" },
      { href: "/sorties", label: "Sorties", hint: "Ce qui arrive au ciné et en séries" },
      { href: "/tri?famille=unseen", label: "Tri rapide", hint: "Une carte à la fois : ça te tente ?" },
    ],
    feature: {
      href: "/ce-soir",
      icon: Popcorn,
      title: "Ce soir, un titre pour toi.",
      text: "Une envie, une durée, avec qui : Catalog choisit parmi ce qui te plaira le plus.",
    },
    footer: { strong: "Quoi regarder ensuite", rest: "selon tes goûts et tes abonnements", href: "/ce-soir", cta: "Ce soir" },
  },
  {
    key: "taste",
    label: "Tes goûts",
    entries: [
      { href: "/duels", label: "Duels", hint: "Deux titres, tu gardes ton préféré" },
      { href: "/duels?mode=tier", label: "Départage", hint: "Des titres de même note, rangés entre eux" },
      { href: "/tri?famille=seen", label: "Noter tes titres vus", hint: "Une carte, une note, la suivante" },
      { href: "/tri?famille=person&mode=noter", label: "Noter les personnes", hint: "Celles que tu aimes, une note à la fois" },
    ],
    feature: {
      href: "/recommendations",
      icon: Sparkles,
      title: "Plus tu réponds, mieux il te connaît.",
      text: "Chaque duel, chaque note affine ton profil de goûts et tes recommandations.",
    },
    footer: { strong: "Ton profil de goûts", rest: "appris de chacun de tes avis", href: "/recommendations", cta: "Voir tes recommandations" },
  },
];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function NavBar({ visiteur = false }: { visiteur?: boolean }) {
  // Un visiteur découvre chaque partie dans la visite (specs/visite-interactive-v1.md), pas sur une page vide.
  const lien = (href: string) => (visiteur ? versVisite(href) : href);
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
      {/* Barre de raycast.com (docs/design-reference/raycast/composants/barre-navigation.md) :
          verre sombre flottant, rayon 16, 76 de haut dès 1024 px (48 sur téléphone et tablette).
          Logo à gauche, liens au centre (Ash, blancs au survol et pour la page ouverte),
          réglages, « Ajouter » et l'action principale « Ce soir » à droite. */}
      <header className="sticky top-0 z-40 pt-3 lg:pt-4">
        <div className="frame px-4 sm:px-6">
          <nav aria-label="Navigation principale" className="nav-glass relative flex h-12 items-center gap-4 pl-3 pr-2 lg:h-19 lg:px-8">
            <Link href="/" aria-label="Catalog, accueil" className="flex shrink-0 items-center rounded-md text-foreground">
              <Logo className="h-7 w-auto" title="Catalog, accueil" />
            </Link>
            {/* Les menus ne tiennent qu'à partir de 1024 px : en dessous, la barre d'onglets du bas
                prend le relais. */}
            {/* Un visiteur n'a pas encore de collection ni de goûts : pas de menus de l'application
                (décision de Louis, 2026-11-06). */}
            {!visiteur && <TopMenus pathname={pathname} lien={lien} />}
            <div className="ml-auto flex items-center gap-2">
              {/* En ligne seulement : « Se connecter », ou l'initiale du compte. */}
              <CompteBouton />
              {/* Un visiteur n'a ni réglages ni bibliothèque où ajouter (décision de Louis, 2026-11-06). */}
              {!visiteur && <SettingsMenu />}
              {/* Ajouter un titre, depuis n'importe quelle page : la fenêtre d'ajout de la
                  bibliothèque s'ouvre (sur place si on y est déjà). */}
              {!visiteur && (
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
                  className="max-xl:btn-icon"
                >
                  <Plus size={15} aria-hidden="true" />
                  <span className="hidden xl:inline">Ajouter</span>
                </Button>
              )}
              {visiteur ? (
                <Button href="/visite" aria-current={pathname === "/visite" ? "page" : undefined} variant="primary">
                  Fais le tour
                </Button>
              ) : (
                <Button
                  href="/ce-soir"
                  aria-current={isActive(pathname, "/ce-soir") ? "page" : undefined}
                  variant="primary"
                  className="hidden lg:inline-flex"
                >
                  <Popcorn size={15} aria-hidden="true" />
                  Ce soir
                </Button>
              )}
            </div>
          </nav>
        </div>
      </header>

      {/* Barre d'onglets, au pouce : téléphone et tablette. Sur téléphone, quatre onglets et
          « Plus » ; sur tablette, les sept. Sa hauteur est réservée en bas de page
          (--bottom-nav-h, globals.css). */}
      {!visiteur && (
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
                    href={lien(link.href)}
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
      )}

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
                      href={lien(link.href)}
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

/** Une entrée est ouverte quand l'adresse correspond, paramètres compris (Départage, familles du Tri). */
function entryActive(pathname: string, search: string, href: string): boolean {
  const [path, query] = href.split("?");
  if (!isActive(pathname, path)) return false;
  if (!query) return true;
  const wanted = new URLSearchParams(query);
  const current = new URLSearchParams(search);
  return [...wanted].every(([k, v]) => current.get(k) === v);
}

/**
 * Menus de la barre du haut (ordinateur) : un déclencheur par intention, ouvert au survol, au clic
 * ou au clavier ; le panneau (deux colonnes d'entrées, une carte mise en avant, un pied) se pose
 * sous la barre. Échap le ferme, comme un clic ailleurs ou un changement de page.
 */
function TopMenus({ pathname, lien }: { pathname: string; lien: (href: string) => string }) {
  const [open, setOpen] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrap = useRef<HTMLDivElement | null>(null);
  const triggers = useRef(new Map<string, HTMLButtonElement>());

  const schedule = useCallback((next: string | null) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(next), next ? 80 : 160);
  }, []);

  // Nouvelle page : le menu se ferme, l'entrée ouverte se met à jour.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(null);
    setSearch(window.location.search);
  }, [pathname]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      const key = open;
      setOpen(null);
      if (key) triggers.current.get(key)?.focus();
    }
    function onPointer(e: PointerEvent) {
      if (!wrap.current?.contains(e.target as Node)) setOpen(null);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  // Le menu de la page ouverte : celui dont une entrée correspond à l'adresse, paramètres compris
  // (le Tri rapide « à découvrir » est dans Découvrir, « déjà vus » dans Tes goûts) ; à défaut, le
  // premier qui contient la page.
  const activeMenu =
    MENUS.find((m) => m.entries.some((e) => e.href.includes("?") && entryActive(pathname, search, e.href))) ??
    MENUS.find((m) => m.entries.some((e) => isActive(pathname, e.href.split("?")[0])));

  return (
    <div ref={wrap} className="hidden flex-1 items-center justify-center gap-2 lg:flex xl:gap-4" onMouseLeave={() => schedule(null)}>
      {MENUS.map((menu) => {
        const isOpen = open === menu.key;
        const active = menu === activeMenu;
        const panelId = `menu-${menu.key}`;
        const Feature = menu.feature.icon;
        return (
          <div key={menu.key} onMouseEnter={() => schedule(menu.key)}>
            <button
              ref={(el) => {
                if (el) triggers.current.set(menu.key, el);
              }}
              type="button"
              aria-expanded={isOpen}
              aria-controls={panelId}
              data-active={active || undefined}
              onClick={() => {
                if (timer.current) clearTimeout(timer.current);
                setOpen(isOpen ? null : menu.key);
              }}
              className="nav-trigger"
            >
              {menu.label}
              <ChevronDown size={14} aria-hidden="true" />
            </button>
            {isOpen && (
              <div
                id={panelId}
                className="mega-panel menu-pop absolute left-1/2 top-full z-50 mt-3 w-[min(50rem,calc(100vw-2rem))] -translate-x-1/2"
                style={{ "--menu-origin": "top center" } as CSSProperties}
              >
                <div className="grid grid-cols-[minmax(0,1fr)_15rem] gap-3 p-3">
                  <ul className="grid grid-cols-2 content-start gap-1">
                    {menu.entries.map((entry) => (
                      <li key={entry.href}>
                        <Link
                          href={lien(entry.href)}
                          aria-current={entryActive(pathname, search, entry.href) ? "page" : undefined}
                          onClick={() => setOpen(null)}
                          className="mega-item"
                        >
                          <span className="text-sm font-medium text-foreground">{entry.label}</span>
                          <span className="text-xs text-muted">{entry.hint}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <Link href={lien(menu.feature.href)} onClick={() => setOpen(null)} className="mega-feature">
                    <span aria-hidden="true" className="shards relative flex h-24 items-center justify-center">
                      <span className="icon-circle relative z-10 size-11">
                        <Feature size={20} />
                      </span>
                    </span>
                    <span className="flex flex-col gap-1 p-3">
                      <span className="font-heading text-sm font-semibold text-foreground">{menu.feature.title}</span>
                      <span className="text-xs text-muted">{menu.feature.text}</span>
                    </span>
                  </Link>
                </div>
                <div className="flex items-center justify-between gap-4 border-t border-divider px-5 py-3">
                  <p className="text-sm">
                    <span className="font-medium text-foreground">{menu.footer.strong}</span>{" "}
                    <span className="text-muted">{menu.footer.rest}</span>
                  </p>
                  <Link href={lien(menu.footer.href)} onClick={() => setOpen(null)} className="arrow-link text-sm">
                    {menu.footer.cta}
                    <ArrowRight size={14} aria-hidden="true" />
                  </Link>
                </div>
              </div>
            )}
          </div>
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
