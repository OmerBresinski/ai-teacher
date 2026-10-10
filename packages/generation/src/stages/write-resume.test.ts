import { describe, expect, test } from "bun:test";
import type { FakeCall } from "@tj/ai/testing";
import type { Lesson, Slide } from "@tj/domain/documents";
import { labAi, romansLesson } from "../planner/testing";
import { initialState, type RecordedDeps, recordingDeps, writerFixture } from "../testing";
import type { PipelineState } from "../types";
import { WRITER_VERSION, writerRoute } from "../writer/ai-services";
import { checkedWriterObjectives } from "./objectives";
import { write } from "./write";

/*
 * A retry never visibly undoes work (production job 01a126e5-ee5a, 10 Oct): attempt 0 threw in the
 * write stage after slides were written and shown; pg-boss retried and the second attempt
 * re-streamed the writer over them ("Writing…" back on finished slides, placed photos gone, new
 * headings). A retry keeps every slide a previous attempt finished, exactly as saved.
 */

const fixture = writerFixture();
function writerAi(stream = { pieceChars: 120, paceMs: 15 }) {
  const calls = { lesson: 0 };
  const answers = (call: FakeCall) => {
    const v = call.context?.promptVersion ?? "";
    if (!v.startsWith(`${WRITER_VERSION}/`)) return undefined;
    if (v.endsWith("/lesson")) {
      calls.lesson += 1;
      return { text: fixture.main, stream };
    }
    if (v.endsWith("/notes")) return fixture.notes;
    if (v.endsWith("/objectives"))
      return JSON.stringify({
        objectives: [
          "Describe who invaded Britain in AD 43.",
          "Explain why the Romans invaded Britain.",
          "Evaluate how far the invasion changed Britain.",
        ],
      });
    if (v.endsWith("/pupil_objectives")) return JSON.stringify({ pupil: ["a", "b", "c"] });
    return "{}";
  };
  return { ai: labAi({ extra: answers, route: writerRoute }), calls };
}

/** A photo the first attempt placed on `slide`, and words the teacher saw on it. */
function asPlaced(slide: Slide, heading: string): Slide {
  return {
    ...slide,
    elements: [
      ...slide.elements.map((el) =>
        el.type === "text" && "text" in el && slide.elements.indexOf(el) === 0
          ? ({ ...el, text: heading } as typeof el)
          : el,
      ),
      {
        id: "placed-photo",
        type: "image",
        x: 600,
        y: 120,
        w: 300,
        h: 200,
        src: "https://example.test/placed.jpg",
        alt: "A Roman legionary",
      } as unknown as Slide["elements"][number],
    ],
  };
}

/** The stored row after attempt 0, with one finished slide given a photo and its own heading. */
function storedAfter(deps: RecordedDeps): Lesson {
  const last = deps.persisted.at(-1)?.lesson as Lesson;
  const states = last.generation?.slideStates ?? {};
  const at = last.slides.findIndex((s, i) => i >= 2 && states[s.id] === "done");
  expect(at).toBeGreaterThanOrEqual(2);
  const slides = last.slides.map((s, i) => (i === at ? asPlaced(s, "Choose the next step") : s));
  return { ...last, slides };
}

/** Every save of the retry: no finished slide is `writing`, changed or missing. */
function expectFinishedUntouched(stored: Lesson, retry: RecordedDeps) {
  const states = stored.generation?.slideStates ?? {};
  const finished = stored.slides.filter((s) => states[s.id] === "done");
  expect(finished.length).toBeGreaterThan(0);
  expect(retry.persisted.length).toBeGreaterThan(0);
  for (const { lesson } of retry.persisted) {
    for (const slide of finished) {
      expect(lesson.generation?.slideStates?.[slide.id]).not.toBe("writing");
      expect(lesson.slides.find((s) => s.id === slide.id)).toEqual(slide);
    }
  }
}

async function plannedState(): Promise<PipelineState> {
  return checkedWriterObjectives(initialState(romansLesson()), recordingDeps(writerAi().ai));
}

describe("a retry after the write stage threw", () => {
  test("after the editable deck was saved: finishes from it without writing again", async () => {
    const planned = await plannedState();
    const first = writerAi();
    const a0 = recordingDeps(first.ai);
    const deps0: RecordedDeps = {
      ...a0,
      onProgress: async (_p, message) => {
        // The production TypeError came after the editable deck had landed.
        if (message === "Slides written") throw new TypeError("x is undefined");
      },
    };
    await expect(write(planned, deps0)).rejects.toBeInstanceOf(TypeError);
    const stored = storedAfter(a0);
    expect(Object.values(stored.generation?.slideStates ?? {}).every((s) => s === "done")).toBe(
      true,
    );

    const second = writerAi();
    const retry = recordingDeps(second.ai);
    const out = await write({ ...planned, lesson: stored }, retry);
    expectFinishedUntouched(stored, retry);
    expect(second.calls.lesson).toBe(0);
    expect(out.lesson.generation?.stage).toBe("generated");
    expect(out.lesson.slides).toEqual(stored.slides);
  });

  test("mid-stream: keeps the finished slides and writes the rest off-screen", async () => {
    const planned = await plannedState();
    const first = writerAi({ pieceChars: 60, paceMs: 40 });
    // The job stops while the writer streams, after a few slides are saved.
    const a0 = recordingDeps(first.ai);
    const save = a0.persist;
    a0.persist = async (lesson, worksheet) => {
      const saved = await save(lesson, worksheet);
      const states = lesson.generation?.slideStates ?? {};
      const finished = lesson.slides.filter((s, i) => i >= 2 && states[s.id] === "done");
      if (finished.length >= 2) a0.abort.abort(new DOMException("cancelled", "AbortError"));
      return saved;
    };
    await expect(write(planned, a0)).rejects.toBeDefined();
    await new Promise((r) => setTimeout(r, 1200));
    const stored = storedAfter(a0);
    expect(stored.generation?.stage).toBe("planned");
    expect(Object.values(stored.generation?.slideStates ?? {})).not.toContain("writing");

    const second = writerAi();
    const retry = recordingDeps(second.ai);
    const out = await write({ ...planned, lesson: stored }, retry);
    expectFinishedUntouched(stored, retry);
    expect(second.calls.lesson).toBe(1);
    expect(out.lesson.generation?.stage).toBe("generated");
    expect(out.lesson.slides.length).toBeGreaterThan(stored.slides.length);
  }, 20_000);
});
