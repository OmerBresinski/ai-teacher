import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fillTemplate } from "./harness";
import { coverage, lessonNotes, notesText, renderedLines, repairObjectives } from "./round4";

const fx = JSON.parse(readFileSync(`${import.meta.dir}/fixtures/y11-r3-flow.json`, "utf8")) as {
  flow: { slide: number; does: string; teaches: number[] }[];
  templates: (string | null)[];
  objectives: { teacher: string }[];
};
const tplOf = (t: (string | null)[]) => (k: number) => t[k - 1] ?? undefined;

test("y11 round 3: catalysts (3) untaught and unchecked; 2 taught but never checked alone", () => {
  const c = coverage(fx.flow, 3, tplOf(fx.templates));
  expect(c.untaught).toEqual([3]);
  expect(c.missing).toContain(3);
});

test("objective repair replaces slides one for one and keeps it only when coverage passes", async () => {
  const slides = fx.templates.map((t) => (t ? { template: t, heading: "x" } : undefined));
  const plan = { flow: fx.flow, slides: slides as Record<string, unknown>[] };
  const events: object[] = [];
  const chat = async () => ({
    usd: 0.004,
    ms: 5,
    out: {
      changes: [
        { n: 9, teaches: [3], slide: { template: "visual-text", heading: "Catalysts" } },
        { n: 10, teaches: [2, 3], slide: { template: "hinge", heading: "Which is a catalyst?" } },
      ],
    },
  });
  // Objective 2 is checked on the hinge (s10) already, objective 1 on practice (s7).
  const r = await repairObjectives({
    plan,
    objectives: fx.objectives.map((o) => o.teacher),
    context: "ctx",
    system: "sys",
    schema: {},
    chat: chat as never,
    log: (e) => events.push(e),
    onUsd: () => {},
  });
  expect(r.before.missing).toContain(3);
  expect(r.repaired).toBe(true);
  expect(r.plan.slides.length).toBe(plan.slides.length);
  expect(r.plan.slides[8]).toMatchObject({ heading: "Catalysts" });
  expect(plan.slides[8]).toMatchObject({ template: "compare" });
  expect(events.at(-1)).toMatchObject({ ev: "objective-repair", changed: [9, 10], kept: "repair" });
});

test("a repair that leaves an objective missing, or touches slide 1 or 2, is discarded", async () => {
  const slides = fx.templates.map((t) => (t ? { template: t } : undefined));
  const chat = async () => ({
    usd: 0.004,
    ms: 5,
    out: { changes: [{ n: 2, teaches: [3], slide: { template: "explain" } }] },
  });
  const r = await repairObjectives({
    plan: { flow: fx.flow, slides: slides as Record<string, unknown>[] },
    objectives: ["a", "b", "c"],
    context: "",
    system: "",
    schema: {},
    chat: chat as never,
    log: () => {},
    onUsd: () => {},
  });
  expect(r.repaired).toBe(false);
  expect(r.plan.slides[1]).toBeUndefined();
});

test("rendered lines join option badges to their text and list only placed visuals", () => {
  const t = (text: string, name = "Text") => ({
    type: "text",
    name,
    doc: { content: [{ content: [{ text }] }] },
  });
  const out = renderedLines(
    7,
    [
      t("Choose the best explanation", "Heading"),
      t("Why?"),
      t("A"),
      t("Smaller"),
      t("B"),
      t("Space"),
    ],
    ["Picture: a syringe"],
  );
  expect(out).toBe(
    "Slide 7: Choose the best explanation\nWhy?\nA. Smaller\nB. Space\nPicture: a syringe",
  );
});

test("lesson notes retry once, fill missing slides with empty notes, and keep answers", async () => {
  let calls = 0;
  const events: { ev: string }[] = [];
  const chat = async () => {
    calls++;
    if (calls === 1) throw new Error("socket hang up");
    return {
      usd: 0.002,
      ms: 9,
      out: { slides: [{ n: 3, answers: "21", misconceptions: null, background: "Bars." }] },
    };
  };
  const got = await lessonNotes({
    slides: 4,
    system: "",
    user: "",
    schema: {},
    chat: chat as never,
    log: (e) => events.push(e as { ev: string }),
    onUsd: () => {},
  });
  expect(calls).toBe(2);
  expect(got.size).toBe(4);
  expect(got.get(3)?.answers).toBe("21");
  expect(notesText(got.get(3))).toBe("Answers\n21\n\nBackground\nBars.");
  expect(notesText(got.get(1))).toBe("");
  expect(events.map((e) => e.ev)).toEqual(["notes-error", "notes"]);
});

test("challenge defaults to core and takes the brief's value", () => {
  const b = { topic: "t" } as never;
  expect(fillTemplate('Challenge: {{challenge ?? "core"}}', b)).toBe("Challenge: core");
  expect(
    fillTemplate('Challenge: {{challenge ?? "core"}}', {
      topic: "t",
      challenge: "stretch",
    } as never),
  ).toBe("Challenge: stretch");
});
