import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Finding } from "@tj/domain/documents";
import { OFF_SLIDE } from "./fixes";
import { OVERFLOW_CHECK, overflowFindings, withOverflowFindings } from "./overflow-findings";
import { replayRun, replayServices } from "./replay-fixture";
import type { ChatReq, WriterServices } from "./services";
import { CONTINUED_NOTE } from "./stage";

/*
 * UX-C J8: a slide over its template's room never ships silently. Either the fit clears it (a
 * reword, or continuation slides when checks act) or the stage reports it on `overflow`, which the
 * write stage saves as a "things to check" finding.
 */

const LESSONS = readdirSync(join(import.meta.dir, "fixtures/replay")).sort();
const Y5 = "y5-maths-fractions-of-amounts";
const SLIDE_H = 540;

type Ev = Record<string, unknown>;
/**
 * The replay with every repair call answered `{}` (what the local fake worker answers, so no fit
 * repair lands) or with the run's recorded repairs.
 */
async function run(
  b: string,
  checks: "act" | "log",
  repairs: "recorded" | "empty",
  text?: (t: string) => string,
) {
  const events: Ev[] = [];
  const base = replayServices(b);
  const services: WriterServices = {
    ...base,
    log: (e) => events.push(e as Ev),
    chat:
      repairs === "recorded"
        ? base.chat
        : async (r: ChatReq) => (r.name === "slide" ? { out: {}, usd: 0, ms: 0 } : base.chat(r)),
  };
  const out = await replayRun(b, { services, checks, ...(text ? { text } : {}) });
  return { out, events };
}

type El = { type: string; y: number; h: number; children?: El[] };
const flat = (els: El[]): El[] => els.flatMap((e) => [e, ...flat(e.children ?? [])]);
/** A slide whose text runs below the slide's bottom edge, measured on the shipped elements. */
const offSlide = (s: { elements: unknown[] }) =>
  flat(s.elements as El[]).some((e) => e.type === "text" && e.y + e.h > SLIDE_H + 0.5);

/** The slide's words in reading order (its text elements top to bottom). */
const words = (s: { elements: unknown[] }) =>
  flat(s.elements as (El & { doc?: unknown })[])
    .filter((e) => e.type === "text")
    .sort((x, y) => x.y - y.y)
    .map((e) => JSON.stringify((e as { doc?: unknown }).doc ?? ""))
    .join(" ");
const textOf = (s: { elements: unknown[] }) =>
  [...words(s).matchAll(/"text":"([^"]*)"/g)].map((m) => m[1]).join(" ");

describe("the recorded slide (y5 slide 9, equation-hero, steps at y 464 / 515 / 607)", () => {
  test("production (checks log, no repair lands): it splits onto a continuation (Greg 70 B)", async () => {
    const { out, events } = await run(Y5, "log", "empty");
    expect(events.some((e) => e.ev === "fit-continued" && e.slide === 9)).toBe(true);
    const at = out.slides.findIndex((s) => s.id === "s9");
    const [s9, c1] = [out.slides[at], out.slides[at + 1]];
    expect(c1?.id).toBe("s9c1");
    if (!s9 || !c1) throw new Error("no split");
    expect(offSlide(s9) || offSlide(c1)).toBe(false);
    // Content in order: lead and formula first, then the three steps, every word kept.
    const all = `${textOf(s9)} ${textOf(c1)}`;
    const order = [
      "Mia has £30.",
      "One fifth: £30 ÷ 5 = £6",
      "Two fifths: £6 × 2 = £12",
      "Mia spends £12.",
    ].map((t) => all.indexOf(t));
    expect(order.every((k) => k >= 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    // The slide's own notes stay on its first part; the continuation says where it comes from.
    expect(s9.notes.length).toBeGreaterThan(0);
    expect(c1.notes).toBe(CONTINUED_NOTE);
    expect(out.overflow).toEqual([]);
  });

  test("a slide that cannot split ships with a finding, never silently", async () => {
    const { out, events } = await run(Y5, "log", "empty", (t) => {
      const d = JSON.parse(t);
      // One step too long for any part: nothing to split between.
      d.slides[6].points = [
        Array(12).fill("One fifth: £30 ÷ 5 = £6 and then two fifths.").join(" "),
      ];
      return JSON.stringify(d);
    });
    expect(events.some((e) => e.ev === "fit-continue-failed" && e.slide === 9)).toBe(true);
    const o = out.overflow.find((x) => x.id === "s9");
    expect(o?.faults.every((f) => OFF_SLIDE.test(f))).toBe(true);
    expect(events.some((e) => e.ev === "overflow-shipped" && e.slide === 9)).toBe(true);
    expect(overflowFindings(out.overflow, out.slides)).toEqual([
      {
        check: OVERFLOW_CHECK,
        severity: "warning",
        target: { slideId: "s9" },
        message: expect.stringContaining("does not fit"),
      },
    ]);
  });

  test("a split question list's answers follow their questions, in order", async () => {
    const long = (k: number) =>
      `Question ${k}: ${"A shop packs the same number of pencils in each box for the class. ".repeat(3)}`;
    const { out } = await run(Y5, "log", "empty", (t) => {
      const d = JSON.parse(t);
      d.slides[8] = { ...d.slides[8], template: "question-set", questions: [1, 2, 3, 4].map(long) };
      return JSON.stringify(d);
    });
    const parts = out.slides.filter((s) => /^s11(c\d+)?$/.test(s.id));
    expect(parts.length).toBeGreaterThan(1);
    for (const s of parts) expect(offSlide(s)).toBe(false);
    // The run's notes answer slide 11's first three questions: 6 apples, 21 cm, 15 kg.
    const asked = parts.flatMap((s) => [...textOf(s).matchAll(/Question (\d)/g)].map((m) => m[1]));
    expect(asked).toEqual(["1", "2", "3", "4"]);
    const shown = parts.map(
      (s) => (s.question as { modelAnswer?: string } | undefined)?.modelAnswer,
    );
    const answerOf = (q: number) =>
      shown[parts.findIndex((s) => textOf(s).includes(`Question ${q}:`))] ?? "";
    expect(answerOf(1)).toContain("6 apples");
    expect(answerOf(2)).toContain("21 cm");
    expect(answerOf(3)).toContain("15 kg");
    // Each answer is shown once, on its own question's part, in the deck's order.
    const all = shown.filter(Boolean).join(" | ");
    expect(all).toMatch(/6 apples[\s\S]*21 cm[\s\S]*15 kg/);
    for (const a of ["6 apples", "21 cm", "15 kg"]) expect(all.split(a)).toHaveLength(2);
  });

  test("a block a little past its room but on the slide is left as it is (Greg 71 A)", async () => {
    const { out } = await run(Y5, "log", "empty");
    // s5's equation column is 26 pt past its room and on the slide: no split, no finding.
    expect(out.slides.some((s) => s.id === "s5c1")).toBe(false);
    expect(out.overflow.map((x) => x.id)).not.toContain("s5");
  });
});

describe.each(LESSONS)("off-slide overflow splits or is flagged: %s", (b) => {
  for (const checks of ["act", "log"] as const)
    for (const repairs of ["recorded", "empty"] as const)
      test(`checks ${checks}, repairs ${repairs}`, async () => {
        const { out, events } = await run(b, checks, repairs);
        const reported = new Set(out.overflow.map((x) => x.id));
        const ids = new Set(out.slides.map((s) => s.id));
        for (const id of reported) expect(ids.has(id)).toBe(true);
        // Only off-slide faults are reported, and every one the final checks see is.
        for (const o of out.overflow) expect(o.faults.every((f) => OFF_SLIDE.test(f))).toBe(true);
        for (const c of out.checks)
          if (c.faults.some((f) => OFF_SLIDE.test(f)))
            expect(out.overflow.some((x) => x.slide === c.slide)).toBe(true);
        // Measured on the shipped deck: no text below the slide's edge goes unreported.
        for (const s of out.slides)
          if (offSlide(s))
            expect({ id: s.id, reported: reported.has(s.id) }).toEqual({
              id: s.id,
              reported: true,
            });
        // Every off-slide flag the stage saw was split or reported.
        for (const e of events)
          if (e.ev === "fit-continue-failed")
            expect(out.overflow.some((x) => x.slide === e.slide)).toBe(true);
      });
});

describe("withOverflowFindings", () => {
  const other: Finding = {
    check: "budget",
    severity: "warning",
    target: {},
    message: "stopped",
  };
  test("replaces an earlier run's fit findings and keeps the rest", () => {
    const old = overflowFindings(
      [{ slide: 4, id: "s4", faults: ["overflow: x 1/0pt"] }],
      [{ id: "s4" }],
    );
    const next = overflowFindings(
      [{ slide: 9, id: "s9", faults: ["overflow: y 2/1pt"] }],
      [{ id: "s9" }],
    );
    expect(withOverflowFindings([other, ...old], next)).toEqual([other, ...next]);
  });
  test("a slide the deck no longer has gets no finding", () => {
    expect(overflowFindings([{ slide: 9, id: "s9", faults: ["overflow: y"] }], [])).toEqual([]);
  });
});
