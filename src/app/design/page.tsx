import type { Metadata } from "next";
import { Clapperboard, Film, Search, Sparkles, Star } from "lucide-react";
import tokens from "../../../design/tokens.json";
import { Logo } from "@/components/brand/Logo";
import {
  ActionBar,
  Avatar,
  Badge,
  Button,
  Card,
  Divider,
  Eyebrow,
  IconCircle,
  Kbd,
  Keycap,
  ListRow,
  MetaRow,
  MonoMeta,
  Skeleton,
  StarCount,
  StarRow,
  StarsReadOnly,
} from "@/components/ui";
import { ScoreBadge } from "@/components/ScoreBadge";
import { CompatibilityChip } from "@/components/CompatibilityChip";
import { BienvenueDemo, ChipDemo, ControlsDemo, FieldDemo, MotionDemo, SwitchDemo } from "./Demos";
import { ArchetypesDemo, SectionsDemo } from "./Archetypes";
import { CompteBoutonVue } from "@/components/CompteBouton";
import { ConnexionForm } from "@/components/ConnexionForm";

export const metadata: Metadata = { title: "Système de design · Catalog" };

// Guide vivant du système de design v2 — spec: specs/design-system-v2-raycast.md § 8.3.
// Tout ce qui s'affiche ici vient des jetons (design/tokens.json) et des primitives
// (src/components/ui) : c'est aussi la cible des captures de référence au pixel (AC-3.1).

type Token = { $value: unknown; $description?: string };
const colors = tokens.role.color as Record<string, Token>;
const primitives = tokens.primitive.color as Record<string, Token>;

function resolve(value: unknown): string {
  const m = typeof value === "string" ? value.match(/^\{primitive\.color\.([^}]+)\}$/) : null;
  if (m) return String(primitives[m[1]].$value);
  return String(value);
}

function luminance(hex: string): number | null {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return null;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(fg: string, bg: string): string | null {
  const a = luminance(fg);
  const b = luminance(bg);
  if (a === null || b === null) return null;
  const [x, y] = [a, b].sort((m, n) => n - m);
  return ((x + 0.05) / (y + 0.05)).toFixed(2);
}

const GROUPS: { title: string; names: string[]; text?: boolean }[] = [
  { title: "Surfaces", names: ["background", "surface", "surface-2", "surface-3", "brand-tint"] },
  { title: "Texte", names: ["foreground", "muted", "subtle", "disabled-foreground"], text: true },
  { title: "Lignes", names: ["border", "card-edge", "field-edge", "line-strong", "divider", "selection", "field"] },
  { title: "Action et marque", names: ["accent", "accent-foreground", "brand", "info", "success"] },
  { title: "Notes et scores", names: ["rating", "score-high", "score-mid", "score-low"] },
];

// Classes écrites en toutes lettres : Tailwind ne génère que celles qu'il lit.
const TYPE: { name: string; className: string; sample: string }[] = [
  { name: "display", className: "font-heading text-display font-semibold text-foreground", sample: "Catalog." },
  { name: "heading-lg", className: "font-heading text-heading-lg font-semibold text-foreground", sample: "Ce soir, un film." },
  { name: "heading", className: "font-heading text-heading font-semibold text-foreground", sample: "Bibliothèque" },
  { name: "heading-sm", className: "font-heading text-heading-sm font-semibold text-foreground", sample: "Le meilleur pour toi" },
  { name: "subheading", className: "font-heading text-subheading font-semibold text-foreground", sample: "Proche de Breaking Bad" },
  { name: "lg", className: "text-lg text-foreground", sample: "Six ans avant de croiser le chemin de Walter White." },
  { name: "base", className: "text-base text-foreground", sample: "Note d'un clic sur les étoiles, ouvre une fiche pour le reste." },
  { name: "sm", className: "text-sm font-medium text-foreground", sample: "Ajouter un titre · Sélectionner" },
  { name: "xs", className: "text-xs font-medium text-muted", sample: "Bibliothèque · Classement · Duels" },
  { name: "eyebrow", className: "eyebrow", sample: "Recommandations" },
];

function Section({ id, title, lead, children }: { id: string; title: string; lead: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-titre`} className="flex flex-col gap-6">
      <div>
        <h2 id={`${id}-titre`} className="text-heading-sm text-foreground">
          {title}
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">{lead}</p>
      </div>
      {children}
    </section>
  );
}

function Swatch({ name, text }: { name: string; text?: boolean }) {
  const token = colors[name];
  const value = resolve(token.$value);
  const ratio = text ? contrast(value, resolve(colors.background.$value)) : null;
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden="true"
        className="h-10 w-10 shrink-0 rounded-lg shadow-[inset_0_0_0_1px_var(--line-strong)]"
        style={{ background: `var(--${name})` }}
      />
      <span className="min-w-0">
        <span className="block truncate text-sm text-foreground">--{name}</span>
        <MonoMeta>
          {value}
          {ratio && ` | ${ratio}:1`}
        </MonoMeta>
      </span>
    </div>
  );
}

function StateLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-2xs text-subtle">{children}</span>;
}

export default function DesignPage() {
  return (
    <main className="frame flex flex-col gap-20 px-4 pb-24 pt-12 sm:px-6">
      <header className="flex flex-col gap-4">
        <Logo className="h-9 w-auto self-start text-foreground" />
        <h1 className="text-heading text-foreground">
          Système de design.<span className="text-muted"> Jetons, primitives et mouvement de Catalog.</span>
        </h1>
        <p className="max-w-2xl text-base text-muted">
          D&apos;après DESIGN.md (Raycast), suivi strictement. Une page compose ces pièces ; elle n&apos;écrit ni
          couleur, ni taille, ni durée.
        </p>
        <MonoMeta>v2 | Inter · Geist Mono | grille de 8 | design/tokens.json</MonoMeta>
      </header>

      <Section id="couleurs" title="Couleurs" lead="98 % de gris. Le corail est une marque (logo, héros, badge IA), jamais un signal. Seules couleurs de l'interface : les notes et les scores. Contraste mesuré sur le fond.">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {GROUPS.map((group) => (
            <div key={group.title} className="flex flex-col gap-3">
              <Eyebrow>{group.title}</Eyebrow>
              {group.names.map((name) => (
                <Swatch key={name} name={name} text={group.text} />
              ))}
            </div>
          ))}
        </div>
      </Section>

      <Section id="typographie" title="Typographie" lead="Titres en Bricolage Grotesque 600 (taille optique automatique) ; texte en Inter 400, 500, 600 ; interlettrage positif, jamais négatif ; plancher de 12 px.">
        <div className="flex flex-col divide-y divide-divider">
          {TYPE.map((t) => (
            <div key={t.name} className="flex flex-col gap-1 py-4 sm:flex-row sm:items-baseline sm:gap-6">
              <MonoMeta className="w-28 shrink-0">text-{t.name}</MonoMeta>
              <span className={t.className}>{t.sample}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section id="relief" title="Forme et relief" lead="Rayons 6, 8, 11, 12, 20 ; les cartes sont définies par leur arête (blanc 6 %) et un reflet haut, sans ombre portée. Le relief « touche » est celui du bouton sombre.">
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {[
            ["badge", "6"],
            ["control", "8"],
            ["key", "11"],
            ["frame", "12"],
            ["card", "12"],
            ["card-lg", "20"],
          ].map(([name, px]) => (
            <div key={name} className="flex flex-col items-center gap-2">
              <span className="h-16 w-full border border-card-edge bg-surface shadow-[var(--shadow-card)]" style={{ borderRadius: `var(--r-${name})` }} />
              <MonoMeta>
                {name} | {px}
              </MonoMeta>
            </div>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Card className="p-6">
            <p className="text-sm text-foreground">Carte</p>
            <p className="mt-1 text-sm text-muted">Onyx, arête --card-edge (blanc 6 %), reflet --shadow-card ; cliquable, lueur venue du haut au survol.</p>
          </Card>
          <Card variant="edge" className="p-6">
            <p className="text-sm text-foreground">Carte à arête</p>
            <p className="mt-1 text-sm text-muted">Arête --card-edge et reflet intérieur, transparente, rayon 20.</p>
          </Card>
          <Card variant="tile" className="p-6">
            <p className="text-sm text-foreground">Tuile</p>
            <p className="mt-1 text-sm text-muted">{"La carte en ligne (icône, nom, précision) ; s'enfonce à l'appui."}</p>
          </Card>
        </div>
      </Section>

      <Section id="boutons" title="Boutons" lead="Un seul bouton plein (Mist, texte Slate, cerne et halo). Le secondaire est la « touche » sombre : voile blanc, anneau discret (12 %, 20 % au survol). Focus clavier : anneau blanc à 40 %, décalé. Aucun bouton de couleur, même pour effacer.">
        <div className="flex flex-col gap-6">
          {(["primary", "secondary", "ghost"] as const).map((variant) => (
            <div key={variant} className="flex flex-wrap items-center gap-4">
              <MonoMeta className="w-24">{variant}</MonoMeta>
              {(
                [
                  ["repos", ""],
                  ["survol", "is-hover"],
                  ["focus", "is-focus"],
                  ["appui", "is-active"],
                ] as const
              ).map(([label, state]) => (
                <span key={label} className="flex flex-col items-center gap-1.5">
                  <Button variant={variant} className={state}>
                    <Film size={14} aria-hidden="true" />
                    Je regarde ça
                  </Button>
                  <StateLabel>{label}</StateLabel>
                </span>
              ))}
              <span className="flex flex-col items-center gap-1.5">
                <Button variant={variant} disabled>
                  Désactivé
                </Button>
                <StateLabel>désactivé</StateLabel>
              </span>
              <span className="flex flex-col items-center gap-1.5">
                <Button variant={variant} loading>
                  Chargement
                </Button>
                <StateLabel>chargement</StateLabel>
              </span>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-4">
            <MonoMeta className="w-24">tailles</MonoMeta>
            <Button variant="primary" size="sm">
              Petit
            </Button>
            <Button variant="primary">Moyen</Button>
            <Button variant="primary" size="lg">
              Grand
            </Button>
            <Button variant="secondary" icon aria-label="Rechercher">
              <Search size={15} aria-hidden="true" />
            </Button>
            <span className="relative flex h-16 w-28 items-center justify-center overflow-hidden rounded-frame bg-surface-3">
              <Button variant="overlay" icon size="sm" aria-label="Bande-annonce">
                <Clapperboard size={14} aria-hidden="true" />
              </Button>
            </span>
            <Button variant="glass" icon aria-label="Plus">
              <Sparkles size={15} aria-hidden="true" />
            </Button>
          </div>
        </div>
      </Section>

      <Section id="petits" title="Badges, touches, métadonnées" lead="Badges en lavis (15 % de la couleur du texte) ; le badge de marque est le seul en corail. Mentions techniques en Geist Mono.">
        <div className="flex flex-wrap items-center gap-3">
          <Badge>Dans ta pile</Badge>
          <Badge>VF</Badge>
          <Badge variant="success">Cette semaine</Badge>
          <Badge variant="count">43</Badge>
          <Badge variant="brand">v2.5</Badge>
          <Kbd>↵</Kbd>
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
          <Keycap>1</Keycap>
          <Keycap pressed>2</Keycap>
          <Keycap>3</Keycap>
        </div>
        <MetaRow>
          <span>2015</span>
          <span>Série</span>
          <span className="text-foreground">81 % compatible</span>
          <span>Sur Netflix</span>
        </MetaRow>
        <MonoMeta>1066 titres | 533 notés | TMDB | JustWatch</MonoMeta>
        <div className="flex items-center gap-4">
          <Avatar name="Vince Gilligan" />
          <Avatar name="Bob Odenkirk" size={48} />
          <IconCircle>
            <Star size={18} aria-hidden="true" />
          </IconCircle>
        </div>
        <Divider />
      </Section>

      <Section
        id="notes"
        title="Notes et scores"
        lead="Seules couleurs de l'interface : l'étoile, toujours la même, pleine en jaune ; le score, vert dès 70, jaune de 40 à 69, gris dessous. Le chiffre reste toujours affiché."
      >
        <div className="flex flex-wrap items-center gap-6">
          <StarsReadOnly rating="⭐️⭐️⭐️" />
          <StarRow count={5} size={18} />
          <StarCount value={4} />
          <StarCount value="4,2" size={12} />
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <ScoreBadge voteAverage={8.7} voteCount={5200} size="md" />
          <ScoreBadge voteAverage={5.6} voteCount={900} size="md" />
          <ScoreBadge voteAverage={3.1} voteCount={40} size="md" />
          <CompatibilityChip value={0.81} />
          <CompatibilityChip value={0.52} />
          <CompatibilityChip value={0.28} />
        </div>
      </Section>

      <Section id="controles" title="Contrôles" lead="Puces, onglets, menus, champs et interrupteurs : les mêmes états partout.">
        <ChipDemo />
        <ControlsDemo />
        <FieldDemo />
        <SwitchDemo />
      </Section>

      <Section id="fenetre" title="Fenêtre de commande" lead="Le registre produit de Raycast : liste, détail, barre d'actions et ses touches.">
        <div className="bezel max-w-2xl">
          <div className="bezel-inner">
            <div className="flex items-center gap-2 px-4 py-3">
              <Search size={16} aria-hidden="true" className="text-muted" />
              <span className="text-base text-muted">Rechercher un titre…</span>
            </div>
            <Divider />
            <div className="flex flex-col gap-0.5 p-2" role="list">
              <ListRow
                selected
                icon={<Film size={16} aria-hidden="true" />}
                title="Better Call Saul"
                subtitle="2015 · Série"
                accessory={<Badge>Dans ta pile</Badge>}
              />
              <ListRow icon={<Film size={16} aria-hidden="true" />} title="Peaky Blinders" subtitle="2013 · Série" accessory="80 %" />
              <ListRow icon={<Film size={16} aria-hidden="true" />} title="The Last Kingdom" subtitle="2015 · Série" accessory="77 %" />
            </div>
            <ActionBar
              context={
                <>
                  <Logo variant="mark" title={null} className="size-4" />
                  <span>Ajouter un titre</span>
                </>
              }
              primary={{ label: "Ajouter", keys: ["↵"] }}
              secondary={[{ label: "Actions", keys: ["⌘", "K"] }]}
            />
          </div>
        </div>
        <div role="status" className="toast self-start">
          <span>3 « J&apos;aime » réinitialisés</span>
          <Button variant="primary" size="sm">
            Annuler
          </Button>
        </div>
        <div className="grid max-w-md grid-cols-3 gap-3">
          <Skeleton className="aspect-[2/3]" />
          <Skeleton className="aspect-[2/3]" />
          <Skeleton className="aspect-[2/3]" />
        </div>
      </Section>

      <Section id="compte" title="Compte" lead="En ligne seulement. Dans la barre du haut : « Tester » pour un visiteur, « Garder mon compte » pour un invité qui a des titres, puis l'initiale du compte. La page /connexion pose la fenêtre de commande sur le héros, comme les Duels.">
        <div className="flex flex-wrap items-center gap-3">
          <CompteBoutonVue etat={{ connecte: false, anonyme: false, email: null }} visiteur />
          <CompteBoutonVue etat={{ connecte: true, anonyme: true, email: null }} />
          <CompteBoutonVue etat={{ connecte: true, anonyme: false, email: "louis@exemple.fr" }} />
        </div>
        <div className="mt-6 grid max-w-3xl items-start gap-6 md:grid-cols-2">
          <ConnexionForm retour="/design" demo={{ connecte: true, anonyme: true, email: null }} />
          <ConnexionForm retour="/design" demo={{ connecte: true, anonyme: false, email: "louis@exemple.fr" }} />
        </div>
      </Section>

      <Section id="bienvenue" title="Bienvenue" lead="Le paquet de cartes : → ça me tente, ← pas pour moi, ↑ déjà vu puis une note ; un tap retourne la carte. La jauge : titres et notes, puis le prochain palier.">
        <BienvenueDemo />
      </Section>

      <Section id="sections" title="Sections" lead="Blocs réutilisables relevés sur raycast.com ; un archétype les assemble.">
        <SectionsDemo />
      </Section>

      <Section id="archetypes" title="Archétypes" lead="Chaque vue en importe un seul : il pose la largeur, les marges, le rythme et le haut de page.">
        <ArchetypesDemo />
      </Section>

      <Section id="mouvement" title="Mouvement" lead="Registre productif : 100 à 400 ms, courbe out (0.23, 1, 0.32, 1), aucun dépassement ni ressort.">
        <MotionDemo />
      </Section>
    </main>
  );
}
