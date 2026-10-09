import { describe, expect, mock, test } from "bun:test";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { SAVE_FAILED_MESSAGE, type SaveState } from "../model/use-autosave";
import { SaveFailedBar } from "./SaveFailedBar";

/** A hand-driven autosave store: the bar only reads it. */
function fakeAutosave() {
  let state: SaveState = "saved";
  let unreported = false;
  let lastSavedAt: number | null = null;
  const listeners = new Set<() => void>();
  const flush = mock(async () => {});
  return {
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getState: () => state,
    getUnreportedFailure: () => state === "failed" && unreported,
    getLastSavedAt: () => lastSavedAt,
    flush,
    set(next: SaveState, opts: { unreported?: boolean; savedAt?: number } = {}) {
      state = next;
      unreported = opts.unreported ?? false;
      if (opts.savedAt) lastSavedAt = opts.savedAt;
      for (const l of listeners) l();
    },
  };
}

describe("SaveFailedBar (TEACH-245)", () => {
  test("hidden while saves land; an unexplained failure shows one bar with Retry until a save succeeds", () => {
    const autosave = fakeAutosave();
    render(<SaveFailedBar autosave={autosave} />);
    expect(screen.queryByRole("alert")).toBeNull();

    act(() => autosave.set("saved", { savedAt: new Date(2026, 9, 9, 14, 32).getTime() }));
    for (let i = 0; i < 3; i++) act(() => autosave.set("failed", { unreported: true }));
    const bars = screen.getAllByRole("alert");
    expect(bars).toHaveLength(1);
    expect(bars[0]).toHaveTextContent(SAVE_FAILED_MESSAGE);
    expect(bars[0]).toHaveTextContent(/Last saved at (14:32|0?2:32)/);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(autosave.flush).toHaveBeenCalledTimes(1);

    act(() => autosave.set("saved"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("a refusal the app already explained raises no bar", () => {
    const autosave = fakeAutosave();
    render(<SaveFailedBar autosave={autosave} />);
    act(() => autosave.set("failed", { unreported: false }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
