import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getCoveredServiceIds } from "@/lib/settingsService";
import { parseContext } from "@/lib/tonight";
import { getTonight } from "@/lib/tonightService";

// spec: specs/ce-soir-v2.md (FR-1, FR-5)
export async function GET(request: Request) {
  const context = parseContext(Object.fromEntries(new URL(request.url).searchParams));
  const db = getDb();
  return NextResponse.json(await getTonight(db, context, await getCoveredServiceIds(db)));
}
