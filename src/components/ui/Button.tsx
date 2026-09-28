import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Bouton — spec: specs/design-system-v2-raycast.md § 5 (DESIGN.md « Neutral Filled Button »).
 *
 * - `primary` : la seule surface pleine, Mist au texte Iron. Une par vue, pour l'action principale.
 * - `secondary` : le relief « touche de clavier ». Actions de second rang.
 * - `ghost` : texte Ash, blanc au survol. Actions discrètes, barres d'outils.
 * - `glass` : sur le contenu (revenir en haut, flèches de rangée). `overlay` : sur une affiche.
 * - `danger` : même aspect que `primary` (aucun bouton de couleur) ; le libellé dit l'action.
 *
 * Rendu en lien quand `href` est donné (lien interne, ou externe avec `external`).
 */
export const buttonVariants = cva("btn", {
  variants: {
    variant: {
      primary: "btn-primary",
      secondary: "btn-secondary",
      ghost: "btn-ghost",
      glass: "btn-glass",
      overlay: "btn-overlay",
      danger: "btn-danger",
    },
    size: { sm: "btn-sm", md: "", lg: "btn-lg" },
    icon: { true: "btn-icon", false: "" },
  },
  defaultVariants: { variant: "secondary", size: "md", icon: false },
});

type Variants = VariantProps<typeof buttonVariants>;

/** Classes d'un bouton, pour un élément qui ne peut pas être <Button> (poignée, étiquette). */
export function buttonClass(variants: Variants & { className?: string } = {}): string {
  const { className, ...rest } = variants;
  return cn(buttonVariants(rest), className);
}

type Common = Variants & {
  className?: string;
  children?: ReactNode;
  /** Occupé : désactivé, indicateur de chargement, `aria-busy`. */
  loading?: boolean;
};

type AsButton = Common &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children"> & {
    href?: undefined;
    ref?: Ref<HTMLButtonElement>;
  };

type AsLink = Common &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "children" | "href"> & {
    href: string;
    /** Ouvre dans un nouvel onglet (site externe). */
    external?: boolean;
    ref?: Ref<HTMLAnchorElement>;
  };

export function Button(props: AsButton | AsLink) {
  if (props.href !== undefined) {
    const { variant, size, icon, className, children, loading, external, href, ...rest } = props;
    const classes = buttonClass({ variant, size, icon, className });
    const content = (
      <>
        {loading && <Loader2 size={14} aria-hidden="true" className="animate-spin" />}
        {children}
      </>
    );
    if (external) {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className={classes} aria-busy={loading || undefined} {...rest}>
          {content}
        </a>
      );
    }
    return (
      <Link href={href} className={classes} aria-busy={loading || undefined} {...rest}>
        {content}
      </Link>
    );
  }
  const { variant, size, icon, className, children, loading, disabled, type = "button", ...rest } = props;
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass({ variant, size, icon, className })}
      {...rest}
    >
      {loading && <Loader2 size={14} aria-hidden="true" className="animate-spin" />}
      {children}
    </button>
  );
}
