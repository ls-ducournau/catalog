"use client";

import type { ComponentPropsWithoutRef, ReactNode, Ref } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Kbd } from "./primitives";

// Saisie — spec: specs/design-system-v2-raycast.md § 5 ; relevé : docs/design-reference/raycast/
// composants/champ-recherche.md.

/**
 * Recherche (Store de Raycast) : champ Onyx à arête, sans loupe, raccourci affiché à droite ; le
 * bas du champ « balaie » pendant une requête (`searching`). Avec `onClear`, une croix remplace
 * le raccourci dès qu'on a tapé quelque chose.
 */
export function SearchField({
  shortcut,
  searching = false,
  onClear,
  className,
  inputClassName,
  ref,
  ...rest
}: Omit<ComponentPropsWithoutRef<"input">, "type"> & {
  shortcut?: string[];
  searching?: boolean;
  onClear?: () => void;
  inputClassName?: string;
  ref?: Ref<HTMLInputElement>;
}) {
  const filled = typeof rest.value === "string" ? rest.value !== "" : false;
  return (
    <label className={cn("field field-search flex items-center gap-2", searching && "is-searching", className)}>
      <input
        ref={ref}
        type="search"
        className={cn("h-full min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted sm:text-sm", inputClassName)}
        {...rest}
      />
      {onClear && filled ? (
        <button
          type="button"
          onClick={onClear}
          aria-label="Effacer la recherche"
          className="-mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted outline-none transition-colors duration-200 hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus"
        >
          <X size={15} aria-hidden="true" />
        </button>
      ) : shortcut && (
        <span aria-hidden="true" className="hidden shrink-0 items-center gap-1.5 sm:flex">
          {shortcut.map((k) => (
            <Kbd key={k}>{k}</Kbd>
          ))}
        </span>
      )}
    </label>
  );
}

/** Puce en lien (navigation dans la page, « Aller au palier ») : même aspect qu'une puce. */
export function ChipLink({ className, ...rest }: ComponentPropsWithoutRef<"a">) {
  return <a className={cn("chip", className)} {...rest} />;
}

/** Puce à bascule (filtre, envie) : `pressed` pour un choix multiple, `checked` dans un groupe radio. */
export function Chip({
  pressed,
  icon,
  children,
  className,
  ...rest
}: Omit<ComponentPropsWithoutRef<"button">, "type"> & {
  pressed?: boolean;
  icon?: ReactNode;
}) {
  return (
    <button type="button" aria-pressed={pressed} className={cn("chip", className)} {...rest}>
      {icon}
      {children}
    </button>
  );
}
