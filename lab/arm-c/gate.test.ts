// Arm C submit gate: zero hard violations, or flagged after the last repair round.
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Geometry } from "./geometry.ts";
import { tokensFor } from "./tokens.ts";
import { Lesson } from "./tools.ts";

const geo = (counts: Record<string, number>): Geometry => {
  const c = {
    overflow: 0,
    clipping: 0,
    overlap: 0,
    off_canvas: 0,
    min_font: 0,
    broken_image: 0,
    ...counts,
  };
  return {
    total: Object.values(c).reduce((a, b) => a + b, 0),
    counts: c,
    violations: [],
    boxes: [],
  };
};
function lesson(queue: Geometry[]) {
  const runDir = mkdtempSync(join(tmpdir(), "armc-gate-"));
  mkdirSync(join(runDir, "work"));
  const renderer: any = { measure: async () => queue.shift(), png: async () => {} };
  const nope: any = async () => ({ ok: false, reason: "test" });
  const L = new Lesson({
    runDir,
    tk: tokensFor("Year 9"),
    slideCount: 2,
    slideMin: 2,
    slideMax: 2,
    t0: performance.now(),
    renderer,
    findPicture: nope,
    drawDiagram: nope,
    probe: nope,
  });
  return L;
}
const plan = {
  title: "t",
  objectives: [{ teacher: "a", pupil: "b" }],
  flow: [1, 2].map((slide) => ({ slide, does: "x", pupils_see: "none" })),
};

test("a hard violation is refused while renders remain, then submitted flagged", async () => {
  const L = lesson([geo({ overflow: 1 }), geo({ min_font: 1 }), geo({ clipping: 2 })]);
  await L.call("set_plan", plan);
  await L.call("render_slide", { slide: 1, html: "<p>x</p>" });
  expect(await L.call("submit_slide", { slide: 1 })).toMatchObject({ ok: false });
  await L.call("render_slide", { slide: 1, html: "<p>x</p>" });
  expect(await L.call("submit_slide", { slide: 1 })).toMatchObject({ ok: false });
  await L.call("render_slide", { slide: 1, html: "<p>x</p>" });
  expect(await L.call("submit_slide", { slide: 1 })).toMatchObject({ ok: true, flagged: true });
});

test("zero hard violations submits clean; overlap alone is not a hard violation", async () => {
  const L = lesson([geo({ off_canvas: 1 }), geo({ overlap: 1 })]);
  await L.call("set_plan", plan);
  await L.call("render_slide", { slide: 2, html: "<p>x</p>" });
  await L.call("render_slide", { slide: 2, html: "<p>x</p>" });
  expect(await L.call("submit_slide", { slide: 2 })).toMatchObject({ ok: true, flagged: false });
});

test("the turn cap auto-submits a failing slide flagged", async () => {
  const L = lesson([geo({ overflow: 3 })]);
  await L.call("set_plan", plan);
  await L.call("render_slide", { slide: 1, html: "<p>x</p>" });
  expect(L.autoSubmit()).toEqual([1]);
  expect((L as any).slides.get(1).submitted.flagged).toBe(true);
});
