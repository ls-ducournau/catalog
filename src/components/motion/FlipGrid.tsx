"use client";

import { Component, createElement, type CSSProperties, type ReactNode } from "react";
import { DURATION, EASE, FLIP, Flip, gsap, prefersReducedMotion } from "@/lib/motion";

// Réorganisation fluide (FLIP) — spec: specs/design-system-v2-raycast.md (§ 4.2, règle 5)
//
// Quand un filtre ou un tri change le contenu d'une grille, les affiches qui restent glissent vers
// leur nouvelle place (400 ms, sans dépassement) et les nouvelles apparaissent en fondu. Composant de
// classe : getSnapshotBeforeUpdate() est le seul moment où React laisse mesurer l'ancienne mise en
// page, juste avant de la remplacer (Flip.getState), puis componentDidUpdate() anime (Flip.from).
// Les enfants directs portent `data-flip-id` (identifiant stable du titre).

type Props = {
  as?: "div" | "ol" | "ul";
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  /** Au-delà, pas d'animation : mesurer des centaines d'éléments à chaque changement coûte trop. */
  max?: number;
  /** Laisse MotionRoot animer l'apparition de la grille. */
  stagger?: boolean;
};

type Snapshot = ReturnType<typeof Flip.getState> | null;

export class FlipGrid extends Component<Props> {
  private root: HTMLElement | null = null;

  private items(): HTMLElement[] {
    if (!this.root) return [];
    return Array.from(this.root.children).filter((c): c is HTMLElement => c instanceof HTMLElement && !!c.dataset.flipId);
  }

  getSnapshotBeforeUpdate(): Snapshot {
    if (prefersReducedMotion()) return null;
    const items = this.items();
    if (items.length === 0 || items.length > (this.props.max ?? FLIP.max)) return null;
    // Une apparition en cascade est en cours : on la laisse finir.
    if (items.some((item) => gsap.isTweening(item))) return null;
    return Flip.getState(items);
  }

  componentDidUpdate(_props: Props, _state: unknown, snapshot: Snapshot) {
    if (!snapshot) return;
    const items = this.items();
    if (items.length === 0 || items.length > (this.props.max ?? FLIP.max)) return;
    Flip.from(snapshot, {
      targets: items,
      duration: FLIP.duration,
      ease: FLIP.ease,
      simple: true,
      onEnter: (entering) =>
        gsap.fromTo(
          entering,
          { autoAlpha: 0 },
          { autoAlpha: 1, duration: DURATION.swap, ease: EASE.standard, clearProps: "opacity,visibility" }
        ),
    });
  }

  render() {
    const { as = "div", className, style, children, stagger } = this.props;
    return createElement(
      as,
      {
        ref: (el: HTMLElement | null) => {
          this.root = el;
        },
        className,
        style,
        ...(stagger ? { "data-stagger": "" } : {}),
      },
      children
    );
  }
}
