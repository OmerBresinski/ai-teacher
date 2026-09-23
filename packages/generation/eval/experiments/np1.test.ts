import { describe, expect, test } from "bun:test";
import { np1Briefs } from "../briefs";
import {
  checkFrozen,
  currentPromptHashes,
  expectedSpend,
  levers,
  loadExperiment,
  runBriefs,
  topicForBrief,
} from "./np1";

describe("experiment np1", () => {
  const exp = loadExperiment();

  test("the file parses and every run brief has a pack topic and a brief fixture", () => {
    const briefs = runBriefs(exp);
    expect(briefs).toEqual([
      "y4-history-romans",
      "y10-history-ww1-causes",
      "y7-science-cells",
      "y9-history-russian-revolution",
      "y12-economics-externalities",
    ]);
    const ids = new Set(np1Briefs().map((b) => b.id));
    for (const id of [...briefs, ...exp.briefs.reserve]) {
      expect(ids.has(id)).toBe(true);
      expect(topicForBrief(exp, id)).toBeDefined();
    }
    // Held-out briefs are not in the eval set the lab has tuned against, nor among the prompt
    // bake-off's test topics (photosynthesis, WW1 causes, Freud), which shaped these prompts.
    expect(
      exp.briefs.heldOut.every(
        (id) =>
          ![
            "y4-history-romans",
            "y6-maths-ratio",
            "y8-science-particles",
            "y10-history-cold-war",
            "y8-science-photosynthesis",
            "y10-history-ww1-causes",
            "y13-psychology-freud-critics",
          ].includes(id),
      ),
    ).toBe(true);
  });

  test("the frozen check names changed, added and removed prompts", () => {
    const current = currentPromptHashes();
    expect(Object.keys(current)).toContain("plan-objectives");
    expect(Object.keys(current)).toContain("pack-select");
    expect(Object.keys(current)).toContain("rubric-judge");
    const frozen = { ...exp, promptHashes: { ...current } };
    expect(checkFrozen(frozen, current).ok).toBe(true);
    const drifted = { ...current, "pack-select": "0".repeat(64) };
    const c = checkFrozen(frozen, drifted);
    expect(c.ok).toBe(false);
    expect(c.changed).toEqual(["pack-select"]);
    const c2 = checkFrozen({ ...exp, promptHashes: {} }, current);
    expect(c2.added.length).toBe(Object.keys(current).length);
  });

  test("expected spend covers authoring, checks, lessons and judge, and the levers only lower it", () => {
    const { lines, total } = expectedSpend(exp);
    // Reduced scope: two rewrite arms (no sol-knowledge), each with two checkers.
    expect(lines.filter((l) => l.item.startsWith("author")).length).toBe(2);
    expect(lines.filter((l) => l.item.startsWith("check")).length).toBe(4);
    expect(lines.filter((l) => l.item.startsWith("lessons")).length).toBe(3);
    expect(lines.filter((l) => l.item.startsWith("judge")).length).toBe(2);
    expect(total).toBeGreaterThan(0);
    // With one repeat the "one repeat" lever changes nothing; no lever may raise the total.
    for (const l of levers(exp)) expect(l.total).toBeLessThanOrEqual(total);
  });
});
