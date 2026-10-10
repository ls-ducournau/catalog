import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";
import { cn } from "@/lib/utils";

// Primitives de présentation — spec: specs/design-system-v2-raycast.md § 5.
// Chacune pose une recette de globals.css (@layer components) ; aucune couleur ni taille ici.

/**
 * Badge (DESIGN.md « Badge Tag ») : Graphite. `success` : lavis vert de mise en valeur (le libellé
 * dit l'information). `brand` : le seul badge en corail (marque).
 */
export function Badge({
  variant = "neutral",
  className,
  ...rest
}: ComponentPropsWithoutRef<"span"> & { variant?: "neutral" | "success" | "brand" | "count" }) {
  return (
    <span
      className={cn(
        "badge",
        variant === "success" && "badge-success",
        variant === "brand" && "badge-brand",
        variant === "count" && "badge-count",
        className
      )}
      {...rest}
    />
  );
}

/** Touche de raccourci (barres d'action, aides clavier). */
export function Kbd({ className, ...rest }: ComponentPropsWithoutRef<"kbd">) {
  return <kbd className={cn("kbd", className)} {...rest} />;
}

/** Grande touche (duels, tri) : s'enfonce quand `pressed`. */
export function Keycap({ pressed = false, className, ...rest }: ComponentPropsWithoutRef<"kbd"> & { pressed?: boolean }) {
  return <kbd data-pressed={pressed || undefined} className={cn("keycap", className)} {...rest} />;
}

type CardProps<T extends ElementType> = {
  as?: T;
  /** `key` : relief « touche » ; `edge` : carte à arête ; `tile` : tuile d'extension. */
  variant?: "key" | "edge" | "tile";
  className?: string;
  children?: ReactNode;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "className" | "children">;

export function Card<T extends ElementType = "div">({ as, variant = "key", className, ...rest }: CardProps<T>) {
  const Tag = (as ?? "div") as ElementType;
  return <Tag className={cn(variant === "key" ? "card" : variant === "edge" ? "panel" : "card-soft", className)} {...rest} />;
}

/** Conteneur d'icône rond (DESIGN.md « Circular Icon Container »). */
export function IconCircle({ size = 40, className, style, ...rest }: ComponentPropsWithoutRef<"span"> & { size?: number }) {
  return <span className={cn("icon-circle", className)} style={{ width: size, height: size, ...style }} {...rest} />;
}

/** Ligne de métadonnées : éléments séparés par un filet vertical. */
/**
 * Ligne de métadonnées, séparées par un filet (audit UX 2026-10-09, W2-2 : le point médian est
 * réservé aux phrases). `items` : les éléments, les vides sont ignorés ; sinon, `children`.
 */
export function MetaRow({
  className,
  items,
  children,
  as: Tag = "div",
  ...rest
}: ComponentPropsWithoutRef<"div"> & {
  items?: (ReactNode | null | false | undefined)[];
  /** `span` dans un bouton, où un `div` n'est pas permis. */
  as?: "div" | "span";
}) {
  return (
    <Tag className={cn("meta-row", className)} {...rest}>
      {items ? items.filter(Boolean).map((item, i) => <span key={i}>{item}</span>) : children}
    </Tag>
  );
}

/** Mentions techniques en Geist Mono (versions, sources, compteurs). */
export function MonoMeta({ className, ...rest }: ComponentPropsWithoutRef<"span">) {
  return <span className={cn("mono-meta", className)} {...rest} />;
}

export function Eyebrow({ className, ...rest }: ComponentPropsWithoutRef<"p">) {
  return <p className={cn("eyebrow", className)} {...rest} />;
}

export function Divider({ vertical = false, className }: { vertical?: boolean; className?: string }) {
  return <span role="separator" aria-orientation={vertical ? "vertical" : "horizontal"} className={cn(vertical ? "divider-vertical" : "divider block", className)} />;
}

/** Avatar rond : image, sinon initiales. */
export function Avatar({
  src,
  name,
  size = 32,
  className,
}: {
  src?: string | null;
  name: string;
  size?: number;
  className?: string;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return (
    <span className={cn("avatar", className)} style={{ width: size, height: size, fontSize: Math.max(12, Math.round(size * 0.38)) }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src ? <img src={src} alt="" loading="lazy" /> : <span aria-hidden="true">{initials}</span>}
    </span>
  );
}

/** Squelette de chargement, à reflet. */
export function Skeleton({ className, ...rest }: ComponentPropsWithoutRef<"div">) {
  return <div aria-hidden="true" className={cn("shimmer rounded-md bg-skeleton", className)} {...rest} />;
}

/** Interrupteur (rôle `switch`). */
export function Switch({
  checked,
  onChange,
  label,
  className,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn("switch disabled:opacity-40", className)}
    />
  );
}
