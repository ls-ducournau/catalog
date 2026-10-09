"use client";

import { buttonClass } from "@/components/ui/Button";
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Confirmation d'une action lourde (spec classement-v1 FR-12) : dit ce qui va se passer, le bouton
 * sûr a le focus, Échap et un clic hors de la fenêtre annulent. L'action confirmée garde ensuite
 * sa notification « Annuler ».
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Annuler",
  destructive = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelButton = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement as HTMLElement | null;
    cancelButton.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
      // Les raccourcis des pages n'agissent pas tant que la fenêtre est ouverte.
      if (e.key !== "Tab") e.stopImmediatePropagation();
    }
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      trigger?.focus();
    };
  }, [open, onCancel]);

  if (!open) return null;

  return createPortal(
    <div className="fade-in fixed inset-0 z-[70] flex items-center justify-center bg-overlay px-4" onClick={onCancel}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-description"
        onClick={(e) => e.stopPropagation()}
        className="dialog-in card w-full max-w-sm p-5 shadow-[var(--shadow-raised)]"
      >
        <h2 id="confirm-title" className="text-base text-foreground">
          {title}
        </h2>
        <div id="confirm-description" className="mt-2 text-sm leading-5 text-muted">
          {description}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button ref={cancelButton} type="button" onClick={onCancel} className={buttonClass({ variant: "secondary" })}>
            {cancelLabel}
          </button>
          <button type="button" onClick={onConfirm} className={buttonClass({ variant: destructive ? "danger" : "primary" })}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
