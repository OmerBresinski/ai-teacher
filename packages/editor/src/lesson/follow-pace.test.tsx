import { beforeEach, describe, expect, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import type { Id } from "@tj/domain/documents";
import { useState } from "react";
import { FOLLOW_PACE, type FollowTimer, useFollowWriting } from "./use-follow-writing";

/*
 * TEACH-202 part o: the follow walks the deck one slide at a time, leaving a slide only once its
 * words are on screen and have stood a readable time; it gives up waiting on a slide that never
 * says so, and goes straight to the writer when far behind or on "Follow writing". A manual clock
 * goes in through the hook's `now` and `timer`, so no global timers change for other test files.
 */

const slides = Array.from({ length: 10 }, (_, i) => ({
  id: `s${i + 1}` as Id,
  elements: [{ id: `t${i + 1}`, name: "Text" }],
}));
const id = (n: number) => `s${n}` as Id;

type Props = { lead: number; typed: "open" | Id | null };
function setup(start: number, typed: Props["typed"] = "open") {
  return renderHook(
    (p: Props) => {
      const [active, setActive] = useState<Id | null>(null);
      const follow = useFollowWriting({
        slides,
        writingSlideIds: new Set([id(2), id(p.lead)]),
        lead: id(p.lead),
        activeSlideId: active,
        setActiveSlide: setActive,
        startFollowing: true,
        canvasFocused: false,
        typedId: p.typed === "open" ? (active ?? undefined) : (p.typed ?? undefined),
        now: clock.now,
        timer: clock.timer,
      });
      return { active, ...follow };
    },
    { initialProps: { lead: start, typed } as Props },
  );
}
/** A clock the test moves by hand: due callbacks run in time order as it advances. */
function manualClock() {
  let at = 0;
  let seq = 0;
  const due = new Map<number, { at: number; fn: () => void }>();
  const timer: FollowTimer = (fn, ms) => {
    const id = seq++;
    due.set(id, { at: at + ms, fn });
    return () => due.delete(id);
  };
  const advance = (ms: number) => {
    const end = at + ms;
    for (;;) {
      const next = [...due.entries()]
        .filter(([, t]) => t.at <= end)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      due.delete(next[0]);
      at = next[1].at;
      next[1].fn();
    }
    at = end;
  };
  return { now: () => at, timer, advance };
}
let clock = manualClock();
const tick = (ms: number) => act(() => clock.advance(ms));

beforeEach(() => {
  clock = manualClock();
});

describe("the follow paces itself", () => {
  test("a typed slide stays open its minimum, then the next slide, one at a time", () => {
    const r = setup(3);
    expect(r.result.current.active).toBe(id(3));
    r.rerender({ lead: 5, typed: "open" });
    tick(FOLLOW_PACE.minMs - 10);
    expect(r.result.current.active).toBe(id(3));
    tick(20);
    expect(r.result.current.active).toBe(id(4));
    tick(FOLLOW_PACE.minMs);
    expect(r.result.current.active).toBe(id(5));
  });

  test("a slide typed out late is read for readMs after its last word", () => {
    const r = setup(3, null);
    r.rerender({ lead: 4, typed: null });
    tick(3000);
    expect(r.result.current.active).toBe(id(3));
    r.rerender({ lead: 4, typed: id(3) });
    tick(FOLLOW_PACE.readMs - 10);
    expect(r.result.current.active).toBe(id(3));
    tick(20);
    expect(r.result.current.active).toBe(id(4));
  });

  test("a slide that never reports its words typed is left maxAfterTextMs after the writer moved on", () => {
    const r = setup(3, null);
    tick(1000);
    r.rerender({ lead: 4, typed: null });
    tick(FOLLOW_PACE.maxAfterTextMs - 10);
    expect(r.result.current.active).toBe(id(3));
    tick(20);
    expect(r.result.current.active).toBe(id(4));
  });

  test("three slides behind it reads faster", () => {
    const r = setup(3);
    r.rerender({ lead: 6, typed: "open" });
    tick(FOLLOW_PACE.catchUpMinMs + 10);
    expect(r.result.current.active).toBe(id(4));
  });

  test("five slides behind it goes straight to the slide being written", () => {
    const r = setup(3);
    r.rerender({ lead: 8, typed: "open" });
    tick(0);
    expect(r.result.current.active).toBe(id(8));
  });

  test("Follow writing with nothing to move to is spent, not kept for the next slide", () => {
    const r = setup(3);
    act(() => document.dispatchEvent(new Event("pointerdown")));
    expect(r.result.current.following).toBe(false);
    act(() => r.result.current.resume());
    expect(r.result.current.following).toBe(true);
    // The next slide comes: paced as usual, not a jump.
    r.rerender({ lead: 4, typed: "open" });
    tick(100);
    expect(r.result.current.active).toBe(id(3));
    tick(FOLLOW_PACE.minMs);
    expect(r.result.current.active).toBe(id(4));
  });
});
