import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import { SlidesActor } from "./SlidesActor";
import {
  base,
  CLIPS,
  type Clip,
  endOf,
  geometry,
  inkAt,
  planFor,
  poseAt,
  REST,
  stackAt,
  stillPose,
} from "./slides";

/*
 * Slides at work in "Edit with Dayback" (TEACH-97): the cast module's state transitions, its
 * clips starting and ending on their base pose (no pops), and reduced motion (every state still).
 */

afterEach(cleanup);

const near = (a: object, b: object) => {
  for (const [k, v] of Object.entries(b))
    expect((a as Record<string, number>)[k]).toBeCloseTo(v, 6);
};

describe("state transitions", () => {
  test("working loops the context's own beat: a riffle in the bubble, a touch-up in the pane", () => {
    expect(planFor("bubble", "idle", "working", false)).toEqual({ kind: "loop", clip: "riffle" });
    expect(planFor("pane", undefined, "working", false)).toEqual({ kind: "loop", clip: "touchUp" });
  });
  test("done nods and failed looks sorry only on the change from working", () => {
    expect(planFor("pane", "working", "done", false)).toEqual({
      kind: "beat",
      clip: "nod",
    });
    expect(planFor("bubble", "working", "failed", false)).toEqual({
      kind: "beat",
      clip: "sorry",
    });
    // Reopening later (or a reload with history) shows the still pose: the beat never replays.
    expect(planFor("pane", undefined, "done", false)).toEqual({ kind: "still" });
    expect(planFor("pane", "idle", "failed", false)).toEqual({ kind: "still" });
  });
  test("idle is resting life, which stops on its own", () => {
    expect(planFor("bubble", "done", "idle", false)).toEqual({ kind: "idle" });
  });
  test("reduced motion: every state is its still pose", () => {
    for (const s of ["idle", "working", "done", "failed"] as const) {
      expect(planFor("bubble", "working", s, true)).toEqual({ kind: "still" });
      expect(planFor("pane", "idle", s, true)).toEqual({ kind: "still" });
    }
  });
});

describe("clips", () => {
  test("one-shot beats start on their base, and nod and perk end exactly on it", () => {
    for (const ctx of ["bubble", "pane"] as const) {
      const b = base(ctx);
      for (const name of ["nod", "perk", "sorry"]) near(poseAt(CLIPS[name] as Clip, 0, b), b);
      near(endOf("nod", b), b);
      near(endOf("perk", b), b);
    }
  });
  test("working loops wrap seamlessly: the end of one loop is the start of the next", () => {
    const b = base("bubble");
    const riffle = CLIPS.riffle as Clip;
    const end = poseAt({ ...riffle, loop: false }, riffle.duration, b);
    const start = poseAt(riffle, 0, b);
    near({ ...end, card: 0, shift: 0 }, start);
    // the stack has turned one place: the old front card sits where the back card was
    const before = stackAt(0, 0);
    const after = stackAt(1, 1);
    expect(after[0]?.x).toBeCloseTo(before[2]?.x ?? Number.NaN, 6);
    expect(after[0]?.y).toBeCloseTo(before[2]?.y ?? Number.NaN, 6);
    expect(after[1]?.x).toBeCloseTo(before[0]?.x ?? Number.NaN, 6);
    const touch = CLIPS.touchUp as Clip;
    near(
      poseAt({ ...touch, loop: false }, touch.duration, base("pane")),
      poseAt(touch, 0, base("pane")),
    );
  });
  test("the travelling card swaps behind only at the top of its arc, clear of the stack", () => {
    expect(stackAt(0.49, 0)[0]?.behind).toBe(false);
    expect(stackAt(0.51, 0)[0]?.behind).toBe(true);
    // at the swap it is lifted a full card height (60) above the back card
    expect((stackAt(0.5, 0)[0]?.y ?? 0) - (stackAt(0, 0)[2]?.y ?? 0)).toBeLessThan(-60);
  });
  test("failed holds a sheepish pose: hand to its head, eyes down, mouth flat; not sad", () => {
    const p = stillPose("pane", "failed");
    expect(p.ly).toBeLessThan(-40);
    expect(p.lx).toBeGreaterThan(0);
    expect(p.gy).toBeGreaterThan(0);
    expect(p.smile).toBeLessThan(-1);
    expect(p.eye).toBeCloseTo(1, 6);
  });
  test("the line redraw: covered as the pencil pulls back, uncovered left to right", () => {
    expect(inkAt(60)).toEqual({ pass: 0, cover: 0.5, wipe: 0 });
    expect(inkAt(700 + 600).wipe).toBe(1);
    expect(inkAt(2400 + 10).pass).toBe(3);
    const mid = inkAt(340);
    expect(mid.wipe).toBeGreaterThan(0.3);
    expect(mid.wipe).toBeLessThan(0.7);
  });
  test("the rest drawing is the artwork", () => {
    const g = geometry(REST, 0, 3);
    expect(g.mouth).toBe("M127 141Q138 151 150 139");
    expect(g.arms[0]?.d).toBe("M55 105Q24 96 19 130");
    expect(g.arms[1]?.d).toBe("M244 117Q275 123 277 94");
    expect(g.legs).toBe(
      "M60 221 Q55.5 247.5 51 274 L32 277 M223 217 Q231.5 242.5 240 268 L260 268",
    );
  });
});

function withReducedMotion(reduce: boolean) {
  const original = window.matchMedia;
  window.matchMedia = ((q: string) => ({
    matches: reduce && q.includes("reduce"),
    media: q,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}

describe("the runtime", () => {
  test("follows idle, working, done and failed; a beat plays only from working", () => {
    const restore = withReducedMotion(false);
    const { container, rerender } = render(<SlidesActor context="bubble" state="idle" />);
    const svg = () => container.querySelector("[data-cast=slides]") as SVGElement;
    expect(svg().dataset.castBeat).toBe("idle");
    rerender(<SlidesActor context="bubble" state="working" />);
    expect(svg().dataset.castState).toBe("working");
    expect(svg().dataset.castBeat).toBe("riffle");
    rerender(<SlidesActor context="bubble" state="done" />);
    expect(svg().dataset.castBeat).toBe("nod");
    rerender(<SlidesActor context="bubble" state="working" />);
    rerender(<SlidesActor context="bubble" state="failed" />);
    expect(svg().dataset.castBeat).toBe("sorry");
    expect(svg().dataset.castReduced).toBe("false");
    restore();
  });
  test("reduced motion: still poses, no frames requested, the failed pose drawn at once", () => {
    const restore = withReducedMotion(true);
    const raf = window.requestAnimationFrame;
    let frames = 0;
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      frames++;
      return raf(cb);
    }) as typeof window.requestAnimationFrame;
    const { container, rerender } = render(<SlidesActor context="pane" state="working" />);
    const svg = () => container.querySelector("[data-cast=slides]") as SVGElement;
    expect(svg().dataset.castReduced).toBe("true");
    expect(svg().dataset.castBeat).toBe("still");
    act(() => rerender(<SlidesActor context="pane" state="failed" />));
    expect(svg().dataset.castBeat).toBe("still");
    const arm = container.querySelector("[data-part=arm-left]")?.getAttribute("d");
    expect(arm).toBe(geometry(stillPose("pane", "failed")).arms[0]?.d);
    expect(frames).toBe(0);
    window.requestAnimationFrame = raf;
    restore();
  });
  test("a hidden tab pauses: no frames are requested while hidden", () => {
    const restore = withReducedMotion(false);
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    const raf = window.requestAnimationFrame;
    let frames = 0;
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      frames++;
      return raf(cb);
    }) as typeof window.requestAnimationFrame;
    render(<SlidesActor context="bubble" state="working" />);
    expect(frames).toBe(0);
    window.requestAnimationFrame = raf;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    restore();
  });
});
