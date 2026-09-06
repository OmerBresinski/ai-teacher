import { describe, expect, test } from "bun:test";
import {
  initialPresentState,
  type PresentAction,
  type PresentState,
  panelToClose,
  presentReducer,
} from "./present-reducer";

const deck = (steps = [0, 2, 1]): PresentState =>
  presentReducer(initialPresentState(0), {
    type: "setDeck",
    slideIds: steps.map((_, i) => `s${i}`),
    steps,
  });

const run = (s: PresentState, ...actions: PresentAction[]) => actions.reduce(presentReducer, s);

describe("presentReducer", () => {
  test("setDeck positions on startIndex, clamps it, and resets the session position", () => {
    const s = presentReducer(initialPresentState(0), {
      type: "setDeck",
      slideIds: ["a", "b", "c"],
      steps: [0, 0, 0],
      startIndex: 7,
    });
    expect(s.index).toBe(2);
    expect(s.reachedIndex).toBe(2);
    expect(s.ended).toBe(false);
  });

  test("the same deck again keeps the position and clamps the step into the new count", () => {
    let s = run(deck([0, 2, 1]), { type: "next" }, { type: "next" }, { type: "next" });
    expect([s.index, s.step]).toEqual([1, 2]);
    s = presentReducer(s, { type: "setDeck", slideIds: ["s0", "s1", "s2"], steps: [0, 1, 1] });
    expect([s.index, s.step]).toEqual([1, 1]);
  });

  test("next walks steps then slides, then ends; prev walks back into the last step", () => {
    let s = deck([0, 2, 1]);
    s = presentReducer(s, { type: "next" });
    expect([s.index, s.step, s.direction]).toEqual([1, 0, 1]);
    s = run(s, { type: "next" }, { type: "next" });
    expect([s.index, s.step]).toEqual([1, 2]);
    s = presentReducer(s, { type: "next" });
    expect([s.index, s.step]).toEqual([2, 0]);
    s = run(s, { type: "next" }, { type: "next" });
    expect(s.ended).toBe(true);
    expect(presentReducer(s, { type: "next" })).toBe(s);
    s = presentReducer(s, { type: "prev" });
    expect(s.ended).toBe(false);
    expect([s.index, s.step]).toEqual([2, 1]);
    s = run(s, { type: "prev" }, { type: "prev" });
    expect([s.index, s.step, s.direction]).toEqual([1, 2, -1]);
  });

  test("reachedIndex is monotonic: going back never lowers it", () => {
    let s = run(deck([0, 0, 0, 0]), { type: "next" }, { type: "next" }, { type: "prev" });
    expect(s.index).toBe(1);
    expect(s.reachedIndex).toBe(2);
    s = presentReducer(s, { type: "last" });
    expect(s.reachedIndex).toBe(3);
    s = presentReducer(s, { type: "first" });
    expect(s.reachedIndex).toBe(3);
    // restart does not lower it either.
    expect(presentReducer(s, { type: "restart" }).reachedIndex).toBe(3);
  });

  test("goTo clamps index and step and sets direction from where it came", () => {
    const s = presentReducer(deck([0, 2, 1]), { type: "goTo", index: 9, step: 9 });
    expect([s.index, s.step, s.direction]).toEqual([2, 1, 1]);
    const back = presentReducer(s, { type: "goTo", index: 0 });
    expect(back.direction).toBe(-1);
  });

  test("any move clears a blackout; toggles flip", () => {
    let s = presentReducer(deck(), { type: "toggleBlackout", blackout: "black" });
    expect(s.blackout).toBe("black");
    expect(presentReducer(s, { type: "toggleBlackout", blackout: "black" }).blackout).toBe("none");
    expect(presentReducer(s, { type: "toggleBlackout", blackout: "white" }).blackout).toBe("white");
    s = presentReducer(s, { type: "next" });
    expect(s.blackout).toBe("none");
  });

  test("tools and the laser are mutually exclusive", () => {
    let s = presentReducer(deck(), { type: "toggleTool", tool: "pen" });
    expect(s.tool).toBe("pen");
    s = presentReducer(s, { type: "toggleLaser" });
    expect([s.tool, s.laser]).toEqual(["none", true]);
    s = presentReducer(s, { type: "toggleTool", tool: "eraser" });
    expect([s.tool, s.laser]).toEqual(["eraser", false]);
    expect(presentReducer(s, { type: "toggleTool", tool: "eraser" }).tool).toBe("none");
  });

  test("closePanels follows the Esc order and reports what it would close", () => {
    let s = run(
      deck(),
      { type: "setOverviewOpen", open: true },
      { type: "setShortcutsOpen", open: true },
      { type: "setTimerOpen", open: true },
      { type: "setNotesOpen", open: true },
      { type: "toggleTool", tool: "pen" },
    );
    const order: ReturnType<typeof panelToClose>[] = [];
    for (let i = 0; i < 6; i += 1) {
      order.push(panelToClose(s));
      s = presentReducer(s, { type: "closePanels" });
    }
    expect(order).toEqual(["overview", "shortcuts", "timer", "notes", "tool", null]);
  });

  test("timer actions thread `at` through the pure timer", () => {
    let s = presentReducer(deck(), { type: "startTimer", at: 1000, ms: 60_000 });
    expect(s.timer.endsAt).toBe(61_000);
    s = presentReducer(s, { type: "pauseTimer", at: 21_000 });
    expect(s.timer.pausedRemainingMs).toBe(40_000);
    s = presentReducer(s, { type: "clearTimer" });
    expect(s.timer.armed).toBe(false);
  });

  test("reset returns to the initial state with a fresh session clock", () => {
    const s = run(deck(), { type: "next" }, { type: "setNotesOpen", open: true });
    expect(presentReducer(s, { type: "reset", at: 42 })).toEqual(initialPresentState(42));
  });
});
