import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hasRevealPart, svgOfDataUrl } from "@tj/slides/diagram-builds";
import { Window } from "happy-dom";
import { endDrawThread } from "../library/guard";
import type { DrawerCall } from "./diagrams";
import type { Brief } from "./fixes";
import { recordedVisuals, replayServices } from "./replay-fixture";
import { runWriter } from "./stage";

/*
 * The slide-role contract, step 2 (roleAsk; LIBRARY-PATH s2 and s4). A library model on a slide
 * that asks pupils (a big-visual "Find one half of 16") drew its answer: the stage decided
 * `question` from the four question templates, which never meet the full-slot templates a model
 * draws on. With roleAsk the stage reads the slide's role, and the model opens as a still with its
 * answer held for the reveal; a model that falls back to the drawer has its answer names taken out
 * (questionSafe), as on the question templates. Writer slides replayed from recorded runs (fixtures/
 * library-question.json), fills completed with the right numbers, no paid call.
 */
const B = "y2-maths-halves-quarters";
const DIR = join(import.meta.dir, "fixtures/replay", B);
const read = (f: string) => readFileSync(join(DIR, f), "utf8");
type El = Record<string, unknown>;
type Case = {
  id: string;
  slide: El;
  fill: El;
  /** The drawer's answer when the model falls back (an A, B, C ask the model cannot label). */
  drawer?: El;
  answer: string[];
  asks: boolean;
  /** Drawn by the library model, or by the drawer once the model falls back. */
  via: "library" | "drawer";
};
const CASES = (
  JSON.parse(readFileSync(join(import.meta.dir, "fixtures/library-question.json"), "utf8")) as {
    cases: Case[];
  }
).cases;

/** One recorded slide in the replay deck's first writer slot, through runWriter. */
async function run(c: Case, roleAsk: boolean | undefined) {
  const brief = JSON.parse(read("brief.json")) as Brief;
  const objectives = (
    JSON.parse(read("objectives.json")) as { objectives: { teacher: string }[] }
  ).objectives.map((o) => o.teacher);
  const main = JSON.parse(read("main.json")) as { text: string; finishReason?: string };
  const out = JSON.parse(main.text) as { slides: El[] };
  out.slides[0] = structuredClone(c.slide);
  const callDrawer: DrawerCall = async (req) => ({
    out: req.system.startsWith("Set the parameters") ? c.fill : c.drawer,
  });
  const events: El[] = [];
  const res = await runWriter({
    brief,
    objectives,
    services: { ...replayServices(B), log: (e) => events.push(e as El) },
    visual: recordedVisuals(B),
    recordedWriter: { text: JSON.stringify(out), finishReason: main.finishReason ?? null },
    drawDiagrams: { callDrawer },
    library: true,
    ...(roleAsk === undefined ? {} : { roleAsk }),
  });
  const els = (res.slides[2]?.elements ?? []) as El[];
  const svg = svgOfDataUrl(String(els.find((e) => e.name === "Diagram")?.src ?? "")) ?? "";
  return { svg, events };
}

/**
 * The words a pupil sees on the still (reveal hidden) and after the reveal, read from the markup.
 * A drawer fallback has no reveal part: the still is all its words.
 */
function seen(svg: string): { still: string; reveal: string; marks: number } {
  const win = new Window();
  const doc = win.document;
  doc.body.innerHTML = svg.replace(/<style>[\s\S]*?<\/style>/g, "");
  const still: string[] = [];
  const reveal: string[] = [];
  for (const t of [...doc.querySelectorAll("text")]) {
    const w = (t.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!w) continue;
    if (!t.closest("[data-reveal]")) still.push(w);
    if (!t.closest("[data-qn]")) reveal.push(w);
  }
  // Never an empty box: the still keeps its counters, rings and shapes.
  const marks = [...doc.querySelectorAll("circle,rect,path")].filter(
    (e) => !e.closest("[data-reveal]"),
  ).length;
  win.close();
  return { still: still.join(" | "), reveal: reveal.join(" | "), marks };
}
/**
 * An answer shown in some words: a number on its own; a fraction inline ("1/2") or stacked (its
 * numerator then its denominator, "1 | 2"); or a fraction's name.
 */
const shows = (words: string, a: string) => {
  const f = /^(\d+)\/(\d+)$/.exec(a);
  if (f) return new RegExp(`(^|[^\\d])${f[1]}(/| \\| )${f[2]}([^\\d]|$)`).test(words);
  if (/^\d+$/.test(a)) return new RegExp(`(^|[^\\d./])${a}([^\\d./]|$)`).test(words);
  return words.toLowerCase().includes(a.toLowerCase());
};
const report: unknown[] = [];

describe("roleAsk: a library model on a slide that asks keeps its answer back", () => {
  for (const c of CASES) {
    test(`${c.id}: off ${c.asks ? "draws the answer" : "no reveal"}`, async () => {
      const { svg, events } = await run(c, false);
      expect(events).toContainEqual(
        expect.objectContaining({
          ev: "diagram-done",
          via: c.via === "library" ? "library" : "code",
        }),
      );
      // question:false on the library path: no held part, every answer on the still.
      expect(hasRevealPart(svg)).toBe(false);
      const { still } = seen(svg);
      const leaked = c.answer.filter((a) => shows(still, a));
      report.push({ id: c.id, roleAsk: false, reveal: false, leaked, still });
      if (c.asks) expect(leaked.length).toBeGreaterThan(0);
    }, 60_000);

    test(`${c.id}: on ${c.asks ? "holds the answer for the reveal" : "stays a plain still"}`, async () => {
      const { svg, events } = await run(c, true);
      expect(events).toContainEqual(
        expect.objectContaining({
          ev: "diagram-done",
          via: c.via === "library" ? "library" : "code",
        }),
      );
      expect(hasRevealPart(svg)).toBe(c.asks && c.via === "library");
      const { still, reveal, marks } = seen(svg);
      expect(marks).toBeGreaterThan(2);
      const leaked = c.answer.filter((a) => shows(still, a));
      const revealed = c.answer.filter((a) => shows(reveal, a));
      report.push({ id: c.id, roleAsk: true, reveal: hasRevealPart(svg), leaked, revealed, still });
      if (!c.asks) return;
      expect(leaked).toEqual([]);
      // The library model shows its answer at the reveal; the drawer's fallback leaves it to the
      // teacher (its fraction names are gone, the shapes and their letters stay).
      if (c.via === "library") expect(revealed.length).toBeGreaterThan(0);
      else expect(svg.length).toBeGreaterThan(0);
    }, 60_000);
  }
});

afterAll(() => {
  endDrawThread();
  if (process.env.TLIB_REPORT) console.log(JSON.stringify(report, null, 1));
});
