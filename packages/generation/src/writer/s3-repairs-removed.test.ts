import { describe, expect, test } from "bun:test";
import { CHECKER_DEFAULTS } from "./checker-flags";
import { replayRun, replayServices } from "./replay-fixture";

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
async function run(b: string) {
  const events: Ev[] = [];
  const calls: { name: string; user: string }[] = [];
  const base = replayServices(b);
  const res = await replayRun(b, {
    checker: CHECKER_DEFAULTS,
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
    const r = await run(b);
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
