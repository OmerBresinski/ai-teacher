import { describe, expect, test } from "bun:test";
import {
  checkObjectives,
  describeIssues,
  describeMetrics,
  leadingVerb,
  verbLevel,
} from "./objectives-check";

const o = (text: string, curriculumAnchor?: string) => ({ text, curriculumAnchor });
const none = { hasSource: false };

describe("leadingVerb / verbLevel", () => {
  test("first word, lower-cased, punctuation stripped", () => {
    expect(leadingVerb("Explain, how rivers erode")).toBe("explain");
    expect(leadingVerb("  Evaluate which cause mattered most")).toBe("evaluate");
    expect(leadingVerb("")).toBe("");
  });
  test("levels", () => {
    expect(verbLevel("recall")).toBe("Recall");
    expect(verbLevel("describe")).toBe("Recall");
    expect(verbLevel("explain")).toBe("Explain");
    expect(verbLevel("solve")).toBe("Apply");
    expect(verbLevel("judge")).toBe("Evaluate");
    expect(verbLevel("understand")).toBeUndefined();
    expect(verbLevel("banana")).toBeUndefined();
  });
  test("subject verbs are known", () => {
    expect(verbLevel("divide")).toBe("Apply");
    expect(verbLevel("craft")).toBe("Apply");
    expect(verbLevel("share")).toBe("Apply");
  });
});

/*
 * 23 Sept 2026: the check judges shape only. An empty set, empty text, a literal banned opener, the
 * word limit and the anchor rules are issues and fail the set. The Bloom level of the verb and the
 * ladder to the reach are metrics: measured for the lab, never blocking, never a retry.
 */
describe("checkObjectives: structural issues block", () => {
  test("a clean set passes with no issues and no metrics", () => {
    const r = checkObjectives(
      [
        o("Explain how substitutes affect demand"),
        o("Calculate price elasticity from a table"),
        o("Evaluate which determinant matters most for a firm"),
      ],
      "Evaluate",
      none,
    );
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.metrics).toEqual([]);
    expect(r.objectives.map((x) => x.level)).toEqual(["Explain", "Apply", "Evaluate"]);
  });

  test("an empty set is an error, and its retry line asks for one", () => {
    const r = checkObjectives([], "Explain", none);
    expect(r.ok).toBe(false);
    expect(r.issues).toEqual([{ kind: "no-objectives" }]);
    expect(r.metrics).toEqual([]);
    expect(describeIssues(r.issues)).toEqual(["there are no objectives; give at least one"]);
  });

  test("empty or blank text is an issue, not an unknown verb", () => {
    const r = checkObjectives([o("   "), o("Explain why Boudica resisted")], "Explain", none);
    expect(r.issues).toEqual([{ kind: "empty-text", index: 0 }]);
    expect(r.metrics).toEqual([]);
    expect(describeIssues(r.issues)).toEqual(["objective 1 is empty"]);
  });

  test("a banned opener is an issue; the ladder is untouched by it", () => {
    const r = checkObjectives(
      [o("Understand why the Romans invaded"), o("Explain why Boudica resisted")],
      "Explain",
      none,
    );
    expect(r.ok).toBe(false);
    expect(r.issues).toEqual([{ kind: "forbidden-verb", index: 0, verb: "understand" }]);
    expect(r.metrics).toEqual([]);
    expect(describeIssues(r.issues)).toEqual([
      'objective 1 starts with "understand", which cannot be observed',
    ]);
  });

  test("word limit", () => {
    const long = `Explain ${"word ".repeat(16).trim()}`;
    const r = checkObjectives([o(long)], "Explain", none);
    expect(r.issues).toEqual([{ kind: "too-long", index: 0, words: 17 }]);
    expect(r.ok).toBe(false);
  });

  test("anchors: forbidden without a source, required with one", () => {
    const without = checkObjectives(
      [o("Explain why Claudius invaded", "the Roman Empire")],
      "Explain",
      none,
    );
    expect(without.issues).toEqual([{ kind: "anchor-without-source", index: 0 }]);
    const withSource = checkObjectives([o("Explain why Claudius invaded")], "Explain", {
      hasSource: true,
    });
    expect(withSource.issues).toEqual([{ kind: "anchor-missing", index: 0 }]);
  });

  test("four objectives pass; the size is the schema's bound, not the check's", () => {
    const set = Array.from({ length: 4 }, (_, i) =>
      o(`Explain why the Romans built road ${i + 1}`),
    );
    expect(checkObjectives(set, "Explain", none).ok).toBe(true);
  });
});

describe("checkObjectives: verb-level results are metrics and never block", () => {
  test("an unknown verb is measured, and the set still passes", () => {
    const r = checkObjectives(
      [o("Flibber the facts"), o("Explain why Boudica resisted")],
      "Explain",
      none,
    );
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.metrics).toEqual([{ kind: "unknown-verb", index: 0, verb: "flibber" }]);
    expect(describeMetrics(r.metrics)).toEqual([
      'objective 1 starts with "flibber", not in the verb table',
    ]);
  });

  test("no objective at the reach is measured, not failed", () => {
    const r = checkObjectives(
      [o("Identify rhetorical questions"), o("Explain the rule of three")],
      "Apply",
      none,
    );
    expect(r.ok).toBe(true);
    expect(r.metrics).toEqual([{ kind: "reach-missing", reach: "Apply" }]);
    expect(describeMetrics(r.metrics)).toEqual(["no objective reaches Apply"]);
  });

  test("three levels below the reach is measured; two below is clean", () => {
    const r = checkObjectives(
      [o("Recall the causes"), o("Evaluate which cause mattered most")],
      "Evaluate",
      none,
    );
    expect(r.ok).toBe(true);
    expect(r.metrics.map((m) => m.kind)).toEqual(["below-ladder"]);
    const clean = checkObjectives(
      [o("Explain the causes"), o("Evaluate which cause mattered most")],
      "Evaluate",
      none,
    );
    expect(clean.metrics).toEqual([]);
  });

  test("the reach not last is measured; interior order is free", () => {
    const r = checkObjectives(
      [o("Evaluate which cause mattered most"), o("Explain the causes")],
      "Evaluate",
      none,
    );
    expect(r.ok).toBe(true);
    expect(r.metrics).toEqual([{ kind: "reach-not-last", level: "Explain", reach: "Evaluate" }]);
    const free = checkObjectives(
      [
        o("Calculate price elasticity from a table"),
        o("Explain how substitutes affect demand"),
        o("Evaluate which determinant matters most"),
      ],
      "Evaluate",
      none,
    );
    expect(free.metrics).toEqual([]);
  });

  test("above the reach is measured", () => {
    const r = checkObjectives([o("Recall the dates"), o("Evaluate the treaty")], "Recall", none);
    expect(r.ok).toBe(true);
    expect(r.metrics).toEqual([
      { kind: "above-reach", index: 1, level: "Evaluate", reach: "Recall" },
      { kind: "reach-not-last", level: "Evaluate", reach: "Recall" },
    ]);
  });

  test("one objective at the reach is clean for every reach; one below is a metric only", () => {
    const one = {
      Recall: "Name the planets of the solar system",
      Explain: "Explain why the Romans invaded Britain",
      Apply: "Calculate the area of a triangle",
      Evaluate: "Evaluate how far Boudica's revolt threatened Roman rule",
    } as const;
    for (const [reach, text] of Object.entries(one)) {
      const r = checkObjectives([o(text)], reach as keyof typeof one, none);
      expect(r.issues).toEqual([]);
      expect(r.metrics).toEqual([]);
    }
    const below = checkObjectives([o("Explain what elasticity measures")], "Evaluate", none);
    expect(below.ok).toBe(true);
    expect(below.metrics).toEqual([{ kind: "reach-missing", reach: "Evaluate" }]);
  });

  test("issues and metrics are reported apart, so a retry message carries no verb judgement", () => {
    const r = checkObjectives([o("Understand rivers"), o("Flibber the delta")], "Explain", none);
    expect(describeIssues(r.issues)).toEqual([
      'objective 1 starts with "understand", which cannot be observed',
    ]);
    expect(describeMetrics(r.metrics)).toEqual([
      'objective 2 starts with "flibber", not in the verb table',
      "no objective reaches Explain",
    ]);
  });
});
