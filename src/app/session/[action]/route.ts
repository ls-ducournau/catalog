import { cookies } from "next/headers";
import {
  COOKIE_ACCES,
  COOKIE_RENOUVELLEMENT,
  DUREE_RENOUVELLEMENT,
  connexion,
  estV2,
  garderCompte,
  optionsCookie,
  renouveler,
  revendications,
  type Session,
} from "@/lib/sessionV2";

// Le compte de la v2 (spec: specs/catalog-v2-rust-supabase.md, FR-2) : état, connexion par e-mail et
// mot de passe, « garder mon compte » (un invité devient durable sans code), déconnexion. N'existe
// qu'en mode v2 : en local (v1), 404.

const MESSAGES: Record<string, string> = {
  "Invalid login credentials": "E-mail ou mot de passe incorrect.",
  "User already registered": "Cette adresse a déjà un compte : connecte-toi.",
  "A user with this email address has already been registered": "Cette adresse a déjà un compte : connecte-toi.",
  "Password should be at least 6 characters.": "Le mot de passe doit faire au moins 6 caractères.",
};

async function poser(session: Session) {
  const pot = await cookies();
  pot.set(COOKIE_ACCES, session.access_token, optionsCookie(session.expires_in));
  pot.set(COOKIE_RENOUVELLEMENT, session.refresh_token, optionsCookie(DUREE_RENOUVELLEMENT));
}

function erreur(message: string, statut = 400) {
  return Response.json({ error: MESSAGES[message] ?? message }, { status: statut });
}

async function identifiants(request: Request): Promise<{ email: string; motDePasse: string } | null> {
  const corps = (await request.json().catch(() => null)) as { email?: unknown; motDePasse?: unknown } | null;
  const email = typeof corps?.email === "string" ? corps.email.trim() : "";
  const motDePasse = typeof corps?.motDePasse === "string" ? corps.motDePasse : "";
  return email && motDePasse ? { email, motDePasse } : null;
}

export async function GET(_request: Request, ctx: RouteContext<"/session/[action]">) {
  if (!estV2()) return new Response(null, { status: 404 });
  const { action } = await ctx.params;
  if (action !== "etat") return new Response(null, { status: 404 });
  const claims = revendications((await cookies()).get(COOKIE_ACCES)?.value);
  return Response.json({ connecte: Boolean(claims), anonyme: claims?.is_anonymous !== false, email: claims?.email || null });
}

export async function POST(request: Request, ctx: RouteContext<"/session/[action]">) {
  if (!estV2()) return new Response(null, { status: 404 });
  const { action } = await ctx.params;
  const pot = await cookies();

  if (action === "deconnexion") {
    pot.delete(COOKIE_ACCES);
    pot.delete(COOKIE_RENOUVELLEMENT);
    return Response.json({ ok: true });
  }

  const ids = await identifiants(request);
  if (!ids) return erreur("Saisis une adresse e-mail et un mot de passe.");
  if (ids.motDePasse.length < 6) return erreur("Password should be at least 6 characters.");

  try {
    if (action === "connexion") {
      await poser(await connexion(ids.email, ids.motDePasse));
      return Response.json({ ok: true });
    }
    if (action === "garder") {
      const acces = pot.get(COOKIE_ACCES)?.value;
      const renouvellement = pot.get(COOKIE_RENOUVELLEMENT)?.value;
      if (!acces || !renouvellement) return erreur("Session absente : recharge la page.", 401);
      await garderCompte(acces, ids.email, ids.motDePasse);
      // Un nouveau jeton, qui porte l'e-mail et n'est plus « invité ».
      await poser(await renouveler(renouvellement));
      return Response.json({ ok: true });
    }
  } catch (e) {
    return erreur(e instanceof Error ? e.message : "Erreur inconnue.");
  }
  return new Response(null, { status: 404 });
}
