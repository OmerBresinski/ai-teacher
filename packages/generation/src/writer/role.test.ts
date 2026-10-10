import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { replayRun, replayServices } from "./replay-fixture";
import {
  asks,
  firstTeaching,
  hidesAnswer,
  ROLE_ASK_DEFAULT,
  ROLE_STAMP_DEFAULT,
  type SlideRole,
  slideHidesAnswer,
  slideRole,
  slideRoles,
  visualTask,
} from "./role";

const at = (template: string, more: Record<string, unknown> = {}, index = 5, first = 2) =>
  slideRole({ template, heading: "A heading", ...more }, { index, firstTeaching: first });

describe("roleAsk", () => {
  test("is on by default (TEACH-312 part e)", () => expect(ROLE_ASK_DEFAULT).toBe(true));
  test("slideHidesAnswer: a visual task and a question set hide; teaching and worked slides do not", () => {
    expect(
      slideHidesAnswer({ template: "big-visual", lead: "Find how many are in one group." }),
    ).toBe(true);
    expect(slideHidesAnswer({ template: "question-set", questions: ["1 + 1"] })).toBe(true);
    expect(
      slideHidesAnswer({ template: "big-visual", heading: "Which number tells us to divide?" }),
    ).toBe(false);
    expect(slideHidesAnswer({ template: "steps" })).toBe(false);
  });
  test("a discussion asks but hides nothing; an activity hides its answer (contract)", () => {
    expect(asks("discuss")).toBe(true);
    expect(hidesAnswer("discuss")).toBe(false);
    expect(slideHidesAnswer({ template: "discussion", prompt: "Is it fair?" })).toBe(false);
    expect(hidesAnswer("activity")).toBe(true);
    expect(slideHidesAnswer({ template: "label" })).toBe(true);
    expect(hidesAnswer("teach")).toBe(false);
    expect(hidesAnswer("worked")).toBe(false);
  });
});

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
  test("a visual slide whose lead or point sentence opens with an ask verb is a task", () => {
    expect(
      at("big-visual", { lead: "Draw two equal groups. Find how many are in one group." }),
    ).toBe("task");
    expect(at("big-visual", { lead: "Write half or quarter for A, B and C." })).toBe("task");
    expect(at("visual-text", { points: [{ label: "Try", text: "Count the legs." }] })).toBe("task");
  });
  test("a worked lead that shares and states its answer still teaches", () =>
    expect(
      at("big-visual", {
        lead: "Share into two equal groups. One group has 6: one half of 12 is 6.",
      }),
    ).toBe("teach"));
  test("an ask verb on a slide that gives a result on another line still teaches (d52)", () => {
    expect(
      at("visual-text", {
        points: [
          "Share 12 counters equally into two groups.",
          "Put one counter in each group. Keep going.",
          "Count one group: half of 12 is 6.",
        ],
      }),
    ).toBe("teach");
    expect(
      at("visual-text", {
        points: ["Count beats for 30 seconds.", "Example: 36 × 2 = 72 beats per minute."],
      }),
    ).toBe("teach");
    expect(
      at("visual-text", {
        points: ["Find one half and one quarter of 12.", "Two equal groups: one half is 6."],
      }),
    ).toBe("teach");
  });
  test("an ask verb after a colon or semicolon is not a new sentence", () => {
    expect(at("visual-text", { points: ["Steps: write the numerator first."] })).toBe("teach");
    expect(at("visual-text", { lead: "Remember: name the parts." })).toBe("teach");
    expect(at("visual-text", { lead: "Share equally; count one group." })).toBe("teach");
  });
  test("a question word without a question mark does not make a task", () => {
    expect(at("big-visual", { lead: "Which is why plants need light." })).toBe("teach");
    expect(at("big-visual", { lead: "What happens next depends on the light." })).toBe("teach");
    expect(at("big-visual", { lead: "Which shaded part is one half?" })).toBe("task");
  });
  test("a result in words, or by makes, gives, equals or are, keeps the slide teaching", () => {
    for (const result of [
      "Half of 12 makes 6.",
      "The answer is six.",
      "Sharing gives 3 in each group.",
      "Half of 12 equals six.",
      "There are 4 in each group.",
    ])
      expect(at("visual-text", { points: ["Count one group.", result] })).toBe("teach");
    // An instruction to make or give is not a result.
    expect(at("big-visual", { lead: "Make 2 equal groups. Count one group." })).toBe("task");
    // "equal groups" is not "equals".
    expect(
      at("big-visual", { lead: "Draw two equal groups. Find how many are in one group." }),
    ).toBe("task");
    // "is one" is not read as a result ("is one of"), so the task stands.
    expect(at("big-visual", { lead: "Name the part that is one half." })).toBe("task");
  });
  test("match is advice on a visual slide, not an ask", () =>
    expect(
      at("visual-text", {
        lead: "All three mean “my”. Match the French noun, not the person speaking.",
        points: ["mon: masculine singular", "ma: feminine singular", "mes: plural"],
      }),
    ).toBe("teach"));
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
  test("on by default; off logs no role", async () => {
    expect(ROLE_STAMP_DEFAULT).toBe(true);
    expect(await stamped(LESSONS[0] as string, false)).toEqual([]);
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
    // roleAsk: 7 replay slides whose lead or point opens with an ask verb ("Your turn: Find one half
    // of 10. Count one group.") moved from teach to task (step 1 counted teach 52, task 3); the y8
    // French "Match the French noun" advice slide stays teach. TEACH-247 part q: y11-r2 s3 teaches
    // in one point and asks "Predict what happens…" in the other, so it teaches (task 10 → 9).
    expect(counts).toEqual({ teach: 46, practice: 32, hinge: 12, check: 5, worked: 15, task: 9 });
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
