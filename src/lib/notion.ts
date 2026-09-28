import { Client } from "@notionhq/client";
import type Database from "better-sqlite3";
import { resolveByImdbId, shouldRetryResolution } from "./tmdb";

// Sync Notion <-> SQLite — spec: specs/duels-elo-v1.md (FR-1, FR-2, FR-13, EC-1, EC-2)

export class NotionNotConfiguredError extends Error {
  constructor() {
    super("NOTION_TOKEN ou NOTION_DATA_SOURCE_ID manquant dans .env");
    this.name = "NotionNotConfiguredError";
  }
}

function getClient(): { client: Client; dataSourceId: string } {
  const token = process.env.NOTION_TOKEN;
  const dataSourceId = process.env.NOTION_DATA_SOURCE_ID;
  if (!token || !dataSourceId) throw new NotionNotConfiguredError();
  return { client: new Client({ auth: token }), dataSourceId };
}

/**
 * FR-9 (bibliothèque) : archive la page Notion (corbeille Notion, récupérable),
 * plutôt qu'une suppression définitive irréversible.
 *
 * Idempotent : si la page est déjà archivée (ex. ligne locale orpheline restée après une
 * précédente suppression), Notion refuse un second `in_trash: true` avec une erreur
 * ("Can't edit block that is archived") — on vérifie donc l'état d'abord et on ne réessaie
 * pas une opération déjà satisfaite.
 */
export async function archiveNotionPage(notionPageId: string): Promise<void> {
  const { client } = getClient();

  const page = await client.pages.retrieve({ page_id: notionPageId });
  if ((page as unknown as { in_trash?: boolean }).in_trash) return;

  await client.pages.update({ page_id: notionPageId, in_trash: true } as never);
}

/**
 * FR-3 (ajout-item) : crée une page Notion pour un nouvel item, propriétés déjà remplies
 * depuis TMDB (pas de dépendance au déclencheur texte `Title[m2020;`, jugé fragile en pratique).
 */
export async function createNotionItem(details: {
  title: string;
  type: "Movie" | "TV Series";
  year: string | null;
  imdbId: string | null;
  genres: string[];
  director: string | null;
  tmdbRating: number | null;
}): Promise<string> {
  const { client, dataSourceId } = getClient();

  const page = await client.pages.create({
    parent: { data_source_id: dataSourceId },
    properties: {
      Name: { title: [{ text: { content: details.title } }] },
      Type: { select: { name: details.type } },
      "Watch Status": { select: { name: "Unwatched" } },
      ...(details.year ? { Year: { rich_text: [{ text: { content: details.year } }] } } : {}),
      ...(details.imdbId
        ? { "IMDb ID": { rich_text: [{ text: { content: details.imdbId } }] } }
        : {}),
      ...(details.genres.length > 0
        ? { Genre: { multi_select: details.genres.map((name) => ({ name })) } }
        : {}),
      ...(details.director
        ? { Director: { rich_text: [{ text: { content: details.director } }] } }
        : {}),
      ...(details.tmdbRating !== null ? { "TMDB Rating": { number: details.tmdbRating } } : {}),
    } as never,
  });

  return (page as { id: string }).id;
}

/** FR-2: crée les propriétés Elo Score / Ressenti si elles n'existent pas, sans toucher au reste du schéma. */
export async function ensureEloProperties(): Promise<void> {
  const { client, dataSourceId } = getClient();
  const source = await client.dataSources.retrieve({ data_source_id: dataSourceId });
  const props = (source as unknown as { properties: Record<string, unknown> }).properties;

  const missing: Record<string, unknown> = {};
  if (!props["Elo Score"]) missing["Elo Score"] = { number: {} };
  if (!props["Ressenti"]) missing["Ressenti"] = { rich_text: {} };

  if (Object.keys(missing).length > 0) {
    await client.dataSources.update({
      data_source_id: dataSourceId,
      properties: missing as never,
    });
  }
}

type NotionPageProps = Record<string, {
  title?: { plain_text: string }[];
  rich_text?: { plain_text: string }[];
  select?: { name: string } | null;
  multi_select?: { name: string }[];
  number?: number | null;
}>;

function plainText(prop: { plain_text: string }[] | undefined): string | null {
  return prop && prop.length > 0 ? prop[0].plain_text : null;
}

/** FR-1: importe/rafraîchit les items depuis Notion dans SQLite. */
export async function pullFromNotion(
  db: Database.Database
): Promise<{ imported: number; updated: number; failed: number }> {
  const { client, dataSourceId } = getClient();

  let imported = 0;
  let updated = 0;
  let failed = 0;

  const upsert = db.prepare(`
    INSERT INTO items (
      notion_page_id, name, type, year, watch_status, imdb_id, genre, rating, director, tmdb_rating,
      notion_last_edited, updated_at
    ) VALUES (@notion_page_id, @name, @type, @year, @watch_status, @imdb_id, @genre, @rating, @director, @tmdb_rating,
      @notion_last_edited, @updated_at)
    ON CONFLICT(notion_page_id) DO UPDATE SET
      name = excluded.name,
      type = excluded.type,
      year = excluded.year,
      watch_status = excluded.watch_status,
      imdb_id = excluded.imdb_id,
      genre = excluded.genre,
      rating = excluded.rating,
      director = excluded.director,
      tmdb_rating = excluded.tmdb_rating,
      notion_last_edited = excluded.notion_last_edited,
      updated_at = excluded.updated_at
    WHERE items.notion_last_edited < excluded.notion_last_edited
  `);

  let cursor: string | undefined = undefined;

  do {
    const page: Awaited<ReturnType<typeof client.dataSources.query>> = await client.dataSources.query({
      data_source_id: dataSourceId,
      start_cursor: cursor,
      page_size: 100,
    });

    for (const result of page.results) {
      try {
        const p = (result as unknown as { properties: NotionPageProps }).properties;
        const lastEdited = (result as unknown as { last_edited_time: string }).last_edited_time;

        const row = {
          notion_page_id: result.id,
          name: plainText(p["Name"]?.title) ?? "(sans titre)",
          type: p["Type"]?.select?.name ?? null,
          year: p["Year"]?.rich_text ? plainText(p["Year"].rich_text) : null,
          watch_status: p["Watch Status"]?.select?.name ?? null,
          imdb_id: p["IMDb ID"]?.rich_text ? plainText(p["IMDb ID"].rich_text) : null,
          genre: p["Genre"]?.multi_select
            ? JSON.stringify(p["Genre"].multi_select.map((g) => g.name))
            : null,
          rating: p["Rating"]?.select?.name ?? null,
          director: p["Director"]?.rich_text ? plainText(p["Director"].rich_text) : null,
          tmdb_rating: p["TMDB Rating"]?.number ?? null,
          notion_last_edited: lastEdited,
          updated_at: new Date().toISOString(),
        };

        const info = upsert.run(row);
        if (info.changes > 0) updated++;
        else imported++;
      } catch {
        failed++;
      }
    }

    cursor = page.has_more ? (page.next_cursor ?? undefined) : undefined;
  } while (cursor);

  await resolveMissingTmdbIds(db);

  return { imported, updated, failed };
}

/** FR-14/FR-15/EC-4: résout les tmdb_id/poster manquants, avec throttle sur les échecs. */
async function resolveMissingTmdbIds(db: Database.Database): Promise<void> {
  const candidates = db
    .prepare(
      `SELECT id, imdb_id, tmdb_resolve_failed_at FROM items
       WHERE tmdb_id IS NULL AND imdb_id IS NOT NULL`
    )
    .all() as { id: number; imdb_id: string; tmdb_resolve_failed_at: string | null }[];

  const update = db.prepare(
    `UPDATE items SET tmdb_id = ?, poster_path = ?, tmdb_resolve_failed_at = NULL WHERE id = ?`
  );
  const markFailed = db.prepare(
    `UPDATE items SET tmdb_resolve_failed_at = ? WHERE id = ?`
  );

  for (const item of candidates) {
    if (!shouldRetryResolution(item.tmdb_resolve_failed_at)) continue;

    const resolved = await resolveByImdbId(item.imdb_id);
    if (resolved) {
      update.run(resolved.tmdbId, resolved.posterPath, item.id);
    } else {
      markFailed.run(new Date().toISOString(), item.id);
    }
  }
}

/** FR-13/EC-2 (duels) + FR-6/EC-2 (bibliothèque) : pousse uniquement Elo Score, Ressenti,
 * Watch Status et Rating pour les items modifiés localement — jamais les autres champs
 * (gérés par l'automatisation Notion). */
export async function pushToNotion(
  db: Database.Database
): Promise<{ pushed: number; failed: number }> {
  const { client } = getClient();

  const dirty = db
    .prepare(
      `SELECT id, notion_page_id, elo_score, ressenti, watch_status, rating FROM items WHERE local_dirty = 1`
    )
    .all() as {
    id: number;
    notion_page_id: string;
    elo_score: number;
    ressenti: string | null;
    watch_status: string | null;
    rating: string | null;
  }[];

  const clearDirty = db.prepare(`UPDATE items SET local_dirty = 0 WHERE id = ?`);

  let pushed = 0;
  let failed = 0;

  for (const item of dirty) {
    try {
      await client.pages.update({
        page_id: item.notion_page_id,
        properties: {
          "Elo Score": { number: item.elo_score },
          // EC-2 (bibliothèque) : null = jamais modifié depuis l'app -> ne pas toucher.
          // "" = effacement volontaire -> poussé quand même.
          ...(item.ressenti !== null
            ? { Ressenti: { rich_text: [{ text: { content: item.ressenti } }] } }
            : {}),
          ...(item.watch_status ? { "Watch Status": { select: { name: item.watch_status } } } : {}),
          ...(item.rating ? { Rating: { select: { name: item.rating } } } : {}),
        } as never,
      });
      clearDirty.run(item.id);
      pushed++;
    } catch {
      failed++;
    }
  }

  return { pushed, failed };
}
