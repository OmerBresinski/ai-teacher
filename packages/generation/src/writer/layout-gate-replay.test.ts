import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { LAYOUT_FAULT } from "./layout-gate";
import { replayRun, replayServices } from "./replay-fixture";
import type { WriterServices } from "./services";
import { CONTINUED_NOTE } from "./stage";

/*
 * TEACH-247 part af, end to end: every replayed lesson run with the checks only logging (as
 * production runs them). The gate runs last; what it leaves is logged, and nothing else ships with
 * a layout fault. A slide the gate split is followed by its continuations, each carrying the
 * continued note, so the notes stay with the slides they belong to (#633).
 */
const LESSONS = readdirSync(join(import.meta.dir, "fixtures/replay")).sort();
type Ev = Record<string, unknown>;

describe.each(LESSONS)("layout gate on replay %s (TEACH-247 part af)", (b) => {
  test("no written slide ships with a layout fault the gate did not report", async () => {
    const events: Ev[] = [];
    const base = replayServices(b);
    const services: WriterServices = { ...base, log: (e) => events.push(e as Ev) };
    const out = await replayRun(b, { services, checks: "log" });
    const gate = events.filter((e) => e.ev === "layout-gate");
    const left = new Set(gate.filter((e) => e.outcome === "left").map((e) => e.slide));
    for (const c of out.checks) {
      const faults = c.faults.filter((f) => LAYOUT_FAULT.test(f));
      if (!left.has(c.slide))
        expect({ slide: c.slide, faults }).toEqual({ slide: c.slide, faults: [] });
    }
    // Every slide keeps notes; a split's parts follow it with the continued note.
    for (const s of out.slides) expect(typeof s.notes).toBe("string");
    const splits = gate.filter((e) => e.outcome === "split").length;
    const continued = out.slides.filter((s) => s.notes === CONTINUED_NOTE).length;
    expect(continued).toBeGreaterThanOrEqual(splits);
    expect(out.slides.length).toBeLessThanOrEqual(out.plan.slides.length + 2 * splits + continued);
  });
});

describe("a picture landing once the lesson is editable never adds a slide (TEACH-247 part af)", () => {
  test.each(LESSONS)("%s", async (b) => {
    const events: Ev[] = [];
    let landed: ((i: number) => void) | undefined;
    const base = replayServices(b);
    const services: WriterServices = { ...base, log: (e) => events.push(e as Ev) };
    const out = await replayRun(b, {
      services,
      checks: "log",
      hooks: { bindPictureLanded: (f) => (landed = f) },
    });
    expect(landed).toBeDefined();
    const seen = events.length;
    for (let i = 0; i < out.plan.slides.length; i++) landed?.(i);
    const after = events.slice(seen);
    expect(after.filter((e) => e.outcome === "split" || e.ev === "fit-continued")).toEqual([]);
  });
});
