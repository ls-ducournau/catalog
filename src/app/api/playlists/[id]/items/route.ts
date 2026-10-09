import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  addManyToPlaylist,
  addToPlaylist,
  parseSource,
  playlistErrorStatus,
  removeFromPlaylist,
  reorderPlaylist,
} from "@/lib/playlistService";

// spec: specs/playlists-v1.md (FR-4 à FR-8), specs/playlists-v2.md (FR-4, FR-12)

type Context = { params: Promise<{ id: string }> };

const isId = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x > 0;

/**
 * `{ itemId, position?, source? }` : ajoute un titre (en fin de liste, ou à sa place pour annuler
 * un retrait). `{ itemIds, source? }` : en ajoute plusieurs d'un coup (v2 FR-4).
 */
export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const source = parseSource(body?.source);
  if (Array.isArray(body?.itemIds)) {
    if (!body.itemIds.every(isId) || body.itemIds.length > 500) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    const result = addManyToPlaylist(getDb(), Number(id), body.itemIds, source);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: playlistErrorStatus(result.error) });
    return NextResponse.json(result);
  }
  if (!isId(body?.itemId)) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const position = typeof body?.position === "number" && Number.isInteger(body.position) ? body.position : undefined;
  const result = addToPlaylist(getDb(), Number(id), body.itemId, position, source);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: playlistErrorStatus(result.error) });
  return NextResponse.json(result);
}

/** `{ itemId }` : retire un titre ; rend sa place. */
export async function DELETE(request: Request, context: Context) {
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  if (!isId(body?.itemId)) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const result = removeFromPlaylist(getDb(), Number(id), body.itemId);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: playlistErrorStatus(result.error) });
  return NextResponse.json(result);
}

/** `{ itemIds }` : le nouvel ordre (FR-7), avec exactement les titres de la playlist. */
export async function PUT(request: Request, context: Context) {
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  if (!Array.isArray(body?.itemIds) || !body.itemIds.every(isId)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const result = reorderPlaylist(getDb(), Number(id), body.itemIds);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: playlistErrorStatus(result.error) });
  return NextResponse.json(result);
}
