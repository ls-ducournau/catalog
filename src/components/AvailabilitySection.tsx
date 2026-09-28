import { ExternalLink } from "lucide-react";
import { includedIn, serviceFamily, type Availability, type Provider } from "@/lib/availability";
import { ProviderLogo } from "@/components/ProviderLogo";

/** Un service par famille : une formule avec publicité ne s'affiche pas en double. */
function uniqueServices(providers: Provider[], exclude: Set<string> = new Set()): Provider[] {
  const seen = new Set(exclude);
  return providers.filter((p) => {
    const family = serviceFamily(p.name);
    if (seen.has(family)) return false;
    seen.add(family);
    return true;
  });
}

function Group({ label, providers, highlight = false }: { label: string; providers: Provider[]; highlight?: boolean }) {
  if (providers.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className={`w-full text-xs sm:w-40 ${highlight ? "font-medium text-foreground" : "text-muted"}`}>
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {providers.map((p) => (
          <span key={p.id} className="flex items-center gap-1.5">
            <ProviderLogo provider={p} size={22} />
            <span className={`text-xs ${highlight ? "text-foreground" : "text-muted"}`}>{p.name}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Où voir un titre en France (spec disponibilite-streaming-v1 FR-6), en commençant par ce qui
 * est déjà inclus dans tes abonnements. Source JustWatch, citée comme l'exigent les conditions
 * de TMDB.
 */
export function AvailabilitySection({
  availability,
  covered,
}: {
  availability: Availability;
  covered: Set<number>;
}) {
  const mine = includedIn(availability, covered);
  const mineFamilies = new Set(mine.map((p) => serviceFamily(p.name)));
  const subscription = uniqueServices(availability.flatrate, mineFamilies);
  const free = uniqueServices([...availability.free, ...availability.ads], mineFamilies);
  const paid = uniqueServices([...availability.rent, ...availability.buy]);
  const nothing = mine.length + subscription.length + free.length + paid.length === 0;

  return (
    <div>
      <p className="eyebrow">Où le voir</p>

      {nothing ? (
        <p className="mt-2 text-sm text-muted">
          Pas disponible en streaming en France, d&apos;après JustWatch.
        </p>
      ) : (
        <div className="mt-2 flex flex-col gap-2.5">
          <Group label="Inclus dans tes abonnements" providers={mine} highlight />
          <Group label="Abonnement" providers={subscription} />
          <Group label="Gratuit" providers={free} />
          <Group label="Location ou achat" providers={paid} />
        </div>
      )}

      <p className="mt-4 flex flex-wrap items-center gap-x-2 text-xs text-muted">
        <span>Source : JustWatch</span>
        {availability.link && (
          <a
            href={availability.link}
            target="_blank"
            rel="noopener noreferrer"
            className="link inline-flex items-center gap-1"
          >
            Voir sur TMDB
            <ExternalLink size={11} aria-hidden="true" />
          </a>
        )}
      </p>
    </div>
  );
}
