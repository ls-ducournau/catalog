"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { coveredProviderIds, type Provider } from "@/lib/availability";

/**
 * Tes abonnements streaming et le catalogue des services en France
 * (spec disponibilite-streaming-v1 FR-3, FR-4). `covered` inclut les formules avec publicité.
 */
export function useMyServices() {
  const [subscriptionIds, setSubscriptionIds] = useState<number[]>([]);
  const [catalog, setCatalog] = useState<Provider[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/settings/subscriptions").then((r) => r.json()),
      fetch("/api/providers").then((r) => r.json()),
    ])
      .then(([subs, providers]: [{ ids: number[] }, { providers: Provider[] }]) => {
        if (cancelled) return;
        setSubscriptionIds(subs.ids ?? []);
        setCatalog(providers.providers ?? []);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const covered = useMemo(
    () => coveredProviderIds(subscriptionIds, catalog),
    [subscriptionIds, catalog]
  );

  const save = useCallback(async (ids: number[]) => {
    const res = await fetch("/api/settings/subscriptions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    const body: { ids: number[] } = await res.json();
    setSubscriptionIds(body.ids ?? []);
  }, []);

  return { subscriptionIds, catalog, covered, loaded, save };
}
