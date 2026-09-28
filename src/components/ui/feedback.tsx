"use client";

import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./Button";

// Retours — spec: specs/design-system-v2-raycast.md § 5 : infobulle et notification.

/**
 * Infobulle : pastille sombre qui apparaît au survol et au focus clavier de son déclencheur,
 * annoncée par `aria-describedby` (le « dock » de Raycast).
 */
export function Tooltip({
  label,
  children,
  side = "top",
  className,
}: {
  label: string;
  children: (describedBy: string) => ReactNode;
  side?: "top" | "bottom";
  className?: string;
}) {
  const id = useId();
  return (
    <span className={cn("group/tooltip relative inline-flex", className)}>
      {children(id)}
      <span
        id={id}
        role="tooltip"
        className={cn(
          "tooltip pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 opacity-0 transition-opacity duration-150",
          "group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100",
          side === "top" ? "bottom-full mb-2" : "top-full mt-2"
        )}
      >
        {label}
      </span>
    </span>
  );
}

/**
 * Notification flottante, posée au-dessus de la barre d'onglets du bas. Une action (« Annuler »
 * le plus souvent) ou plusieurs (`actions`) ; `role="status"` : annoncée sans voler le focus.
 */
export function Toast({
  children,
  action,
  onAction,
  actions,
  className,
}: {
  children: ReactNode;
  action?: string;
  onAction?: () => void;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className="fixed inset-x-0 bottom-[calc(1.5rem+var(--bottom-nav-h))] z-50 flex justify-center px-6">
      <div role="status" className={cn("toast toast-in", className)}>
        <span className="min-w-0">{children}</span>
        {action && (
          <Button variant="primary" size="sm" onClick={onAction}>
            {action}
          </Button>
        )}
        {actions && <span className="flex flex-wrap items-center gap-1.5">{actions}</span>}
      </div>
    </div>
  );
}
