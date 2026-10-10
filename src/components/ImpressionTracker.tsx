"use client";

import { useEffect } from "react";
import { SURFACES, type Surface } from "@/lib/impressionKeys";

// Relevé des titres montrés — spec: specs/recommandations-fraicheur-v1.md (FR-1, FR-2, FR-4, NFR-4)
//
// Une carte de proposition porte `data-impression` (sa clé : « item:12 », « tmdb:movie:603 ») et
// l'écran qui propose le déclare par son archétype (`surface`). Un seul observateur pour toute
// l'application, monté dans la mise en page : une carte visible au moins à moitié pendant
// 1 seconde part dans le lot suivant. Rien ne s'affiche, rien ne se rend à nouveau.

const DWELL_MS = 1000;
const FLUSH_MS = 5000;
const MAX_BATCH = 200;
const CARD = "[data-impression]";

/**
 * Un navigateur piloté (tests, captures) n'enregistre rien : une capture ne doit jamais écrire
 * dans la base. Un parcours de vérification sur une copie isolée peut le demander
 * explicitement (`window.__CATALOG_IMPRESSIONS__ = true`).
 */
function silenced(): boolean {
  return navigator.webdriver && !(window as { __CATALOG_IMPRESSIONS__?: boolean }).__CATALOG_IMPRESSIONS__;
}

function post(url: string, body: unknown, keepalive = false): void {
  void fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive,
  }).catch(() => {});
}

let lastOpened: { key: string; at: number } | null = null;

/** FR-4 : ouvrir la fiche d'un titre est un geste, qui remet sa lassitude à zéro. */
export function notifyOpened(key: string): void {
  if (silenced()) return;
  // Une même ouverture ne compte qu'une fois (le mode strict de React rejoue les effets).
  const now = Date.now();
  if (lastOpened?.key === key && now - lastOpened.at < 2000) return;
  lastOpened = { key, at: now };
  post("/api/opened", { subject: key });
}

/** L'écran qui propose (FR-1) ; une carte hors d'une surface (bibliothèque, recherche…) ne compte pas. */
function surfaceOf(el: Element): Surface | null {
  const surface = el.closest<HTMLElement>("[data-impression-surface]")?.dataset.impressionSurface;
  return SURFACES.includes(surface as Surface) ? (surface as Surface) : null;
}

export function ImpressionTracker() {
  useEffect(() => {
    if (silenced() || typeof IntersectionObserver === "undefined") return;

    const pending = new Map<Surface, Set<string>>();
    // Déjà envoyés pendant cette visite : le serveur n'en garde qu'un par jour de toute façon.
    const sent = new Set<string>();
    const timers = new Map<Element, number>();

    function flush(keepalive = false) {
      for (const [surface, keys] of pending) {
        const subjects = [...keys];
        keys.clear();
        for (let i = 0; i < subjects.length; i += MAX_BATCH) {
          post("/api/impressions", { surface, subjects: subjects.slice(i, i + MAX_BATCH) }, keepalive);
        }
      }
    }

    function stopTimer(el: Element) {
      window.clearTimeout(timers.get(el));
      timers.delete(el);
    }

    const visibility = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const el = entry.target as HTMLElement;
          if (!entry.isIntersecting) {
            stopTimer(el);
            continue;
          }
          if (timers.has(el)) continue;
          timers.set(
            el,
            window.setTimeout(() => {
              timers.delete(el);
              const key = el.dataset.impression;
              const surface = surfaceOf(el);
              if (!key || !surface || sent.has(key) || !el.isConnected) return;
              sent.add(key);
              if (!pending.has(surface)) pending.set(surface, new Set());
              pending.get(surface)!.add(key);
            }, DWELL_MS)
          );
        }
      },
      { threshold: 0.5 }
    );

    function watch(root: Element) {
      const cards = root.matches(CARD) ? [root] : [];
      cards.push(...root.querySelectorAll(CARD));
      for (const card of cards) if (surfaceOf(card)) visibility.observe(card);
    }

    function forget(root: Element) {
      const cards = root.matches(CARD) ? [root] : [];
      cards.push(...root.querySelectorAll(CARD));
      for (const card of cards) {
        visibility.unobserve(card);
        stopTimer(card);
      }
    }

    const mutations = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes") {
          // Une carte qui change de titre repart de zéro : sa nouvelle clé doit rester visible 1 s.
          const el = record.target as Element;
          forget(el);
          if (el.hasAttribute("data-impression")) watch(el);
          continue;
        }
        record.removedNodes.forEach((node) => node instanceof Element && forget(node));
        record.addedNodes.forEach((node) => node instanceof Element && watch(node));
      }
    });

    // Un onglet caché ne montre rien : on suspend, puis on reprend au retour.
    function onVisibility() {
      if (document.visibilityState === "hidden") {
        for (const el of [...timers.keys()]) stopTimer(el);
        visibility.disconnect();
        flush(true);
      } else {
        watch(document.body);
      }
    }
    const onPageHide = () => flush(true);

    watch(document.body);
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-impression"] });
    const interval = window.setInterval(() => flush(), FLUSH_MS);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      flush(true);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      mutations.disconnect();
      visibility.disconnect();
      for (const el of [...timers.keys()]) stopTimer(el);
    };
  }, []);

  return null;
}
