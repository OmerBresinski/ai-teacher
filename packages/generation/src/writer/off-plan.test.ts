import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Brief, offPlanSlides } from "./fixes";
import { recordedHeld, recordedVisuals, replayRun, replayServices } from "./replay-fixture";
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

/*
 * TEACH-247 part bs: Equations v4.18e r1 wrote a practice slide "Apply the method" where its flow
 * planned the exit ticket, then the exit ticket. The guard above dropped it from the final deck,
 * but the stream had shown it typing out first, then swapped it for the exit ticket. A streamed
 * slide no flow entry plans is never drafted or shown; the final deck is as before.
 */
describe("a streamed slide in the exit ticket's slot that the flow does not plan", () => {
  const EXIT = {
    template: "exit-ticket",
    heading: "Exit ticket",
    questions: ["Find 3/4 of 20."],
    answers: ["15"],
  };
  type J = Record<string, unknown>;
  const lesson = (extra: boolean) => (text: string) => {
    const raw = JSON.parse(text) as { title?: J; flow: J[]; slides: J[] };
    const layoutOf = (n: number) =>
      n === 1
        ? String(raw.title?.template ?? "title")
        : n === 2
          ? "objectives"
          : String(raw.slides[n - 3]?.template);
    const flow: J[] = raw.flow.map((f) => ({ ...f, layout: layoutOf(Number(f.slide)) }));
    const last = flow.at(-1) as J;
    flow.push({ ...last, slide: flow.length + 1, layout: "exit-ticket" });
    const practice = raw.slides.findLast((s) => s.template === "practice") as J;
    const slides = extra
      ? [...raw.slides, { ...practice, heading: "Apply the method" }]
      : raw.slides;
    return JSON.stringify({ ...raw, flow, slides, close: EXIT });
  };
  const pieces = (text: string) => {
    const out: string[] = [];
    for (let at = 0; at < text.length; at += 9) out.push(text.slice(at, at + 9));
    return out;
  };
  const streamed = async (extra: boolean) => {
    const logs: { ev?: string; why?: string; slide?: number }[] = [];
    const seen: string[] = [];
    const reopened: number[] = [];
    const r = await replayRun(B, {
      stream: pieces,
      text: lesson(extra),
      brief: (b) => ({ ...b, slides: { min: 3, max: 40 } }),
      services: { ...replayServices(B), log: (e: object) => logs.push(e as { ev?: string }) },
      hooks: {
        draft: { ms: 0 },
        onDraftSlide: (i, s) => seen.push(`draft:${i}:${JSON.stringify(s)}`),
        onSlide: (i, s) => seen.push(`slide:${i}:${JSON.stringify(s)}`),
        onReopen: (i) => reopened.push(i),
      },
    });
    return { slides: r.slides, logs, seen, reopened };
  };
  const stable = (v: unknown, top = true): unknown => {
    if (Array.isArray(v)) return v.map((x) => stable(x, false));
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v)
          .filter(([k]) => !(k === "id" && !top))
          .map(([k, x]) => [k, stable(x, false)]),
      );
    return v;
  };

  test("is never drafted or shown, nothing is swapped, and the final deck is the planned one", async () => {
    const plain = await streamed(false);
    const extra = await streamed(true);
    expect(extra.logs.filter((e) => e.ev === "off-plan-dropped")).toHaveLength(1);
    expect(extra.seen.some((e) => e.includes("Apply the method"))).toBe(false);
    expect(extra.reopened).toEqual([]);
    const stops = extra.logs.filter((e) => e.ev === "stream-stopped").map((e) => e.why);
    expect(stops).toEqual([
      `slide ${extra.logs.find((e) => e.ev === "off-plan-dropped")?.slide} off plan`,
    ]);
    expect(JSON.stringify(stable(extra.slides))).toBe(JSON.stringify(stable(plain.slides)));
    // The planned deck streams to its end, unchanged by the guard.
    expect(plain.logs.some((e) => e.ev === "stream-stopped")).toBe(false);
    expect(plain.reopened).toEqual([]);
  });
});
