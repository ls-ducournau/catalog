import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getPersonScope } from "@/lib/personDuelService";

/** Ce que couvre le mode Acteurs : affiché avant de confirmer une réinitialisation. */
export async function GET() {
  const { eligible, scored } = getPersonScope(getDb());
  // Même forme que le périmètre des titres, pour que l'écran les traite pareil.
  return NextResponse.json({ watched: eligible, scored });
}
