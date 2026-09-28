import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Kbd } from "./primitives";

// Registre « palette de commandes » (DESIGN.md « App Window Mockup ») — spec § 5 et § 6 :
// lignes de liste et barre d'actions au pied d'une fenêtre.

/** Ligne de liste : icône, titre, sous-titre, accessoires à droite ; choisie en blanc 8 %. */
export function ListRow({
  icon,
  title,
  subtitle,
  accessory,
  selected = false,
  className,
  ...rest
}: Omit<ComponentPropsWithoutRef<"button">, "title"> & {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  accessory?: ReactNode;
  selected?: boolean;
}) {
  return (
    <button type="button" aria-current={selected || undefined} className={cn("list-row", selected && "is-selected", className)} {...rest}>
      {icon && <span className="flex shrink-0 items-center text-muted">{icon}</span>}
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{title}</span>
        {subtitle && <span className="list-row-subtitle truncate">{subtitle}</span>}
      </span>
      {accessory && <span className="list-row-accessory">{accessory}</span>}
    </button>
  );
}

export type Action = {
  label: string;
  /** Touches affichées (« ↵ », « ⌘ », « K », « 1 »…). */
  keys?: string[];
  onClick?: () => void;
  disabled?: boolean;
};

/**
 * Barre d'actions : à gauche le contexte (icône et nom), à droite l'action principale et sa
 * touche, puis les actions secondaires, séparées par un filet.
 */
export function ActionBar({
  context,
  primary,
  secondary = [],
  className,
}: {
  context?: ReactNode;
  primary?: Action;
  secondary?: Action[];
  className?: string;
}) {
  const actions = [primary, ...secondary].filter((a): a is Action => Boolean(a));
  return (
    <div className={cn("action-bar", className)}>
      {context && <div className="flex min-w-0 items-center gap-2 truncate">{context}</div>}
      <div className="ml-auto flex items-center gap-1">
        {actions.map((action, i) => (
          <span key={action.label} className="flex items-center gap-1">
            {i > 0 && <span aria-hidden="true" className="divider-vertical mx-1 h-4" />}
            <button type="button" onClick={action.onClick} disabled={action.disabled} className="action-bar-action disabled:opacity-40">
              {action.label}
              {action.keys?.map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
