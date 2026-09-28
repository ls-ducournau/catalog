import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getLibraryInfoByTmdbIds } from "@/lib/itemService";
import { posterUrl, searchMulti } from "@/lib/tmdb";

// spec: specs/ajout-item-v1.md (FR-1, FR-2, EC-1, EC-2)
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";
  const page = Number(searchParams.get("page") ?? "1") || 1;

  const { results, totalPages } = await searchMulti(q, page);

  // Recoupement avec la bibliothèque locale (même mécanique que le tirage) : on peut signaler
  // "déjà ajouté" avant le clic, au lieu de l'apprendre après coup.
  const infoByTmdbId = getLibraryInfoByTmdbIds(
    getDb(),
    results.map((r) => r.tmdbId)
  );

  return NextResponse.json({
    results: results.map((r) => ({
      tmdbId: r.tmdbId,
      type: r.type,
      isDocumentary: r.isDocumentary,
      genres: r.genres,
      title: r.title,
      year: r.year,
      posterUrl: posterUrl(r.posterPath),
      voteAverage: r.voteAverage,
      voteCount: r.voteCount,
      // Déjà fourni par la recherche TMDB : permet de lire le synopsis avant d'ajouter.
      overview: r.overview,
      libraryId: infoByTmdbId.get(r.tmdbId)?.id ?? null,
      libraryStatus: infoByTmdbId.get(r.tmdbId)?.watchStatus ?? null,
      personCredit: r.personCredit ?? null,
    })),
    page,
    totalPages,
  });
}
