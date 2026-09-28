import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { parseCategory } from "@/lib/libraryItem";
import { getTierStep, parseStars } from "@/lib/tierDuelService";

// spec: specs/classement-v1.md (FR-3, FR-7 à FR-11)
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const stars = parseStars(searchParams.get("stars"));
  if (stars === null) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  return NextResponse.json(
    getTierStep(getDb(), stars, parseCategory(searchParams.get("category")), Math.random, {
      refine: searchParams.get("refine") === "1",
    })
  );
}
