import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSubscriptions, setSubscriptions } from "@/lib/settingsService";

// spec: specs/disponibilite-streaming-v1.md (FR-3) — abonnements déclarés, stockés localement.
export async function GET() {
  return NextResponse.json({ ids: getSubscriptions(getDb()) });
}

export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);
  if (!Array.isArray(body?.ids)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  return NextResponse.json({ ids: setSubscriptions(getDb(), body.ids) });
}
