// Vérification des vidéos YouTube — spec: specs/bandes-annonces-v1.md (FR-8)
//
// Point d'accès public oEmbed (sans clé) : 200 = lecture intégrée autorisée (avec le nom de la
// chaîne), 401 = réservée à YouTube par sa chaîne, 404 = retirée ou privée.
// Le script de rattrapage fait la même requête (scripts/backfill-trailers.mjs).

import { interpretOEmbed, type EmbedCheck } from "./trailer";

const TIMEOUT_MS = 3000;
const cache = new Map<string, Promise<EmbedCheck>>();

export function checkYouTubeVideo(key: string): Promise<EmbedCheck> {
  const cached = cache.get(key);
  if (cached) return cached;
  const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${key}`)}`;
  const pending = fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    .then(async (res) => interpretOEmbed(res.status, res.ok ? await res.json() : null))
    .catch((): EmbedCheck => ({ state: "unknown" }));
  cache.set(key, pending);
  // Un doute (réseau) ne reste pas en cache : on revérifiera à la prochaine occasion.
  pending.then((result) => {
    if (result.state === "unknown") cache.delete(key);
  });
  return pending;
}
