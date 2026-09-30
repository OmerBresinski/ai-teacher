import { describe, expect, test } from "bun:test";
import { generatedLesson, lesson } from "./fixtures.test-helpers";
import { parseLesson } from "./lesson";
import { CURRENT_VERSION, DocumentParseError, migrate } from "./migrate";

describe("migrate", () => {
  test("a version-less document is treated as the current shape", () => {
    const { version: _v, ...doc } = lesson();
    expect(migrate(doc)).toEqual({ ...doc, version: CURRENT_VERSION });
  });

  test("the current version passes through untouched", () => {
    const doc = lesson();
    expect(migrate(doc)).toBe(doc);
  });

  test("a version-1 lesson with the old { id, text } misconception shape is mapped to the new one", () => {
    const doc = generatedLesson() as unknown as { facts: Record<string, unknown> };
    doc.facts.misconceptions = [{ id: "m1", text: "Clouds are vapour." }];
    const migrated = migrate(doc) as { facts: { misconceptions: unknown[] } };
    expect(migrated.facts.misconceptions).toEqual([
      { id: "m1", belief: "Clouds are vapour.", correction: "", objectiveRefs: [] },
    ]);
    expect(parseLesson(migrated).facts?.misconceptions).toHaveLength(1);
    // An empty list, the shape every stored lesson has, is untouched: identity.
    const clean = generatedLesson();
    expect(migrate(clean)).toBe(clean);
  });

  test("objective arcs are additive: a lesson without them is untouched, one with them parses", () => {
    const clean = generatedLesson();
    expect(migrate(clean)).toBe(clean);
    const doc = generatedLesson();
    const facts = doc.facts as NonNullable<typeof doc.facts>;
    const [first, ...rest] = facts.objectives;
    const arc = { angle: "Why leaves are green", lean: "photo", misconception: "Plants eat soil" };
    const withArc = {
      ...doc,
      facts: { ...facts, objectives: [{ ...(first as object), arc }, ...rest] },
    };
    expect(migrate(withArc)).toBe(withArc);
    expect(parseLesson(withArc).facts?.objectives[0]?.arc).toEqual(arc);
    const bad = {
      ...doc,
      facts: { ...facts, objectives: [{ ...(first as object), arc: { angle: "x" } }, ...rest] },
    };
    expect(() => parseLesson(bad)).toThrow(DocumentParseError);
  });

  test("a document from a future version is refused with TeachDeck's message", () => {
    expect(() => migrate({ ...lesson(), version: 2 })).toThrow(
      "This file was made with a newer version of TeachDeck (document version 2).",
    );
    // The same named error the parsers throw, so the API maps both to 422.
    expect(() => migrate({ ...lesson(), version: 2 })).toThrow(DocumentParseError);
    expect(() => parseLesson({ ...lesson(), slides: "no" })).toThrow(DocumentParseError);
  });

  test("non-objects pass through so the schema reports them", () => {
    expect(migrate(null)).toBeNull();
    expect(migrate("text")).toBe("text");
  });
});
