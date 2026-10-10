import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { writerBundle } from "./bundle";
import { CHECKER_DEFAULTS } from "./checker-flags";
import { replayRun, replayServices } from "./replay-fixture";

/*
 * TEACH-312 part i (Greg, 10 Oct): the writer's post-write checks can be switched to log only
 * (`checks: "log"`). Every check is still computed and logged (ev "checks", one "repair-skipped" per
 * slide that would have gone to repair), but nothing acts on a result: no repair call, no revert,
 * no check-driven relayout, rewrite, strip or visual drop. Answer hiding, text fit sizing and a
 * visual that genuinely fails to load or draw still act. Recorded writer outputs, no model call.
 */
type Ev = Record<string, unknown>;
const LESSONS = readdirSync(join(import.meta.dir, "fixtures/replay")).sort();
const REPAIR = writerBundle().repair;

async function run(b: string, checks: "act" | "log") {
  const events: Ev[] = [];
  const systems: string[] = [];
  const base = replayServices(b);
  const res = await replayRun(b, {
    checker: CHECKER_DEFAULTS,
    checks,
    services: {
      ...base,
      log: (e) => events.push(e as Ev),
      chat: (r) => {
        systems.push(r.system);
        return base.chat(r);
      },
    },
  });
  return { res, events, systems };
}

/** Events that mean a check result changed a slide's words or visuals. */
const ACTING = new Set(["gas8-fallback", "orphan6-drop", "unshown-strip"]);
/** Logged through the stage's one check gate: acting unless marked `applied: false`. */
const GATED = new Set([
  "gas8",
  "unpoint",
  "figure-sync",
  "figure-stale",
  "figure-text",
  "figure-text-mismatch",
]);
const acted = (e: Ev) =>
  // A restage after a picture that genuinely failed to load still runs (mode reroute).
  ((e.ev === "repair" || e.ev === "repair-rejected") && e.mode === "fit") ||
  (e.ev === "point-guard" && e.how === "point-strip") ||
  (GATED.has(String(e.ev)) && e.applied !== false) ||
  // a library fallback is acting only when a check (not a fill or draw failure) caused it
  (e.ev === "lib-fallback" &&
    !/fill call failed|refused:|did not draw|no shipped model|no build before/.test(
      String(e.reason),
    )) ||
  ACTING.has(String(e.ev)) ||
  // in log mode the relayout acts only when it is what lets the diagram show (keptVisual)
  (e.ev === "diagram-relaid" && e.ok === true && e.keptVisual !== true);

const images = (slides: { elements: { type: string }[] }[]) =>
  slides.map((s) => s.elements.filter((e) => e.type === "image").length);

describe('checks: "log" acts on no check result', () => {
  test.each(LESSONS)("%s: checks logged, no repair call, nothing acted on", async (b) => {
    const act = await run(b, "act");
    const log = await run(b, "log");
    expect(log.events.some((e) => e.ev === "checks")).toBe(true);
    expect(log.systems.filter((s) => s === REPAIR)).toEqual([]);
    expect(log.events.filter(acted)).toEqual([]);
    // Every slide the acting run sent to repair is named instead.
    const repaired = new Set(
      act.events.filter((e) => e.ev === "repair" && e.mode === "fit").map((e) => e.slide),
    );
    const skipped = new Set(
      log.events.filter((e) => e.ev === "repair-skipped").map((e) => e.slide),
    );
    for (const s of repaired) expect(skipped.has(s)).toBe(true);
    for (const e of log.events.filter((x) => x.ev === "repair-skipped"))
      expect((e.faults as string[]).length).toBeGreaterThan(0);
  });

  test("the default stays acting: a replay that repairs still repairs", async () => {
    let repairs = 0;
    for (const b of LESSONS) {
      const r = await run(b, "act");
      repairs += r.systems.filter((s) => s === REPAIR).length;
      expect(r.events.some((e) => e.ev === "repair-skipped")).toBe(false);
    }
    expect(repairs).toBeGreaterThan(0);
  });

  test("no slide loses a visual it kept when checks act", async () => {
    for (const b of LESSONS) {
      const act = images((await run(b, "act")).res.slides as never);
      const log = images((await run(b, "log")).res.slides as never);
      for (let i = 0; i < act.length; i++)
        expect(log[i] ?? 0, `${b} s${i + 1}`).toBeGreaterThanOrEqual(act[i] ?? 0);
    }
  });

  test("log mode relays a slide only to let its diagram show; a shown diagram is left as laid", async () => {
    const kept = await run("y12-psychology-multi-store-model", "log");
    const keptAt = kept.events.filter((e) => e.ev === "relayout-kept-visual").map((e) => e.slide);
    expect(keptAt).toEqual(expect.arrayContaining([4, 7]));
    for (const s of keptAt) {
      const slide = kept.res.slides[Number(s) - 1] as { elements: { type: string }[] };
      expect(slide.elements.some((e) => e.type === "image")).toBe(true);
    }
    let skipped = 0;
    for (const b of LESSONS) {
      const r = await run(b, "log");
      for (const e of r.events.filter((x) => x.ev === "relayout-skipped")) {
        skipped += 1;
        const relaid = r.events.some(
          (x) => x.ev === "diagram-relaid" && x.slide === e.slide && x.ok === true,
        );
        expect(relaid).toBe(false);
      }
    }
    expect(skipped).toBeGreaterThan(0);
  });
});
