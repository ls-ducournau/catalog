import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getNextPersonDuel } from "@/lib/personDuelService";

// spec: specs/duels-elo-v1.md — amendements v1.2 (FR-18 à FR-21)
export async function GET() {
  return NextResponse.json(getNextPersonDuel(getDb()));
}
