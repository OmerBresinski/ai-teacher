import { describe, expect, test } from "bun:test";
import { CHECKER_DEFAULTS } from "./checker-flags";
import { replayRun, replayServices, withUnshowable } from "./replay-fixture";

/*
 * SIMPLIFY S3 (TEACH-312 part f): the writer stage's repairs that made slides worse are gone.
 * - A diagram that cannot be shown is no longer rewritten into words by a stand-alone model call,
 *   nor reduced to a fixed "figure-dropped" text slide: the slide stays as the writer wrote it, its
 *   lines in their ask_without form, the picture-of-the-same-thing step still first.
 * - The objective repair call is gone: on the replay every firing was a picture or matching task
 *   the coverage rule did not count, and the one recorded live answer replaced the writer's
 *   three-photo growth task with one adult chicken. A gap is logged, never repaired.
 * Recorded writer outputs (fixtures/replay), recorded answers, no model call.
 */
type Ev = Record<string, unknown>;
async function run(b: string, visual?: ReturnType<typeof withUnshowable>) {
  const events: Ev[] = [];
  const calls: { name: string; user: string }[] = [];
  const base = replayServices(b);
  const res = await replayRun(b, {
    checker: CHECKER_DEFAULTS,
    ...(visual ? { visual } : {}),
    services: {
      ...base,
      log: (e) => events.push(e as Ev),
      chat: (r) => {
        calls.push({ name: r.name, user: r.user });
        return base.chat(r);
      },
    },
  });
  const pathOf = (slide: number) =>
    events.find((e) => e.ev === "visual-path" && e.slide === slide)?.path as string | undefined;
  return { res, events, calls, pathOf };
}

describe("a diagram that cannot be shown keeps the writer's slide", () => {
  test.each([
    ["y11-chemistry-rates-of-reaction", 9],
    ["y11-chemistry-rates-of-reaction-r2", 7],
    ["y12-psychology-multi-store-model-r2", 4],
    ["y8-french-my-family", 3],
  ])("%s s%d: no words-rewrite or figure-dropped, no stand-alone call", async (b, slide) => {
    // y8 s3's family tree now draws (TEACH-247 part n): a drawing that cannot be shown takes its
    // place, so the slide still takes the cannot-be-shown path.
    const r = await run(b, b === "y8-french-my-family" ? withUnshowable(b, slide - 1) : undefined);
    expect(r.pathOf(slide)).toBe("unshown");
    expect(r.events.some((e) => e.ev === "restage-fallback" && e.slide === slide)).toBe(false);
    // The slide is the writer's own (same heading), not a restaged rewrite.
    const written = r.res.plan.slides[slide - 1] as Record<string, unknown>;
    expect(written.template).not.toBe("explain");
  });
});
describe("the objective repair call is gone", () => {
  test("y2 with every checker flag off still makes no objective_repair call", async () => {
    const events: Ev[] = [];
    const calls: string[] = [];
    const base = replayServices("y2-maths-halves-quarters");
    await replayRun("y2-maths-halves-quarters", {
      services: {
        ...base,
        log: (e) => events.push(e as Ev),
        chat: (r) => {
          calls.push(r.name);
          return base.chat(r);
        },
      },
    });
    expect(calls).not.toContain("objective_repair");
    // The gap the old rule sees (objective 1, checked only by a picture task) is logged.
    expect(events.find((e) => e.ev === "coverage-unmet")).toMatchObject({ missing: [1] });
  });
});

describe("an unshown visual never leaves its slide pointing at it", () => {
  const b = "y12-psychology-multi-store-model-r2";
  const editS4 =
    (figure: (f: Record<string, unknown>) => Record<string, unknown>, lead?: string) =>
    (text: string) => {
      const m = JSON.parse(text) as { slides: Record<string, unknown>[] };
      const s = m.slides[1] as Record<string, unknown>;
      m.slides[1] = {
        ...s,
        ...(lead ? { lead } : {}),
        figure: figure(s.figure as Record<string, unknown>),
      };
      return JSON.stringify(m);
    };
  const dangling = (res: Awaited<ReturnType<typeof replayRun>>, slide: number) =>
    (res.checks.find((c) => c.slide === slide)?.faults ?? []).filter((f) => /^dangling/.test(f));
  test.each([
    ["y11-chemistry-rates-of-reaction", 9],
    ["y11-chemistry-rates-of-reaction-r2", 7],
    ["y12-psychology-multi-store-model-r2", 4],
    ["y8-french-my-family", 3],
  ])("%s s%d ships with no dangling fault", async (lesson, slide) => {
    const r = await run(lesson);
    expect(dangling(r.res, slide)).toEqual([]);
    expect(r.res.summary.dangling.filter((d) => d.slide === slide)).toEqual([]);
  });
  test("ask_without null, the lead still says 'Look at the diagram': the pointing sentence goes", async () => {
    const res = await replayRun(b, {
      checker: CHECKER_DEFAULTS,
      text: editS4(
        (f) => ({ ...f, ask: "Trace each arrow.", ask_without: null }),
        "Look at the diagram. Atkinson and Shiffrin proposed separate stores in 1968.",
      ),
    });
    expect(dangling(res, 4)).toEqual([]);
    const lead = JSON.stringify(res.plan.slides[3]);
    expect(lead).not.toContain("Look at the diagram");
    expect(lead).toContain("Atkinson and Shiffrin");
  });
  test("ask_without still pointing ('Point to the arrow in the diagram'): stripped, nothing dangles", async () => {
    const res = await replayRun(b, {
      checker: CHECKER_DEFAULTS,
      text: editS4((f) => ({
        ...f,
        ask: "Trace each arrow.",
        ask_without: "Point to the rehearsal arrow in the diagram.",
      })),
    });
    expect(dangling(res, 4)).toEqual([]);
    expect(JSON.stringify(res.slides[3]?.elements)).not.toContain("Point to the rehearsal arrow");
  });
});
