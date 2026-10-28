// Session de la v2 (spec: specs/catalog-v2-rust-supabase.md, FR-2) : identification Supabase gardée
// dans deux cookies réservés au serveur. Ce module ne sert qu'en mode v2 (variable CATALOG_API_URL
// présente) ; la v1 locale ne l'utilise jamais.
//
// - À la première visite, une session invitée est ouverte d'office : l'accueil est la page d'arrivée,
//   sans écran de connexion (décision de Louis, 2026-10-28).
// - Le jeton d'accès (1 h) est renouvelé par le jeton de renouvellement quand il expire.
// - « Garder mon compte » : e-mail et mot de passe, sans code (décision du 2026-10-27).

export const COOKIE_ACCES = "catalog-acces";
export const COOKIE_RENOUVELLEMENT = "catalog-renouvellement";
/** En-tête interne par lequel le proxy passe le jeton aux composants serveur (accueil). */
export const ENTETE_JETON = "x-catalog-jeton";

export type Session = { access_token: string; refresh_token: string; expires_in: number };

/** Mode v2 : l'API est le serveur Rust. */
export function estV2(): boolean {
  return Boolean(process.env.CATALOG_API_URL);
}

function supabase(): { url: string; cle: string } {
  const url = process.env.SUPABASE_URL;
  const cle = process.env.SUPABASE_ANON_KEY;
  if (!url || !cle) throw new Error("SUPABASE_URL ou SUPABASE_ANON_KEY absente");
  return { url, cle };
}

async function auth(chemin: string, corps: unknown, methode = "POST", jeton?: string): Promise<Record<string, unknown>> {
  const { url, cle } = supabase();
  const reponse = await fetch(`${url}/auth/v1${chemin}`, {
    method: methode,
    headers: { apikey: cle, "Content-Type": "application/json", ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) },
    body: corps === undefined ? undefined : JSON.stringify(corps),
    cache: "no-store",
  });
  const json = (await reponse.json().catch(() => ({}))) as Record<string, unknown>;
  if (!reponse.ok) throw new Error(String(json.msg ?? json.error_description ?? json.error_code ?? `Erreur ${reponse.status}`));
  return json;
}

const enSession = (j: Record<string, unknown>): Session => ({
  access_token: String(j.access_token),
  refresh_token: String(j.refresh_token),
  expires_in: Number(j.expires_in ?? 3600),
});

/** Ouvre une session invitée (connexion anonyme de Supabase). */
export async function sessionInvitee(): Promise<Session> {
  return enSession(await auth("/signup", {}));
}

export async function renouveler(refresh: string): Promise<Session> {
  return enSession(await auth("/token?grant_type=refresh_token", { refresh_token: refresh }));
}

export async function connexion(email: string, motDePasse: string): Promise<Session> {
  return enSession(await auth("/token?grant_type=password", { email, password: motDePasse }));
}

/** Un compte invité devient durable : e-mail et mot de passe, même identifiant, mêmes données. */
export async function garderCompte(jeton: string, email: string, motDePasse: string): Promise<void> {
  await auth("/user", { email, password: motDePasse }, "PUT", jeton);
}

/** Les revendications d'un jeton, lues sans vérifier la signature (le serveur Rust, lui, vérifie). */
export function revendications(jeton: string | undefined): { exp?: number; email?: string; is_anonymous?: boolean } | null {
  if (!jeton) return null;
  try {
    const partie = jeton.split(".")[1];
    return JSON.parse(Buffer.from(partie.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch {
    return null;
  }
}

/** Le jeton d'accès est-il encore valable au moins une minute ? */
export function frais(jeton: string | undefined): boolean {
  const exp = revendications(jeton)?.exp;
  return typeof exp === "number" && exp - 60 > Date.now() / 1000;
}

/** Options des deux cookies : réservés au serveur, envoyés en HTTPS seulement en production. */
export function optionsCookie(maxAge: number) {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge };
}

/** Durée de vie du cookie de renouvellement : un an (le jeton lui-même n'expire pas tant qu'il sert). */
export const DUREE_RENOUVELLEMENT = 365 * 24 * 60 * 60;
