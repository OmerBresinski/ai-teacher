import { describe, expect, it } from "bun:test";
import type { PlanLessonOutput, PlanMenuEntry, PlanSlide } from "../prompts/plan-lesson";
import { blocking, checkPlan } from "./check";
import { layoutCapacity, planMenu } from "./menu";

const row = (over: Partial<PlanSlide>): PlanSlide => ({
  role: "teach",
  objectives: [1],
  form: "explain",
  layout: "default",
  purpose: "p",
  parts: 1,
  teaches: [],
  tests: [],
  imageBrief: null,
  figureBrief: null,
  ...over,
});
const title = row({ role: "title", form: "title", objectives: [1, 2] });
const plan = (slides: PlanSlide[]): PlanLessonOutput => ({
  objectives: ["one", "two"],
  runningExample: "a loaf of bread",
  misconception: "m",
  slides,
});
const menu: PlanMenuEntry[] = [
  { form: "explain", layout: "default", capacity: 3, contract: "explain:" },
  { form: "sequence", layout: "default", capacity: 4, contract: "sequence:" },
  { form: "sequence", layout: "tall", capacity: 6, contract: "sequence (tall):" },
  { form: "hinge", layout: "default", capacity: 4, contract: "hinge:" },
  { form: "starter-set", layout: "default", capacity: 3, contract: "starter-set:" },
];

describe("plan-write code check", () => {
  it("passes a sound plan untouched", () => {
    const p = plan([
      title,
      row({ form: "starter-set", tests: ["prior"] }),
      row({ teaches: ["cause"] }),
      row({ form: "hinge", parts: 4, tests: ["Cause "] }),
    ]);
    const c = checkPlan(p, { slideCount: 4, menu });
    expect(c.problems).toEqual([]);
    expect(c.switched).toEqual([]);
    expect(c.plan).toEqual(p);
  });

  it("wants exactly N slides and the title first", () => {
    const c = checkPlan(plan([row({}), row({})]), { slideCount: 3, menu });
    expect(c.problems.map((p) => p.rule).sort()).toEqual(["count", "title"]);
    expect(blocking(c.problems)).toHaveLength(2);
  });

  it("refuses a form or layout that is not on the menu", () => {
    const c = checkPlan(plan([title, row({ form: "poster" })]), { slideCount: 2, menu });
    expect(c.problems).toMatchObject([{ rule: "form", slide: 2 }]);
  });

  it("switches to a sibling layout that holds the parts", () => {
    const c = checkPlan(plan([title, row({ form: "sequence", parts: 5 })]), {
      slideCount: 2,
      menu,
    });
    expect(c.problems).toEqual([]);
    expect(c.switched).toEqual([{ slide: 2, form: "sequence", from: "default", to: "tall" }]);
    expect(c.plan.slides[1]?.layout).toBe("tall");
  });

  it("names parts no layout holds, and an unknown layout with no fitting sibling", () => {
    const over = checkPlan(plan([title, row({ form: "sequence", parts: 7 })]), {
      slideCount: 2,
      menu,
    });
    expect(over.problems).toMatchObject([{ rule: "capacity", slide: 2 }]);
    expect(blocking(over.problems)).toEqual([]);
    const unknown = checkPlan(plan([title, row({ layout: "wide" })]), { slideCount: 2, menu });
    expect(unknown.switched).toEqual([{ slide: 2, form: "explain", from: "wide", to: "default" }]);
  });

  it("flags a check whose target no earlier slide teaches", () => {
    const later = checkPlan(
      plan([
        title,
        row({ form: "hinge", parts: 4, tests: ["cause"] }),
        row({ teaches: ["cause"] }),
      ]),
      { slideCount: 3, menu },
    );
    expect(later.problems).toMatchObject([{ rule: "untaught", slide: 2 }]);
    const none = checkPlan(plan([title, row({ form: "hinge", parts: 4 })]), {
      slideCount: 2,
      menu,
    });
    expect(none.problems).toMatchObject([{ rule: "untaught", slide: 2 }]);
  });

  it("flags an objective the lesson does not have", () => {
    const c = checkPlan(plan([title, row({ objectives: [3] })]), { slideCount: 2, menu });
    expect(c.problems).toMatchObject([{ rule: "objective", slide: 2 }]);
  });
});

describe("plan-write menu", () => {
  it("lists every layout with its contract, the question sets included", () => {
    const m = planMenu("science");
    expect(m.filter((e) => e.form === "hinge").map((e) => e.layout)).toEqual(["default", "why"]);
    expect(m.find((e) => e.form === "sequence")?.capacity).toBe(4);
    expect(m.find((e) => e.form === "exit-ticket")?.contract).toContain("questions:");
    expect(m.every((e) => e.contract.length > 0)).toBe(true);
    expect(layoutCapacity("list", "default")).toBe(2);
  });
});
