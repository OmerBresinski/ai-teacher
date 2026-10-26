import { beforeEach, describe, expect, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import type { Id } from "@tj/domain/documents";
import { useState } from "react";
import {
  FOLLOW_PACE,
  type FollowTimer,
  isTeacherNavigation,
  PLANNING_VIEW,
  planningView,
  useFollowWriting,
} from "./use-follow-writing";

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
      return { active, setActive, ...follow };
    },
    { initialProps: { lead: start, typed } as Props },
  );
}
/** A clock the test moves by hand: due callbacks run in time order as it advances. */
function manualClock() {
  let at = 0;
  let seq = 0;
  const due = new Map<number, { at: number; fn: () => void }>();
  const delays: number[] = [];
  const timer: FollowTimer = (fn, ms) => {
    delays.push(ms);
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
  return { now: () => at, timer, advance, delays };
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

  test("five slides behind it goes straight to the slide being written, once the open one is read", () => {
    const r = setup(3);
    r.rerender({ lead: 8, typed: "open" });
    tick(0);
    // Greg 26 Oct: never less than ~800 ms after a slide visibly finishes, however far behind.
    expect(r.result.current.active).toBe(id(3));
    tick(FOLLOW_PACE.catchUpReadMs - 1);
    expect(r.result.current.active).toBe(id(3));
    tick(FOLLOW_PACE.catchUpMinMs);
    expect(r.result.current.active).toBe(id(8));
  });

  test("a slide is never left less than the read time after its words finish, however long it was open", () => {
    // Greg 26 Oct: one slide was left 0.1 s after its last word (it had been open past the give-up).
    const r = setup(3, null);
    r.rerender({ lead: 3, typed: id(3) });
    tick(10);
    // Still typing (more words came): it no longer reports its words out. Open well past the old
    // give-up (8 s) while the writer is still on it.
    r.rerender({ lead: 3, typed: null });
    tick(FOLLOW_PACE.maxOpenMs);
    // The writer moves on; the stall cap (6 s) counts from here.
    r.rerender({ lead: 4, typed: null });
    tick(FOLLOW_PACE.stallMs - 100);
    expect(r.result.current.active).toBe(id(3));
    // Its last word is out: it stands the read time, then the follow moves on.
    r.rerender({ lead: 4, typed: id(3) });
    tick(FOLLOW_PACE.readMs - 1);
    expect(r.result.current.active).toBe(id(3));
    tick(1);
    expect(r.result.current.active).toBe(id(4));
  });

  test("behind the writer, the dwell after a slide's last word is still at least 800 ms", () => {
    const r = setup(3);
    r.rerender({ lead: 7, typed: "open" });
    tick(FOLLOW_PACE.catchUpMinMs);
    expect(r.result.current.active).toBe(id(4));
    expect(r.result.current.behind).toBe(3);
    tick(FOLLOW_PACE.catchUpMinMs - 1);
    expect(r.result.current.active).toBe(id(4));
    expect(FOLLOW_PACE.catchUpReadMs).toBeGreaterThanOrEqual(800);
  });

  test("every wait the follow asks for is finite (no setTimeout(fn, Infinity) render loop)", () => {
    const r = setup(3, null);
    r.rerender({ lead: 3, typed: id(3) });
    tick(10);
    // Typing again after it reported its words out, while the writer is on the next slide.
    r.rerender({ lead: 4, typed: null });
    for (let i = 0; i < 20; i++) tick(100);
    expect(clock.delays.length).toBeGreaterThan(0);
    expect(clock.delays.every((d) => Number.isFinite(d) && d > 0)).toBe(true);
  });

  test("a slide that never reports its words typed again is left at the stall cap", () => {
    const r = setup(3, null);
    r.rerender({ lead: 3, typed: id(3) });
    tick(10);
    r.rerender({ lead: 4, typed: null });
    tick(FOLLOW_PACE.stallMs - 1);
    expect(r.result.current.active).toBe(id(3));
    tick(1);
    expect(r.result.current.active).toBe(id(4));
  });

  test("Follow writing with nothing to move to is spent, not kept for the next slide", () => {
    const r = setup(3);
    act(() => r.result.current.stop());
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

  test("any change of the open slide the follow did not make stops it, earlier or later", () => {
    // An earlier slide (undo, search, the toolbar's previous): the follow never walks the teacher
    // forward again.
    const back = setup(3);
    tick(10);
    expect(back.result.current.active).toBe(id(3));
    act(() => back.result.current.setActive(id(2)));
    expect(back.result.current.following).toBe(false);
    back.rerender({ lead: 5, typed: "open" });
    for (let i = 0; i < 8; i++) tick(FOLLOW_PACE.minMs);
    expect(back.result.current.active).toBe(id(2));
    // A later one (the toolbar's next, a screen reader activating a thumbnail): stopped too.
    const ahead = setup(3);
    tick(10);
    act(() => ahead.result.current.setActive(id(4)));
    expect(ahead.result.current.following).toBe(false);
  });
});

describe("isTeacherNavigation", () => {
  const zone = (attr: string) => {
    const el = document.createElement("div");
    el.setAttribute(attr, "");
    const inner = document.createElement("span");
    el.append(inner);
    document.body.append(el);
    return { el, inner };
  };
  const on = (target: Element, e: Event) => {
    let seen = false;
    const look = (ev: Event) => {
      seen = isTeacherNavigation(ev);
    };
    target.addEventListener(e.type, look);
    target.dispatchEvent(e);
    target.removeEventListener(e.type, look);
    return seen;
  };
  const down = () => new Event("pointerdown", { bubbles: true });
  const key = (k: string, init: KeyboardEventInit = {}) =>
    new KeyboardEvent("keydown", { key: k, bubbles: true, ...init });

  test("a click or a movement key on a thumbnail or the canvas is navigation", () => {
    const strip = zone("data-navigator");
    const canvas = zone("data-slide-frame");
    expect(on(strip.inner, down())).toBe(true);
    expect(on(strip.inner, key("ArrowDown"))).toBe(true);
    expect(on(canvas.inner, down())).toBe(true);
    expect(on(canvas.inner, key("Enter"))).toBe(true);
    strip.el.remove();
    canvas.el.remove();
  });

  test("a scroll in the strip is navigation; a wheel over the canvas is not", () => {
    const strip = zone("data-navigator");
    const canvas = zone("data-slide-frame");
    expect(on(strip.inner, new Event("wheel", { bubbles: true }))).toBe(true);
    expect(on(strip.inner, new Event("touchmove", { bubbles: true }))).toBe(true);
    expect(on(canvas.inner, new Event("wheel", { bubbles: true }))).toBe(false);
    strip.el.remove();
    canvas.el.remove();
  });

  test("the top bar, a dialog, the chip and shortcut chords are not", () => {
    const bar = zone("data-top-bar");
    const dialog = zone("role");
    dialog.el.setAttribute("role", "dialog");
    const strip = zone("data-navigator");
    const chipEl = document.createElement("button");
    chipEl.setAttribute("data-follow-writing", "");
    strip.el.append(chipEl);
    expect(on(bar.inner, down())).toBe(false);
    expect(on(dialog.inner, down())).toBe(false);
    expect(on(dialog.inner, key("ArrowDown"))).toBe(false);
    expect(on(chipEl, down())).toBe(false);
    expect(on(strip.inner, key("0", { metaKey: true }))).toBe(false);
    expect(on(strip.inner, key("Tab"))).toBe(false);
    const toggle = document.createElement("button");
    toggle.setAttribute("data-navigator-toggle", "");
    strip.el.append(toggle);
    expect(on(toggle, down())).toBe(false);
    for (const z of [bar, dialog, strip]) z.el.remove();
  });
});

describe("planningView (ruling 278, and the pending alternative)", () => {
  const deck = [
    { id: id(1), elements: [{ id: "t", name: "Text" }] },
    { id: id(2), elements: [{ id: "o", name: "Text" }] },
    { id: id(3), elements: [{ id: "p", name: "Planned" }] },
    { id: id(4), elements: [{ id: "q", name: "Planned" }] },
  ];
  const writing = new Set([id(2), id(3), id(4)]);
  test("ruling 278 is the default: the next planned slide's outline", () => {
    expect(PLANNING_VIEW).toBe("outline");
    expect(planningView(deck, writing, undefined)).toBe(id(3));
  });
  test("a slide typing out (title, objectives) holds first, in either view", () => {
    expect(planningView(deck, writing, id(2))).toBe(id(2));
    expect(planningView(deck, writing, id(2), "stay")).toBe(id(2));
  });
  test("the alternative stays on the last finished slide (the usual target)", () => {
    expect(planningView(deck, writing, undefined, "stay")).toBeUndefined();
  });
});
