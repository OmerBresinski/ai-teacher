import { describe, expect, test } from "bun:test";
import { checkObjectives, describeIssues, leadingVerb, verbLevel } from "./objectives-check";

const o = (text: string, curriculumAnchor?: string) => ({ text, curriculumAnchor });

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
});

describe("checkObjectives", () => {
  test("a ladder to the reach passes", () => {
    const r = checkObjectives(
      [
        o("Explain how substitutes affect demand"),
        o("Calculate price elasticity from a table"),
        o("Evaluate which determinant matters most for a firm"),
      ],
      "Evaluate",
      { hasSource: false },
    );
    expect(r.ok).toBe(true);
    expect(r.objectives.map((x) => x.level)).toEqual(["Explain", "Apply", "Evaluate"]);
  });

  test("all at the reach passes", () => {
    const r = checkObjectives(
      [o("Explain why Claudius invaded"), o("Explain why Boudica resisted")],
      "Explain",
      {
        hasSource: false,
      },
    );
    expect(r.ok).toBe(true);
  });

  test("no objective at the reach fails", () => {
    const r = checkObjectives(
      [o("Identify rhetorical questions"), o("Explain the rule of three")],
      "Apply",
      {
        hasSource: false,
      },
    );
    expect(r.issues).toEqual([{ kind: "reach-missing", reach: "Apply" }]);
  });

  test("three levels below the reach fails, two below passes", () => {
    const r = checkObjectives(
      [o("Recall the causes"), o("Evaluate which cause mattered most")],
      "Evaluate",
      {
        hasSource: false,
      },
    );
    expect(r.issues.map((i) => i.kind)).toEqual(["below-ladder"]);
    const ok = checkObjectives(
      [o("Explain the causes"), o("Evaluate which cause mattered most")],
      "Evaluate",
      {
        hasSource: false,
      },
    );
    expect(ok.ok).toBe(true);
  });

  test("the objective at the reach comes last; interior order is free", () => {
    const r = checkObjectives(
      [o("Evaluate which cause mattered most"), o("Explain the causes")],
      "Evaluate",
      { hasSource: false },
    );
    expect(r.issues).toEqual([{ kind: "reach-not-last", level: "Explain", reach: "Evaluate" }]);
    const ok = checkObjectives(
      [
        o("Calculate price elasticity from a table"),
        o("Explain how substitutes affect demand"),
        o("Evaluate which determinant matters most"),
      ],
      "Evaluate",
      { hasSource: false },
    );
    expect(ok.ok).toBe(true);
  });

  test("subject verbs are known", () => {
    expect(verbLevel("divide")).toBe("Apply");
    expect(verbLevel("craft")).toBe("Apply");
    expect(verbLevel("share")).toBe("Apply");
  });

  test("above the reach fails", () => {
    const r = checkObjectives([o("Recall the dates"), o("Evaluate the treaty")], "Recall", {
      hasSource: false,
    });
    expect(r.issues).toEqual([
      { kind: "above-reach", index: 1, level: "Evaluate", reach: "Recall" },
      { kind: "reach-not-last", level: "Evaluate", reach: "Recall" },
    ]);
  });

  test("forbidden and unknown verbs", () => {
    const r = checkObjectives(
      [
        o("Understand why the Romans invaded"),
        o("Flibber the facts"),
        o("Explain why Boudica resisted"),
      ],
      "Explain",
      {
        hasSource: false,
      },
    );
    expect(r.issues).toEqual([
      { kind: "forbidden-verb", index: 0, verb: "understand" },
      { kind: "unknown-verb", index: 1, verb: "flibber" },
    ]);
  });

  test("anchors: forbidden without a source, required with one", () => {
    const without = checkObjectives(
      [o("Explain why Claudius invaded", "the Roman Empire")],
      "Explain",
      {
        hasSource: false,
      },
    );
    expect(without.issues).toEqual([{ kind: "anchor-without-source", index: 0 }]);
    const withSource = checkObjectives([o("Explain why Claudius invaded")], "Explain", {
      hasSource: true,
    });
    expect(withSource.issues).toEqual([{ kind: "anchor-missing", index: 0 }]);
  });

  test("word limit", () => {
    const long = `Explain ${"word ".repeat(16).trim()}`;
    const r = checkObjectives([o(long)], "Explain", { hasSource: false });
    expect(r.issues).toEqual([{ kind: "too-long", index: 0, words: 17 }]);
  });

  test("describeIssues reads as one line each", () => {
    const r = checkObjectives([o("Understand rivers")], "Explain", { hasSource: false });
    expect(describeIssues(r.issues)).toEqual([
      'objective 1 starts with "understand", which cannot be observed',
      "no objective reaches Explain",
    ]);
  });
});
