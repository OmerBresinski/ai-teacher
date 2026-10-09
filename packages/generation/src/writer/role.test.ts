import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { replayRun, replayServices } from "./replay-fixture";
import {
  asks,
  firstTeaching,
  ROLE_STAMP_DEFAULT,
  type SlideRole,
  slideRole,
  slideRoles,
  visualTask,
} from "./role";

const at = (template: string, more: Record<string, unknown> = {}, index = 5, first = 2) =>
  slideRole({ template, heading: "A heading", ...more }, { index, firstTeaching: first });

describe("slideRole: one rule each, in order", () => {
  test("hinge", () => expect(at("hinge")).toBe("hinge"));
  test("practice", () => expect(at("practice")).toBe("practice"));
  test("an exit ticket checks", () => expect(at("exit-ticket")).toBe("check"));
  test("a question set before the first teaching slide retrieves", () => {
    expect(at("question-set", {}, 2, 3)).toBe("retrieval");
    expect(slideRole({ template: "question-set" }, { index: 2 })).toBe("retrieval");
  });
  test("a question set after the first teaching slide checks", () =>
    expect(at("question-set", {}, 4, 3)).toBe("check"));
  test("discussion", () => expect(at("discussion")).toBe("discuss"));
  test("each activity layout", () => {
    for (const t of ["pair", "group-sort", "sequence", "choose", "odd-one-out", "label"])
      expect(at(t)).toBe("activity");
  });
  test("steps and equation-hero are worked examples", () => {
    expect(at("steps", { lead: "Why? Watch." })).toBe("worked");
    expect(at("equation-hero")).toBe("worked");
  });
  test("a visual slide whose lead asks is a task", () =>
    expect(at("big-visual", { lead: "Which shaded part is one half? Explain why." })).toBe("task"));
  test("a visual slide whose point asks is a task (string or labelled point)", () => {
    expect(at("visual-text", { points: ["Look.", "Which is bigger?"] })).toBe("task");
    expect(at("diagram-text", { points: [{ label: "A", text: "Is it equal?" }] })).toBe("task");
  });
  test("a visual slide with an ask, instruction, prompt or questions field is a task", () => {
    for (const k of ["ask", "instruction", "prompt"])
      expect(at("picture-text", { [k]: "Point to the roots." })).toBe("task");
    expect(at("big-picture", { questions: ["Name it."] })).toBe("task");
    expect(at("big-picture", { questions: [" "], ask: "" })).toBe("teach");
  });
  test("a question as the heading alone does not make a task", () =>
    expect(
      at("visual-text", { heading: "Why do polar bears have thick fur?", lead: "Fur traps heat." }),
    ).toBe("teach"));
  test("a question on a non-visual teaching template is still teach", () =>
    expect(at("compare", { lead: "Which is faster?" })).toBe("teach"));
  test("anything else teaches", () => {
    expect(at("visual-text", { lead: "Equal parts are the same size." })).toBe("teach");
    expect(at("explain")).toBe("teach");
  });
  test("rules apply in order: a hinge with a question lead stays hinge", () =>
    expect(at("hinge", { lead: "Which?" })).toBe("hinge"));
});

describe("deck helpers", () => {
  test("asks: everything but teach and worked", () => {
    const all: SlideRole[] = [
      "teach",
      "worked",
      "retrieval",
      "check",
      "hinge",
      "practice",
      "discuss",
      "activity",
      "task",
    ];
    expect(all.filter(asks)).toEqual([
      "retrieval",
      "check",
      "hinge",
      "practice",
      "discuss",
      "activity",
      "task",
    ]);
  });
  test("visualTask needs a visual template", () =>
    expect(visualTask({ template: "explain", lead: "Why?" })).toBe(false));
  test("the first teaching slide skips asking slides; a worked example counts", () => {
    const deck = [
      { template: "title" },
      undefined,
      { template: "question-set" },
      { template: "big-visual", lead: "Predict: which?" },
      { template: "steps" },
      { template: "question-set" },
    ];
    expect(firstTeaching(deck)).toBe(4);
    expect([...slideRoles(deck)]).toEqual([
      [2, "retrieval"],
      [3, "task"],
      [4, "worked"],
      [5, "check"],
    ]);
  });
  test("no teaching slide at all: every question set retrieves", () =>
    expect([...slideRoles([undefined, undefined, { template: "question-set" }])]).toEqual([
      [2, "retrieval"],
    ]));
});

/*
 * Replay: the 12 recorded writer outputs run through the stage with roleStamp on, no model called.
 * The counts are the roles the `slide-role` log lines carry, every lesson together.
 */
const DIR = join(import.meta.dir, "fixtures/replay");
const LESSONS = readdirSync(DIR).sort();

async function stamped(b: string, roleStamp?: boolean) {
  const lines: Record<string, unknown>[] = [];
  const services = {
    ...replayServices(b),
    log: (e: object) => void lines.push(e as Record<string, unknown>),
  };
  await replayRun(b, { services, hooks: roleStamp === undefined ? {} : { roleStamp } });
  return lines.filter((e) => e.ev === "slide-role");
}

describe("roleStamp on the replay fixtures", () => {
  test("off by default: no role is logged", async () => {
    expect(ROLE_STAMP_DEFAULT).toBe(false);
    expect(await stamped(LESSONS[0] as string)).toEqual([]);
  });

  test("role counts across the 12 recorded outputs", async () => {
    const counts: Record<string, number> = {};
    for (const b of LESSONS) {
      const lines = await stamped(b, true);
      // Every written slide (from slide 3) gets one role, once.
      const slides = lines.map((e) => Number(e.slide));
      expect(new Set(slides).size).toBe(slides.length);
      expect(Math.min(...slides)).toBe(3);
      for (const e of lines) counts[String(e.role)] = (counts[String(e.role)] ?? 0) + 1;
    }
    expect(counts).toEqual({ teach: 52, practice: 32, hinge: 12, check: 5, worked: 15, task: 3 });
  }, 60_000);

  test("y2 halves: the picture asking which half is a task", async () => {
    const lines = await stamped("y2-maths-halves-quarters", true);
    expect(lines.find((e) => e.slide === 4)?.role).toBe("task");
  });

  test("y1 animals: its question set comes after teaching, so it checks", async () => {
    const lines = await stamped("y1-science-animals-young", true);
    const qs = lines.filter((e) => e.template === "question-set");
    expect(qs.length).toBeGreaterThan(0);
    for (const e of qs) expect(e.role).toBe("check");
  });
});
