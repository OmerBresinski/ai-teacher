import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { Lesson } from "@tj/domain/documents";
import { SaveDeferredError } from "../model/use-autosave";
import { renderEditor, seededLesson, shape } from "./test-harness";

/*
 * PR 622 review: a teacher's change the editor could not write before it unmounted is handed to
 * the app with the server copy it was made on (`onAbandon`), and merged back in on the next open
 * (`restore`) as the teacher's own change, so it is never silently lost and the job's later
 * writing is not undone.
 */

afterEach(cleanup);

describe("a teacher's unsaved change across an unmount", () => {
  test("an edit the job's lock defers is handed on at unmount with the copy it was made on", async () => {
    const lesson = seededLesson();
    const onSave = mock((_l: Lesson) =>
      Promise.reject(new SaveDeferredError("the job holds the row")),
    );
    const onAbandon = mock((_l: Lesson, _base: Lesson | null) => {});
    const { unmount } = renderEditor(lesson, { onSave, onAbandon });
    fireEvent.click(await screen.findByRole("button", { name: "Rename lesson" }));
    const input = screen.getByRole("textbox", { name: "Lesson title" });
    fireEvent.change(input, { target: { value: "Teacher's title" } });
    fireEvent.blur(input);
    unmount();
    await waitFor(() => expect(onAbandon).toHaveBeenCalledTimes(1));
    const [kept, base] = onAbandon.mock.calls[0] ?? [];
    expect(kept?.title).toBe("Teacher's title");
    expect(base?.title).toBe(lesson.title);
    await new Promise((r) => setTimeout(r, 50));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  test("a kept change is merged onto the newer row on the next open and saved", async () => {
    const base = seededLesson();
    // Since the change was kept, the job wrote the third slide.
    const row = structuredClone(base);
    const third = row.slides[2];
    if (third) third.elements = [shape(10, 10)];
    const kept = { ...structuredClone(base), title: "Teacher's title" };
    const onRestored = mock((_applied: boolean) => {});
    const { onSave, read } = renderEditor(row, {
      restore: { lesson: kept, base },
      onRestored,
    });
    await waitFor(() => expect(onRestored).toHaveBeenCalledWith(true));
    expect(read().title).toBe("Teacher's title");
    await waitFor(() => expect(onSave).toHaveBeenCalled(), { timeout: 3_000 });
    const saved = onSave.mock.calls.at(-1)?.[0];
    expect(saved?.title).toBe("Teacher's title");
    // The job's writing stays: only what the teacher changed comes back.
    expect(saved?.slides[2]?.elements).toHaveLength(1);
    expect(onRestored).toHaveBeenCalledTimes(1);
  });

  // TEACH-251 part p: a kept change rejoins through the history, so the slides it changed are
  // marked as the teacher's (the job's merge keeps them); slides it did not change stay unmarked.
  test("a kept slide change restored on the next open is marked as the teacher's", async () => {
    const seeded = seededLesson();
    const base: Lesson = {
      ...seeded,
      generation: {
        jobId: "job",
        stage: "planned",
        startedAt: "2026-10-26T04:00:00.000Z",
        promptVersions: {},
        usage: { calls: 1, inputTokens: 1, outputTokens: 1, costUsd: 0 },
        findings: [],
        slideStates: Object.fromEntries(seeded.slides.map((s) => [s.id, "done" as const])),
      },
    };
    const kept = structuredClone(base);
    const second = kept.slides[1];
    if (second) second.elements = [shape(300, 200)];
    const onRestored = mock((_applied: boolean) => {});
    const { onSave } = renderEditor(structuredClone(base), {
      restore: { lesson: kept, base },
      onRestored,
    });
    await waitFor(() => expect(onRestored).toHaveBeenCalledWith(true));
    await waitFor(() => expect(onSave).toHaveBeenCalled(), { timeout: 3_000 });
    const saved = onSave.mock.calls.at(-1)?.[0];
    expect(saved?.slides.map((s) => s.teacherEdited === true)).toEqual([false, true, false]);
  });

  test("a kept copy that the row already holds changes nothing and says nothing", async () => {
    const base = seededLesson();
    const onRestored = mock((_applied: boolean) => {});
    const { onSave } = renderEditor(base, {
      restore: { lesson: structuredClone(base), base },
      onRestored,
    });
    await waitFor(() => expect(onRestored).toHaveBeenCalledWith(false));
    await new Promise((r) => setTimeout(r, 1_000));
    expect(onSave).not.toHaveBeenCalled();
  });
});
