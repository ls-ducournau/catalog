import { NextResponse, type NextRequest } from "next/server";
import {
  COOKIE_ACCES,
  COOKIE_RENOUVELLEMENT,
  DUREE_RENOUVELLEMENT,
  ENTETE_JETON,
  frais,
  optionsCookie,
  renouveler,
  sessionInvitee,
  type Session,
} from "@/lib/sessionV2";

// Proxy de la v2 (spec: specs/catalog-v2-rust-supabase.md) : il n'agit que si CATALOG_API_URL est
// défini (application en ligne). En local, la v1 passe sans rien changer.
//
// 1. Session : au premier geste (specs/accueil-vitrine-connexion-v1.md § 5). L'accueil et les lectures
//    d'API d'un visiteur passent sans session (la vitrine) ; la première écriture, ou la première page
//    de l'application, ouvre une session invitée, sans écran. Un robot qui ne fait que lire l'accueil
//    ne crée donc aucun compte. Un jeton expiré est renouvelé.
// 2. API : chaque appel `/api/*` part vers le serveur Rust, avec le jeton de l'utilisateur et le jeton
//    de contournement de la protection d'accès de Vercel (appel de serveur à serveur).
// 3. Pages : le jeton est passé aux composants serveur par un en-tête interne (l'accueil lit ses
//    données côté serveur).

/**
 * Ce qu'un visiteur fait sans session : regarder l'accueil et la visite, lire l'API (la vitrine est
 * publique). Une page de l'application n'ouvre la session que sur une vraie navigation du navigateur
 * (`sec-fetch-dest: document`) : jamais pour un préchargement de lien ni une requête de composants, que
 * Next.js lance en arrière-plan et dont il retire les en-têtes avant le proxy. Sans cela, chaque lien
 * visible de l'accueil créait un compte invité vide.
 */
function sansSession(request: NextRequest): boolean {
  const { pathname } = request.nextUrl;
  // L'accueil et la visite se regardent sans compte (specs/visite-interactive-v1.md).
  if (pathname === "/" || pathname === "/visite") return true;
  if (pathname.startsWith("/api/")) return request.method === "GET" || request.method === "HEAD";
  return request.headers.get("sec-fetch-dest") !== "document";
}

export async function proxy(request: NextRequest) {
  const api = process.env.CATALOG_API_URL;
  if (!api) return NextResponse.next();

  let acces = request.cookies.get(COOKIE_ACCES)?.value;
  const renouvellement = request.cookies.get(COOKIE_RENOUVELLEMENT)?.value;
  let nouvelle: Session | null = null;
  if (!frais(acces) && (renouvellement || !sansSession(request))) {
    try {
      nouvelle = renouvellement ? await renouveler(renouvellement) : await sessionInvitee();
    } catch {
      // Jeton de renouvellement refusé (compte supprimé, révoqué…) : une nouvelle session invitée.
      try {
        nouvelle = await sessionInvitee();
      } catch {
        nouvelle = null;
      }
    }
    if (nouvelle) acces = nouvelle.access_token;
  }

  const entetes = new Headers(request.headers);
  if (acces) entetes.set(ENTETE_JETON, acces);

  let reponse: NextResponse;
  if (request.nextUrl.pathname.startsWith("/api/")) {
    const cible = new URL(request.nextUrl.pathname + request.nextUrl.search, api);
    if (acces) entetes.set("authorization", `Bearer ${acces}`);
    const contournement = process.env.CATALOG_API_BYPASS;
    if (contournement) entetes.set("x-vercel-protection-bypass", contournement);
    entetes.delete("cookie");
    reponse = NextResponse.rewrite(cible, { request: { headers: entetes } });
  } else {
    reponse = NextResponse.next({ request: { headers: entetes } });
  }

  if (nouvelle) {
    reponse.cookies.set(COOKIE_ACCES, nouvelle.access_token, optionsCookie(nouvelle.expires_in));
    reponse.cookies.set(COOKIE_RENOUVELLEMENT, nouvelle.refresh_token, optionsCookie(DUREE_RENOUVELLEMENT));
  }
  return reponse;
}

export const config = {
  // Ni les fichiers statiques, ni les images, ni les routes de session (qui gèrent elles-mêmes leurs cookies).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|session/|.*\\.(?:png|jpg|jpeg|svg|webp|ico|txt|woff2?)$).*)"],
};
