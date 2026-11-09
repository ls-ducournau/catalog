import type { MetadataRoute } from "next";
import { SITE } from "@/lib/partage";

// Les pages publiques : la page d'arrivée, et le parcours « Tester ».
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE}/bienvenue`, changeFrequency: "monthly", priority: 0.6 },
  ];
}
