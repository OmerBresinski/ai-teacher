import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Brief, offPlanSlides } from "./fixes";
import { recordedHeld, recordedVisuals, replayServices } from "./replay-fixture";
import type { WriterServices } from "./services";
import { runWriter } from "./stage";

/*
 * TEACH-247 part bm: a written slide no flow entry plans, in a deck longer than its flow, is
 * dropped and logged. v4.18c Photosynthesis r1 planned 11 slides; the writer wrote a 12th, an
 * `explain` "A note for the teacher", which pupils saw.
 */
const FLOW = [
  "title",
  "objectives",
  "question-set",
  "visual-text",
  "hinge",
  "visual-text",
  "hinge",
  "panel-list",
  "practice",
  "practice",
  "exit-ticket",
].map((layout, i) => ({ slide: i + 1, layout }));
const tpl = (template: string, heading = template) => ({ template, heading });
const WRITTEN = [
  tpl("question-set", "What do plants need?"),
  tpl("visual-text", "Making glucose"),
  tpl("hinge"),
  tpl("visual-text", "A leaf built for photosynthesis"),
  tpl("hinge"),
  tpl("panel-list", "Uses of glucose"),
  tpl("practice", "Apply your knowledge"),
  tpl("practice", "Using glucose"),
  tpl("explain", "A note for the teacher"),
  tpl("exit-ticket"),
];

describe("offPlanSlides", () => {
  test("Photosynthesis r1: the unplanned teacher note goes, the rest stay in order", () => {
    const r = offPlanSlides(FLOW, tpl("title"), WRITTEN);
    expect(r.dropped).toEqual([
      { slide: 11, template: "explain", heading: "A note for the teacher", planned: "exit-ticket" },
    ]);
    expect(r.kept).toEqual([]);
    expect(r.slides.map((s) => s.template)).toEqual(FLOW.slice(2).map((f) => f.layout));
  });

  test("a swapped layout in a deck no longer than its flow is kept, reported", () => {
    // Romans r1: the exit ticket written as a question set, "One last quick check".
    const swapped = [...WRITTEN.slice(0, 8), tpl("question-set", "One last quick check")];
    const r = offPlanSlides(FLOW, tpl("title"), swapped);
    expect(r.dropped).toEqual([]);
    expect(r.kept.map((k) => k.heading)).toEqual(["One last quick check"]);
    expect(r.slides).toEqual(swapped);
  });

  test("never drops the last slide or an exit ticket; a flow without layouts drops nothing", () => {
    const extraExit = [...WRITTEN.slice(0, 8), tpl("exit-ticket"), tpl("exit-ticket")];
    expect(offPlanSlides(FLOW, tpl("title"), extraExit).dropped).toEqual([]);
    const bare = FLOW.map(({ slide }) => ({ slide }));
    expect(offPlanSlides(bare, tpl("title"), WRITTEN).slides).toHaveLength(WRITTEN.length);
  });
});

const B = "y5-maths-fractions-of-amounts";
const DIR = join(import.meta.dir, "fixtures/replay", B);
const read = (f: string) => JSON.parse(readFileSync(join(DIR, f), "utf8"));

test("the stage drops an unplanned slide before laying it, and logs it", async () => {
  const main = read("main.json") as { text: string };
  const raw = JSON.parse(main.text) as {
    title?: { template?: string };
    flow: { slide: number; layout?: string }[];
    slides: { template?: string }[];
  };
  // The recorded flow predates layouts: each entry takes the layout its slide was written as.
  const layoutOf = (n: number) =>
    n === 1
      ? (raw.title?.template ?? "title")
      : n === 2
        ? "objectives"
        : raw.slides[n - 3]?.template;
  const out = { ...raw, flow: raw.flow.map((f) => ({ ...f, layout: layoutOf(f.slide) })) };
  expect(out.flow.every((f) => typeof f.layout === "string")).toBe(true);
  const plain = await run(JSON.stringify(out));
  const k = out.slides.length - 1;
  const note = { template: "explain", heading: "A note for the teacher", points: ["Ask aloud."] };
  const text = JSON.stringify({
    ...out,
    slides: [...out.slides.slice(0, k), note, ...out.slides.slice(k)],
  });
  const extra = await run(text);
  expect(extra.slides.length).toBe(plain.slides.length);
  expect(JSON.stringify(extra.slides)).not.toContain("A note for the teacher");
  expect(extra.logs.filter((e) => e.ev === "off-plan-dropped")).toHaveLength(1);
  expect(plain.logs.some((e) => e.ev === "off-plan-dropped")).toBe(false);
});

async function run(text: string) {
  const logs: { ev?: string }[] = [];
  const services: WriterServices = {
    ...replayServices(B),
    log: (e: object) => logs.push(e as { ev?: string }),
    writer: async () => ({ text, finishReason: "stop", usd: 0, ms: 0 }),
  };
  const r = await runWriter({
    brief: { ...(read("brief.json") as Brief), slides: { min: 3, max: 40 } },
    objectives: (read("objectives.json") as { objectives: { teacher: string }[] }).objectives.map(
      (o) => o.teacher,
    ),
    services,
    visual: recordedVisuals(B),
    placeMore: recordedVisuals(B).placeMore,
    held: recordedHeld(B),
  });
  return { slides: r.slides, logs };
}
