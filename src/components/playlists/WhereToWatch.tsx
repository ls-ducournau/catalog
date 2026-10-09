"use client";

import { ProviderLogo } from "@/components/ProviderLogo";
import { useMyServices } from "@/components/useMyServices";
import { includedIn, type Availability, type Provider } from "@/lib/availability";

// Où regarder un titre (spec playlists-v2 FR-6) : tes abonnements d'abord ; sinon les autres
// services qui l'incluent (abonnement, gratuit, avec publicité). Rien si on ne sait pas.

export function WhereToWatch({ availability, className }: { availability: Availability | null; className?: string }) {
  const { covered } = useMyServices();
  if (!availability) return null;
  const mine = includedIn(availability, covered);
  const elsewhere: Provider[] = [];
  for (const provider of [...availability.flatrate, ...availability.free, ...availability.ads]) {
    if (!elsewhere.some((p) => p.id === provider.id) && !mine.some((p) => p.id === provider.id)) elsewhere.push(provider);
  }
  const shown = mine.length > 0 ? mine : elsewhere;
  if (shown.length === 0) return null;
  return (
    <p className={className ?? "flex min-w-0 items-center gap-2 text-sm"}>
      <span className="flex shrink-0 items-center gap-1">
        {shown.slice(0, 3).map((provider) => (
          <ProviderLogo key={provider.id} provider={provider} size={18} />
        ))}
      </span>
      <span className={mine.length > 0 ? "min-w-0 truncate text-foreground" : "min-w-0 truncate text-muted"}>
        {mine.length > 0 ? `Sur ${mine[0].name}` : `Sur ${shown[0].name}, hors de tes abonnements`}
      </span>
    </p>
  );
}
