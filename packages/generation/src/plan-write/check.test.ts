import { describe, expect, it } from "bun:test";
import type { PlanLessonOutput, PlanMenuEntry, PlanSlide } from "../prompts/plan-lesson";
import { blocking, checkPlan } from "./check";
import { layoutCapacity, planMenu } from "./menu";

const row = (over: Partial<PlanSlide>): PlanSlide => ({
  role: "teach",
  objectives: [1, 2],
  form: "explain",
  layout: "default",
  purpose: "p",
  parts: 1,
  teaches: ["idea"],
  tests: [],
  imageBrief: null,
  figureBrief: null,
  ...over,
});
const title = row({ role: "title", form: "title", objectives: [1, 2], teaches: [] });
const goals = row({ role: "objectives", form: "objectives", objectives: [1, 2], teaches: [] });
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
      goals,
      row({ form: "starter-set", tests: ["prior"] }),
      row({ teaches: ["cause"] }),
      row({ form: "hinge", parts: 4, tests: ["Cause "] }),
    ]);
    const c = checkPlan(p, { slideCount: 5, menu });
    expect(c.problems).toEqual([]);
    expect(c.switched).toEqual([]);
    expect(c.plan).toEqual(p);
  });

  it("wants exactly N slides, the title first and the objectives second", () => {
    const c = checkPlan(plan([row({}), row({}), row({})]), { slideCount: 4, menu });
    expect(c.problems.map((p) => p.rule).sort()).toEqual(["count", "title", "title"]);
    expect(c.problems.map((p) => p.slide)).toContain(2);
    expect(blocking(c.problems)).toHaveLength(3);
  });

  it("refuses a form or layout that is not on the menu", () => {
    const c = checkPlan(plan([title, goals, row({ form: "poster" })]), { slideCount: 3, menu });
    expect(c.problems).toMatchObject([{ rule: "form", slide: 3 }]);
  });

  it("switches to a sibling layout that holds the parts", () => {
    const c = checkPlan(plan([title, goals, row({ form: "sequence", parts: 5 })]), {
      slideCount: 3,
      menu,
    });
    expect(c.problems).toEqual([]);
    expect(c.switched).toEqual([{ slide: 3, form: "sequence", from: "default", to: "tall" }]);
    expect(c.plan.slides[2]?.layout).toBe("tall");
  });

  it("names parts no layout holds, and an unknown layout with no fitting sibling", () => {
    const over = checkPlan(plan([title, goals, row({ form: "sequence", parts: 7 })]), {
      slideCount: 3,
      menu,
    });
    expect(over.problems).toMatchObject([{ rule: "capacity", slide: 3 }]);
    expect(blocking(over.problems)).toEqual([]);
    const unknown = checkPlan(plan([title, goals, row({ layout: "wide" })]), {
      slideCount: 3,
      menu,
    });
    expect(unknown.switched).toEqual([{ slide: 3, form: "explain", from: "wide", to: "default" }]);
  });

  it("flags a check whose target no earlier slide teaches", () => {
    const later = checkPlan(
      plan([
        title,
        goals,
        row({ form: "hinge", parts: 4, tests: ["cause"] }),
        row({ teaches: ["cause"] }),
      ]),
      { slideCount: 4, menu },
    );
    expect(later.problems).toMatchObject([{ rule: "untaught", slide: 3 }]);
    const none = checkPlan(plan([title, goals, row({ form: "hinge", parts: 4 })]), {
      slideCount: 3,
      menu,
    });
    expect(none.problems).toMatchObject([{ rule: "untaught", slide: 3 }]);
  });

  it("flags an objective the lesson does not have", () => {
    const c = checkPlan(plan([title, goals, row({ objectives: [3] })]), { slideCount: 3, menu });
    expect(c.problems.filter((p) => p.slide !== undefined)).toMatchObject([
      { rule: "objective", slide: 3 },
    ]);
  });

  it("flags an objective no slide teaches (UX ruling 135)", () => {
    const c = checkPlan(plan([title, goals, row({ objectives: [1] })]), { slideCount: 3, menu });
    expect(c.problems).toMatchObject([{ rule: "objective" }]);
    expect(c.problems[0]?.message).toContain("Objective 2 is taught on no slide");
  });
});

describe("plan-write menu", () => {
  it("lists every layout with its contract, the question sets included", () => {
    const m = planMenu("science");
    expect(m.filter((e) => e.form === "hinge").map((e) => e.layout)).toEqual(["default", "why"]);
    expect(m.find((e) => e.form === "diagram-slot")?.contract).toContain("diagram spec");
    expect(m.find((e) => e.form === "sequence")?.capacity).toBe(4);
    expect(m.find((e) => e.form === "exit-ticket")?.contract).toContain("questions:");
    expect(m.every((e) => e.contract.length > 0)).toBe(true);
    expect(layoutCapacity("list", "default")).toBe(2);
  });
});
