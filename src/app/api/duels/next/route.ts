import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getNextDuel } from "@/lib/duelService";
import { parseCategory } from "@/lib/libraryItem";

export async function GET(request: Request) {
  const category = parseCategory(new URL(request.url).searchParams.get("category"));
  const result = getNextDuel(getDb(), category);
  return NextResponse.json(result);
}
