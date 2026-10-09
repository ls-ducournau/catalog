"use client";

import { useEffect, useState } from "react";

/**
 * L'heure qu'il est, côté navigateur seulement (rien au rendu serveur, donc pas d'écart
 * d'hydratation), remise à jour chaque minute : pour « fin vers 22 h 47 ».
 */
export function useNow(): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);
  return now;
}
