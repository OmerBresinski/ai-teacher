import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Finding } from "@tj/domain/documents";
import { OVERFLOW } from "./fixes";
import { OVERFLOW_CHECK, overflowFindings, withOverflowFindings } from "./overflow-findings";
import { replayRun, replayServices } from "./replay-fixture";
import type { ChatReq, WriterServices } from "./services";

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
async function run(b: string, checks: "act" | "log", repairs: "recorded" | "empty") {
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
  const out = await replayRun(b, { services, checks });
  return { out, events };
}

type El = { type: string; y: number; h: number; children?: El[] };
const flat = (els: El[]): El[] => els.flatMap((e) => [e, ...flat(e.children ?? [])]);
/** A slide whose text runs below the slide's bottom edge, measured on the shipped elements. */
const offSlide = (s: { elements: unknown[] }) =>
  flat(s.elements as El[]).some((e) => e.type === "text" && e.y + e.h > SLIDE_H + 0.5);

describe("the recorded slide (y5 slide 9, equation-hero, steps at y 464 / 515 / 607)", () => {
  test("production (checks log, no repair lands): it ships flagged, never silently", async () => {
    const { out, events } = await run(Y5, "log", "empty");
    const s9 = out.slides.find((s) => s.id === "s9");
    expect(JSON.stringify(s9)).toContain("Mia spends £12.");
    // As UX-C measured it: the steps run past the 540-tall slide.
    expect(s9 && offSlide(s9)).toBe(true);
    const o = out.overflow.find((x) => x.id === "s9");
    expect(o?.faults).toContain("overflow: equation column 488/328pt");
    expect(events.some((e) => e.ev === "overflow-shipped" && e.slide === 9)).toBe(true);
    const f = overflowFindings(out.overflow, out.slides);
    expect(f.filter((x) => x.target.slideId === "s9")).toEqual([
      {
        check: OVERFLOW_CHECK,
        severity: "warning",
        target: { slideId: "s9" },
        message: expect.stringContaining("does not fit"),
      },
    ]);
  });

  test("checks act, the rewords fail: it is still reported when no continuation fits", async () => {
    const { out, events } = await run(Y5, "act", "empty");
    const fits = events.filter((e) => e.ev === "repair" && e.slide === 9 && e.mode === "fit");
    expect(fits).toHaveLength(2);
    expect(out.overflow.map((x) => x.id)).toContain("s9");
    // Slide 5 (equation column 354/328) splits its steps onto a continuation slide instead.
    expect(events.some((e) => e.ev === "fit-continued" && e.slide === 5)).toBe(true);
    expect(out.slides.some((s) => s.id === "s5c1")).toBe(true);
    expect(out.overflow.map((x) => x.id)).not.toContain("s5");
  });

  test("with the run's recorded repair the slide fits and carries no finding", async () => {
    const { out } = await run(Y5, "act", "recorded");
    expect(out.overflow.map((x) => x.id)).not.toContain("s9");
  });
});

describe.each(LESSONS)("every template overflow flag goes to repair or a finding: %s", (b) => {
  for (const checks of ["act", "log"] as const)
    for (const repairs of ["recorded", "empty"] as const)
      test(`checks ${checks}, repairs ${repairs}`, async () => {
        const { out, events } = await run(b, checks, repairs);
        const reported = new Set(out.overflow.map((x) => x.id));
        const ids = new Set(out.slides.map((s) => s.id));
        for (const id of reported) expect(ids.has(id)).toBe(true);
        // Every overflow the final checks still see is reported, on the shipped slide's id.
        for (const c of out.checks)
          if (c.faults.some((f) => OVERFLOW.test(f)))
            expect(out.overflow.some((x) => x.slide === c.slide)).toBe(true);
        // Measured on the shipped deck: no text below the slide's edge goes unreported.
        for (const s of out.slides)
          if (offSlide(s))
            expect({ id: s.id, reported: reported.has(s.id) }).toEqual({
              id: s.id,
              reported: true,
            });
        // A flag seen at the first check: log mode reports it as is; act mode sends it to a fit
        // repair (title and objectives are laid by code, never sent), and what that leaves is
        // continued or reported.
        if (checks === "log") {
          for (const e of events)
            if (e.ev === "repair-skipped" && (e.faults as string[]).some((f) => OVERFLOW.test(f)))
              expect(out.overflow.some((x) => x.slide === e.slide)).toBe(true);
        } else {
          for (const e of events.filter(
            (x) => x.ev === "overflow-shipped" && Number(x.slide) > 2,
          )) {
            const repaired = events.some(
              (x) => x.ev === "repair" && x.slide === e.slide && x.mode !== undefined,
            );
            const pilot = events.some((x) => x.ev === "pilot-fit" && x.slide === e.slide);
            expect({ slide: e.slide, repaired: repaired || pilot }).toEqual({
              slide: e.slide,
              repaired: true,
            });
          }
        }
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
