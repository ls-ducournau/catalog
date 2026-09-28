"use client";

import { buttonClass } from "@/components/ui/Button";
import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";
import { prefersReducedMotion } from "@/lib/motion";

/**
 * « Revenir en haut » : apparaît quand une page longue a défilé de plus d'un écran et demi
 * (bibliothèque, sorties, classement), au-dessus de la barre d'onglets sur téléphone.
 */
export function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let frame = 0;
    function onScroll() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setVisible(window.scrollY > window.innerHeight * 1.5));
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <button
      type="button"
      aria-label="Revenir en haut"
      title="Revenir en haut"
      tabIndex={visible ? 0 : -1}
      aria-hidden={!visible}
      onClick={() => window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" })}
      className={`${buttonClass({ variant: "glass", icon: true })} fixed bottom-[calc(1rem+var(--bottom-nav-h))] right-4 z-40 transition-[opacity,transform,background-color] duration-200 ease-out sm:right-6 ${
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0"
      }`}
    >
      <ArrowUp size={16} aria-hidden="true" />
    </button>
  );
}
