import { redirect } from "next/navigation";

// La visite a fusionné avec « Tester » (specs/bienvenue-v1.md, FR-14 ; demande de Louis, 2026-11-09) : un seul
// parcours, la bienvenue, sur de vraies données. Les anciens liens y mènent, à l'étape la plus proche.

const VERS: Record<string, string> = { notation: "note", duels: "departage", classement: "departage", recos: "recos" };

export default async function Visite({ searchParams }: { searchParams: Promise<{ etape?: string }> }) {
  const { etape } = await searchParams;
  const cible = etape ? VERS[etape] : undefined;
  redirect(cible ? `/bienvenue?etape=${cible}` : "/bienvenue");
}
