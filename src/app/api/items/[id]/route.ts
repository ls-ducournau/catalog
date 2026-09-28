import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  updateItem,
  getItemWithOverview,
  refreshItemFromTmdb,
  type UpdateItemPatch,
} from "@/lib/itemService";
import { logEvent } from "@/lib/journalService";
import { actionErrorStatus, removeFromLibrary } from "@/lib/libraryActions";

/**
 * Récupère l'item, avec son synopsis mis en cache à la demande (cf. getItemWithOverview).
 * `?refresh=1` force un refetch TMDB complet (déclenché explicitement depuis la fiche).
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const refresh = new URL(request.url).searchParams.get("refresh") === "1";

  const db = getDb();
  const item = refresh
    ? await refreshItemFromTmdb(db, Number(id))
    : await getItemWithOverview(db, Number(id));

  if (!item) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json(item);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = (await request.json()) as UpdateItemPatch;

  const db = getDb();
  const updated = updateItem(db, Number(id), body);

  if (!updated) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // tri-rapide-v1 FR-1 : une note posée (ou effacée) est journalisée.
  if (body.rating !== undefined || body.watchStatus !== undefined) {
    logEvent(db, "rated", "item", updated.id, { rating: updated.rating, watchStatus: updated.watchStatus });
  }

  return NextResponse.json(updated);
}

/** FR-9 (bibliothèque) : archive la page Notion puis supprime l'item en local. */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const result = await removeFromLibrary(getDb(), Number(id));
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: actionErrorStatus(result.error) });
  }
  return NextResponse.json({ ok: true });
}
