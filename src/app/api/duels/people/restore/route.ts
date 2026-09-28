import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { restorePersonElo } from "@/lib/personDuelService";

/** Annule la dernière réinitialisation de l'Elo des acteurs. */
export async function POST() {
  return NextResponse.json(restorePersonElo(getDb()));
}
