import { beforeAll, describe, expect, test } from "bun:test";
import { act, fireEvent, waitFor } from "@testing-library/react";
import type { Lesson, RichDoc, Slide, TextElement } from "@tj/domain/documents";
import type { LessonEditorHandle } from "./LessonEditor";
import { catcher, loadTextEditor, pointer, renderEditor, seededLesson } from "./test-harness";

/*
 * TEACH-247 part an: a job's row folded in while the teacher is still typing must not swallow
 * their typing into the copy the next step is marked against. The fold lands between the last
 * keystroke and the edit's end (Escape), as it did in CI's `editor-filling.spec.ts`: the slide was
 * then never marked `teacherEdited`, so the page held the save as the editor's own repaint and the
 * edit never reached the row while the job wrote.
 */

beforeAll(loadTextEditor);

const para = (text: string): RichDoc => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

function fillingLesson(): Lesson {
  const lesson = seededLesson();
  const first = lesson.slides[0];
  if (!first) throw new Error("seed");
  const text: TextElement = {
    id: "t1",
    type: "text",
    x: 100,
    y: 100,
    w: 400,
    h: 100,
    doc: para("Hello"),
    style: { preset: "body" },
  };
  first.elements = [text];
  return {
    ...lesson,
    generation: {
      jobId: "job",
      stage: "planned",
      startedAt: "2026-10-26T04:00:00.000Z",
      promptVersions: {},
      usage: { calls: 1, inputTokens: 1, outputTokens: 1, costUsd: 0 },
      findings: [],
      slideStates: Object.fromEntries(lesson.slides.map((s) => [s.id, "done" as const])),
    },
  };
}

describe("marking the teacher's slide while the job writes", () => {
  test("a fold between the last keystroke and the end of the edit still marks the edited slide", async () => {
    const lesson = fillingLesson();
    const ref: { current: LessonEditorHandle | null } = { current: null };
    const saved: Lesson[] = [];
    const { container, read } = renderEditor(lesson, {
      editorRef: ref,
      onSave: (l: Lesson) => {
        saved.push(l);
        return Promise.resolve();
      },
    });
    fireEvent.pointerDown(catcher(container), pointer(150, 150));
    fireEvent.pointerUp(window, pointer(150, 150));
    fireEvent.doubleClick(catcher(container), { clientX: 150, clientY: 150 });
    await waitFor(() => expect(container.querySelector(".ProseMirror")).not.toBeNull(), {
      timeout: 5_000,
    });
    const pm = container.querySelector<HTMLElement>(".ProseMirror") as HTMLElement;
    // The teacher types: ProseMirror reads the change from its DOM.
    const p = pm.querySelector("p") as HTMLElement;
    (p.firstChild as Text).data = "Hello and where rain goes";
    // The keystrokes are in the document, inside the edit's open step: not yet marked.
    await waitFor(() => expect(JSON.stringify(read().slides[0])).toContain("where rain goes"));
    expect(read().slides[0]?.teacherEdited).toBeUndefined();
    // The job writes a later slide; the editor folds its row in before the edit has ended.
    const theirs: Lesson = {
      ...lesson,
      slides: lesson.slides.map((s, i) => (i === 1 ? ({ ...s, notes: "job" } as Slide) : s)),
    };
    act(() => {
      ref.current?.receiveGenerated(lesson, theirs);
    });
    fireEvent.keyDown(pm, { key: "Escape" });
    await waitFor(
      () => {
        const last = saved.at(-1);
        expect(JSON.stringify(last?.slides[0])).toContain("where rain goes");
        expect(last?.slides[1]?.notes).toBe("job");
      },
      { timeout: 3_000 },
    );
    expect(saved.at(-1)?.slides[0]?.teacherEdited).toBe(true);
  });
});
