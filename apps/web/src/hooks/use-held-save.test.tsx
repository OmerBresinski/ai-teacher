import { describe, expect, it } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { SaveDeferredError, SaveHeldError } from "@tj/editor/autosave";
import { useHeldSave } from "./use-held-save";

/* Live writing (ADR 0039): a save while every slide is the job's is held, then lands. */

type Doc = { id: string; themeId: string; slides: { id: string }[]; generation?: unknown };
const row = (states: Record<string, "writing" | "done">) => ({
  slides: Object.keys(states).map((id) => ({ id })),
  generation: { slideStates: states },
});

describe("useHeldSave", () => {
  it("a theme change made while every slide is writing survives: saved once a slide is done", async () => {
    const saved: Doc[] = [];
    const save = async (d: Doc) => {
      saved.push(d);
    };
    // The editor's copy when the first slide is done: the teacher's theme plus the job's slides.
    const current: Doc = { id: "l1", themeId: "treehouse", slides: [{ id: "s1" }, { id: "s3" }] };
    const pull = async () => current;
    const { result, rerender } = renderHook(
      (p: { row: ReturnType<typeof row> }) =>
        useHeldSave<Doc>({ save, row: p.row, generating: true, pull }),
      { initialProps: { row: row({ s1: "writing", s2: "writing" }) } },
    );
    // The teacher picks a theme: nothing is sent (the server would refuse), nothing is dropped.
    // It is deferred (still "Unsaved changes"), never reported as saved.
    let refused: unknown;
    await act(() =>
      result.current({ id: "l1", themeId: "treehouse", slides: [{ id: "s1" }] }).catch((e) => {
        refused = e;
      }),
    );
    expect(refused).toBeInstanceOf(SaveDeferredError);
    expect(saved).toEqual([]);
    // Slide 1 is done: the editor's copy is saved, theme and all.
    await act(async () => {
      rerender({ row: row({ s1: "done", s2: "writing", s3: "writing" }) });
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(saved).toHaveLength(1);
    expect(saved[0]?.themeId).toBe("treehouse");
    expect(saved[0]?.slides.map((s) => s.id)).toEqual(["s1", "s3"]);
    // Saves go straight through from then on.
    await act(() => result.current({ ...current, themeId: "splash" }));
    expect(saved.at(-1)?.themeId).toBe("splash");
  });

  // P0 25 Oct 2026: the editor's fit stamp is not the teacher's; it waits quietly ("Saved").
  it("a copy that differs from the row only in the editor's stamps is held, not deferred", async () => {
    const r = { ...row({ s1: "writing" }), id: "l1", themeId: "a", fitVersion: 0, updatedAt: "x" };
    const { result } = renderHook(() =>
      useHeldSave<Doc>({
        save: async () => {},
        row: r,
        generating: true,
        pull: async () => undefined,
      }),
    );
    const stamped = { ...r, fitVersion: 3, updatedAt: "y", slides: [{ id: "s1" }] };
    let refused: unknown;
    await act(() =>
      result.current(stamped).catch((e) => {
        refused = e;
      }),
    );
    expect(refused).toBeInstanceOf(SaveHeldError);
  });

  it("saves go straight through when a slide is done or no job holds the lesson", async () => {
    const saved: Doc[] = [];
    const save = async (d: Doc) => {
      saved.push(d);
    };
    const doc: Doc = { id: "l1", themeId: "a", slides: [] };
    const free = renderHook(() =>
      useHeldSave<Doc>({
        save,
        row: row({ s1: "writing" }),
        generating: false,
        pull: async () => doc,
      }),
    );
    await act(() => free.result.current(doc));
    const done = renderHook(() =>
      useHeldSave<Doc>({ save, row: row({ s1: "done" }), generating: true, pull: async () => doc }),
    );
    await act(() => done.result.current(doc));
    expect(saved).toHaveLength(2);
  });
});
