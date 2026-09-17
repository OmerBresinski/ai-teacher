import { describe, expect, test } from "bun:test";
import { assignFactIds } from "../specs";
import { FIXTURES } from "../testing";
import { stemPlan } from "./question-pool";

const facts = () => assignFactIds(FIXTURES.planSkeleton, FIXTURES.planFacts, 60);

describe("stemPlan (question-pool)", () => {
  test("Generation quality §3: each slide is reserved every stem another entry owns and the unclaimed worksheet stems; its own, and unclaimed slide stems, are open", () => {
    const f = facts();
    const mc = f.outline.findIndex((e) => e.kind === "multiple-choice");
    if (mc === -1) throw new Error("fixture");
    const owner = new Map<string, number>();
    f.outline.forEach((e, i) => {
      for (const ref of e.factRefs) if (!owner.has(ref)) owner.set(ref, i);
    });
    // The slide's own references come first (q1 is also the starter's, and open to both).
    const own = new Set(f.outline[mc]?.factRefs);
    expect(own.has("q1")).toBe(true);
    // q3 is a `slide` question no entry of the ten-slide fixture claims: open to any slide.
    expect(owner.has("q3")).toBe(false);
    const reserved = stemPlan(f).reservedFor(mc);
    for (const q of f.questions) {
      const o = owner.get(q.id);
      const expected = own.has(q.id) ? false : o === undefined ? q.use === "worksheet" : o !== mc;
      expect({ id: q.id, reserved: reserved.includes(q.stem) }).toEqual({
        id: q.id,
        reserved: expected,
      });
    }
  });

  test("the sheet's pool is the worksheet/any questions less any a slide claims; slide, exit and claimed stems are reserved from it", () => {
    const f = facts();
    const { pool, reservedForWorksheet } = stemPlan(f);
    const claimed = new Set(f.outline.flatMap((e) => e.factRefs));
    for (const q of f.questions) {
      const owned = claimed.has(q.id) && q.use !== "any";
      const inPool = (q.use === "worksheet" || q.use === "any") && !owned;
      expect({ id: q.id, inPool: pool.some((p) => p.id === q.id) }).toEqual({ id: q.id, inPool });
      const reserved = q.use === "slide" || q.use === "exit" || owned;
      expect({ id: q.id, reserved: reservedForWorksheet.includes(q.stem) }).toEqual({
        id: q.id,
        reserved,
      });
    }
  });

  test("TEACH-244: stemPlan drops a worksheet question a slide claims from the sheet's pool; `any` stays", () => {
    const f = facts();
    const sheetQ = f.questions.find((q) => q.use === "worksheet");
    const anyQ = f.questions.find((q) => q.use === "any");
    if (!sheetQ || !anyQ) throw new Error("fixture");
    const claim = (id: string) => ({
      ...f,
      outline: f.outline.map((e, i) => (i === 5 ? { ...e, factRefs: [...e.factRefs, id] } : e)),
    });
    const owned = stemPlan(claim(sheetQ.id));
    expect(owned.pool.map((q) => q.id)).not.toContain(sheetQ.id);
    expect(owned.reservedForWorksheet).toContain(sheetQ.stem);
    expect(stemPlan(claim(anyQ.id)).pool.map((q) => q.id)).toContain(anyQ.id);
    expect(stemPlan(f).pool.map((q) => q.id)).toContain(sheetQ.id);
  });

  test("ADR 0030 item 2: the split depends on the questions and the outline's references only, so both jobs compute the same one", () => {
    const f = facts();
    const { pool, reservedForWorksheet } = stemPlan(f);
    const { pool: pool2, reservedForWorksheet: reserved2 } = stemPlan({
      ...f,
      vocabulary: [],
      workedExamples: [],
      misconceptions: [],
      keyIdeas: [],
    });
    expect(pool2).toEqual(pool);
    expect(reserved2).toEqual(reservedForWorksheet);
  });
});
