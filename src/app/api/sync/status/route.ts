import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  const db = getDb();

  const getState = (key: string) =>
    (db.prepare(`SELECT value FROM sync_state WHERE key = ?`).get(key) as { value: string } | undefined)
      ?.value ?? null;

  const pendingLocalChanges = (
    db.prepare(`SELECT COUNT(*) as c FROM items WHERE local_dirty = 1`).get() as { c: number }
  ).c;

  return NextResponse.json({
    lastPullAt: getState("last_pull_at"),
    lastPushAt: getState("last_push_at"),
    pendingLocalChanges,
  });
}
