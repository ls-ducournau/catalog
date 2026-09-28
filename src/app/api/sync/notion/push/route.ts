import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { pushToNotion, NotionNotConfiguredError } from "@/lib/notion";

export async function POST() {
  const db = getDb();

  try {
    const result = await pushToNotion(db);

    db.prepare(
      `INSERT INTO sync_state (key, value) VALUES ('last_push_at', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(new Date().toISOString());

    return NextResponse.json({ ...result, lastPushAt: new Date().toISOString() });
  } catch (err) {
    if (err instanceof NotionNotConfiguredError) {
      return NextResponse.json({ error: "notion_not_configured" }, { status: 503 });
    }
    return NextResponse.json({ error: "notion_unreachable" }, { status: 502 });
  }
}
