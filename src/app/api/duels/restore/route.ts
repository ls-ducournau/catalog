import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { restoreElo } from "@/lib/duelService";

/** Annule la dernière réinitialisation de l'Elo. */
export async function POST() {
  return NextResponse.json(restoreElo(getDb()));
}
