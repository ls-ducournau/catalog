import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { pullFromNotion, ensureEloProperties, NotionNotConfiguredError } from "@/lib/notion";

export async function POST() {
  const db = getDb();

  try {
    await ensureEloProperties();
    const result = await pullFromNotion(db);

    db.prepare(
      `INSERT INTO sync_state (key, value) VALUES ('last_pull_at', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(new Date().toISOString());

    return NextResponse.json({ ...result, lastSyncAt: new Date().toISOString() });
  } catch (err) {
    if (err instanceof NotionNotConfiguredError) {
      return NextResponse.json({ error: "notion_not_configured" }, { status: 503 });
    }
    // EC-1: Notion inaccessible — l'app continue de fonctionner sur les données locales déjà présentes.
    return NextResponse.json({ error: "notion_unreachable" }, { status: 502 });
  }
}
