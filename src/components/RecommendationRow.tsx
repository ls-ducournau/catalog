"use client";

import { buttonClass } from "@/components/ui/Button";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Une rangée expliquée (spec recommendations-v1 FR-32) : un titre qui dit pourquoi, puis des
 * cartes qui défilent horizontalement, aimantées carte par carte. Sur ordinateur, deux flèches
 * avancent d'un écran ; les bords s'estompent quand il reste de quoi défiler.
 */
export function RecommendationRow({ title, children }: { title: string; children: ReactNode }) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  function measure() {
    const el = scroller.current;
    if (!el) return;
    setEdges({
      start: el.scrollLeft > 4,
      end: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
    });
  }

  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  function page(direction: 1 | -1) {
    const el = scroller.current;
    if (!el) return;
    // Un écran moins une carte : la dernière carte visible reste en repère.
    el.scrollBy({ left: direction * el.clientWidth * 0.85, behavior: "smooth" });
  }

  return (
    <section className="mt-8 first:mt-6" aria-label={title}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-medium text-foreground">{title}</h2>
        <div className="hidden items-center gap-1 [@media(hover:hover)]:flex">
          <button
            onClick={() => page(-1)}
            disabled={!edges.start}
            aria-label={`${title} : précédents`}
            className={buttonClass({ variant: "glass", icon: true })}
          >
            <ChevronLeft size={15} />
          </button>
          <button
            onClick={() => page(1)}
            disabled={!edges.end}
            aria-label={`${title} : suivants`}
            className={buttonClass({ variant: "glass", icon: true })}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </div>

      <div className="relative mt-3">
        <div
          ref={scroller}
          data-stagger
          onScroll={measure}
          className="scroll-row -mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2 sm:gap-4"
        >
          {children}
        </div>
        {/* Bords estompés : ils disent qu'il y a de la suite, sans rien masquer d'utile. */}
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-background to-transparent transition-opacity ${
            edges.start ? "opacity-100" : "opacity-0"
          }`}
        />
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent transition-opacity ${
            edges.end ? "opacity-100" : "opacity-0"
          }`}
        />
      </div>
    </section>
  );
}
