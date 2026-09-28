import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { listDistinctGenres } from "@/lib/itemService";

export async function GET() {
  const db = getDb();
  return NextResponse.json({ genres: listDistinctGenres(db) });
}
