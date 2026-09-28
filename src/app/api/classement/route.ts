import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { parseCategory } from "@/lib/libraryItem";
import { getRanking } from "@/lib/tierDuelService";

// spec: specs/classement-v1.md (FR-2)
export async function GET(request: Request) {
  const category = parseCategory(new URL(request.url).searchParams.get("category"));
  return NextResponse.json(getRanking(getDb(), category));
}
