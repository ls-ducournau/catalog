import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge ne connaît que l'échelle par défaut : on lui déclare celles des jetons
 * (design/tokens.json), pour que `cn("rounded-md", "rounded-card")` garde la seconde et que
 * `cn("text-sm", "text-heading")` ne garde pas les deux.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      radius: ["badge", "control", "key", "frame", "card", "card-lg"],
      text: ["2xs", "eyebrow", "body", "subheading", "heading-sm", "heading", "heading-lg", "display"],
      color: [
        "background",
        "panel",
        "surface",
        "surface-raised",
        "surface-2",
        "surface-3",
        "surface-hover",
        "card-hover",
        "field",
        "foreground",
        "body",
        "muted",
        "muted-hover",
        "subtle",
        "disabled-foreground",
        "surface-border",
        "popover-border",
        "input",
        "border",
        "line",
        "line-strong",
        "divider",
        "selection",
        "focus",
        "focus-ring",
        "accent",
        "accent-foreground",
        "contrast-subtle",
        "contrast-border",
        "contrast-foreground",
        "contrast-foreground-subtle",
        "overlay",
        "skeleton",
        "brand",
        "brand-tint",
        "info",
        "success",
      ],
    },
  },
});

/** Assemble des classes Tailwind sans doublons contradictoires (convention shadcn, requise par Bklit). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
