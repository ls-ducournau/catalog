import type { MetadataRoute } from "next";
import { SITE } from "@/lib/partage";

// Les moteurs de recherche : la page d'arrivée et la bienvenue ; pas l'API ni les pages d'un compte.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: ["/", "/bienvenue"], disallow: ["/api/", "/session/", "/library", "/design", "/connexion"] },
    sitemap: `${SITE}/sitemap.xml`,
  };
}
