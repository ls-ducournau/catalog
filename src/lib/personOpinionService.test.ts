import { describe, expect, it } from "vitest";
import { createTestDb } from "./db";
import { getPeopleWithOpinions } from "./peopleService";
import { getOpinionWeights, resetOpinions, restoreOpinions, setOpinion } from "./personOpinionService";
import { opinionValue } from "./personPreference";

// spec: specs/classement-v1.md (FR-12, FR-13, AC-16 à AC-18)

describe("réinitialiser les avis (FR-12)", () => {
  it("efface une liste, et « Annuler » la rétablit à l'identique (AC-16)", () => {
    const db = createTestDb();
    setOpinion(db, { id: 1, name: "A" }, 1, 5);
    setOpinion(db, { id: 2, name: "B" }, 1);
    setOpinion(db, { id: 3, name: "C" }, 1, 2);
    setOpinion(db, { id: 4, name: "D" }, -1);
    setOpinion(db, { id: 5, name: "E" }, -1);
    const before = getPeopleWithOpinions(db).map((p) => [p.id, p.opinion, p.rating, p.updatedAt]);

    const removed = resetOpinions(db, "liked");
    expect(removed).toHaveLength(3);
    expect(getPeopleWithOpinions(db).map((p) => p.id).sort()).toEqual([4, 5]);

    restoreOpinions(db, removed);
    const after = getPeopleWithOpinions(db).map((p) => [p.id, p.opinion, p.rating, p.updatedAt]);
    expect(after.sort()).toEqual(before.sort());
  });
});

describe("noter une personne aimée (FR-13)", () => {
  it("la note module le poids : 5 étoiles pèsent 5 fois plus qu'une (AC-17)", () => {
    expect(opinionValue(1, 5) / opinionValue(1, 1)).toBeCloseTo(5);
    expect(opinionValue(1, null)).toBe(1);
    expect(opinionValue(1, 3)).toBe(1);
    expect(opinionValue(-1, null)).toBe(-1);

    const db = createTestDb();
    setOpinion(db, { id: 1, name: "Adorée" }, 1, 5);
    setOpinion(db, { id: 2, name: "Tiède" }, 1, 1);
    const weights = getOpinionWeights(db);
    // Même centrage pour les deux : l'écart brut se retrouve tel quel.
    expect(weights.get(1)! - weights.get(2)!).toBeCloseTo(5 / 3 - 1 / 3);
  });

  it("passer en « Je n'aime pas » efface la note (AC-18)", () => {
    const db = createTestDb();
    setOpinion(db, { id: 1, name: "A" }, 1, 4);
    setOpinion(db, { id: 1, name: "A" }, -1);
    const [person] = getPeopleWithOpinions(db);
    expect(person.opinion).toBe(-1);
    expect(person.rating).toBeNull();
  });

  it("un avis redonné sans note garde la note existante", () => {
    const db = createTestDb();
    setOpinion(db, { id: 1, name: "A" }, 1, 4);
    setOpinion(db, { id: 1, name: "A" }, 1);
    expect(getPeopleWithOpinions(db)[0].rating).toBe(4);
  });
});
