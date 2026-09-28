import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "@/lib/db";
import { resetPersonElo } from "@/lib/personDuelService";

/** FR-22 (duels) : réinitialise l'Elo des acteurs, après une sauvegarde complète de la base. */
export async function POST() {
  const db = getDb();

  const backupDir = path.join(process.cwd(), "data", "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await db.backup(path.join(backupDir, `avant-reinitialisation-elo-acteurs-${stamp}.db`));

  return NextResponse.json(resetPersonElo(db));
}
