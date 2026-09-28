import { NextResponse } from "next/server";
import { clampWindow, getCalendar } from "@/lib/calendarService";
import { getDb } from "@/lib/db";

// spec: specs/sorties-v1.md (FR-3 à FR-6 ter) — lecture seule vers Notion (NFR-1).
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const window = clampWindow(searchParams.get("from") ?? "", searchParams.get("to") ?? "");
  if (!window) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  return NextResponse.json(await getCalendar(getDb(), window));
}
