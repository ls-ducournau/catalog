import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { deletePlaylist, getPlaylist, playlistErrorStatus, updatePlaylist } from "@/lib/playlistService";

// spec: specs/playlists-v1.md (FR-2, FR-3, FR-11, FR-12)

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  const playlist = getPlaylist(getDb(), Number(id));
  if (!playlist) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ playlist });
}

/** `{ name?, description? }` */
export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const result = updatePlaylist(getDb(), Number(id), { name: body?.name, description: body?.description });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: playlistErrorStatus(result.error) });
  return NextResponse.json(result);
}

/** Supprime la playlist et rend son instantané, pour « Annuler » (FR-3). */
export async function DELETE(_request: Request, context: Context) {
  const { id } = await context.params;
  const snapshot = deletePlaylist(getDb(), Number(id));
  if (!snapshot) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ snapshot });
}
