import { NextResponse } from "next/server";
import { listFrenchProviders } from "@/lib/tmdb";

// spec: specs/disponibilite-streaming-v1.md (FR-3) — services disponibles en France.
export async function GET() {
  return NextResponse.json({ providers: await listFrenchProviders() });
}
