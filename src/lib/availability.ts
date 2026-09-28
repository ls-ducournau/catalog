// Disponibilité streaming — spec: specs/disponibilite-streaming-v1.md
//
// Logique pure (aucun accès réseau ni base) : ce qui décide si un titre est « sur tes
// abonnements » doit être testable sans TMDB.

export type Provider = { id: number; name: string; logoPath: string | null };

/** FR-1 : où voir un titre en France, tel que récupéré chez TMDB (source JustWatch). */
export type Availability = {
  /** Page TMDB du titre, qui renvoie vers les services (pas de lien profond fourni). */
  link: string | null;
  flatrate: Provider[];
  free: Provider[];
  ads: Provider[];
  rent: Provider[];
  buy: Provider[];
  fetchedAt: string;
};

/** Logo d'un service, au format carré servi par TMDB. */
export function providerLogoUrl(logoPath: string | null): string | null {
  return logoPath ? `https://image.tmdb.org/t/p/w92${logoPath}` : null;
}

/** FR-2 : au-delà, la disponibilité est rafraîchie à l'ouverture de la fiche. */
export const AVAILABILITY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function isStale(availability: Availability | null, now: Date = new Date()): boolean {
  if (!availability) return true;
  return now.getTime() - new Date(availability.fetchedAt).getTime() > AVAILABILITY_TTL_MS;
}

/**
 * FR-4 : nom du service une fois retirée la mention d'une formule avec publicité.
 * « Netflix Standard with Ads » et « Netflix » désignent le même abonnement ; une chaîne vendue
 * via un autre service (« … Amazon Channel ») garde son nom, c'est un abonnement distinct.
 */
export function serviceFamily(name: string): string {
  return name
    .replace(/\s+(standard|basic|essential)?\s*with\s+ads$/i, "")
    .trim()
    .toLowerCase();
}

/**
 * Tous les identifiants de services couverts par tes abonnements, formules avec publicité
 * comprises. `catalog` = la liste des services disponibles en France.
 */
export function coveredProviderIds(subscriptionIds: number[], catalog: Provider[]): Set<number> {
  const subscribed = new Set(subscriptionIds);
  const families = new Set(
    catalog.filter((p) => subscribed.has(p.id)).map((p) => serviceFamily(p.name))
  );
  const covered = new Set(subscriptionIds);
  for (const provider of catalog) {
    if (families.has(serviceFamily(provider.name))) covered.add(provider.id);
  }
  return covered;
}

/**
 * FR-5 : services de tes abonnements où le titre est inclus. La location et l'achat ne
 * comptent pas : « sur mes abonnements » veut dire « sans rien payer de plus ».
 */
export function includedIn(availability: Availability | null, covered: Set<number>): Provider[] {
  if (!availability) return [];
  const seen = new Set<string>();
  return [...availability.flatrate, ...availability.free, ...availability.ads].filter((p) => {
    if (!covered.has(p.id)) return false;
    // Un même service peut apparaître sous deux formules : on ne l'affiche qu'une fois.
    const family = serviceFamily(p.name);
    if (seen.has(family)) return false;
    seen.add(family);
    return true;
  });
}
