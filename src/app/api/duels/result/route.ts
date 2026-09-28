import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { submitDuelResult, type DuelChoice } from "@/lib/duelService";

type Body = {
  itemAId: number;
  itemBId: number;
  result: "A" | "B" | "skip";
};

export async function POST(request: Request) {
  const body = (await request.json()) as Body;

  if (
    typeof body.itemAId !== "number" ||
    typeof body.itemBId !== "number" ||
    !["A", "B", "skip"].includes(body.result)
  ) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const db = getDb();
  const updated = submitDuelResult(db, body.itemAId, body.itemBId, body.result as DuelChoice);
  return NextResponse.json(updated);
}
