import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "@/lib/db";
import { resetElo } from "@/lib/duelService";
import { parseCategory } from "@/lib/libraryItem";

/**
 * FR-17 (duels) : réinitialise l'Elo d'une catégorie. Une sauvegarde complète de la base est
 * faite avant, en plus de l'instantané qui permet l'annulation depuis l'écran.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const category = parseCategory(body?.category ?? null);
  const db = getDb();

  const backupDir = path.join(process.cwd(), "data", "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await db.backup(path.join(backupDir, `avant-reinitialisation-elo-${stamp}.db`));

  return NextResponse.json(resetElo(db, category));
}
