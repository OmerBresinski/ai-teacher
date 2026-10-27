import { describe, expect, test } from "bun:test";
import type { FakeCall } from "@tj/ai/testing";
import { type Lesson, type Slide, SlideSchema } from "@tj/domain/documents";
import { PLACEHOLDER_IMAGE } from "@tj/slides/layouts";
import pino from "pino";
import { labAi, romansLesson } from "../planner/testing";
import { initialState, type RecordedDeps, recordingDeps, writerFixture } from "../testing";
import type { PipelineState } from "../types";
import { WRITER_VERSION, writerRoute } from "../writer/ai-services";
import { checkedWriterObjectives } from "./objectives";
import { hasEditableDeck, write } from "./write";

/*
 * A retry never visibly undoes work (production job 01a126e5-ee5a, 10 Oct): attempt 0 threw in the
 * write stage after slides were written and shown; pg-boss retried and the second attempt
 * re-streamed the writer over them ("Writing…" back on finished slides, placed photos gone, new
 * headings). A retry keeps every slide a previous attempt finished, exactly as saved.
 */

const fixture = writerFixture();
function writerAi(
  stream = { pieceChars: 120, paceMs: 15 },
  notes: "ok" | "fail" = "ok",
  /** Cut the writer's output to this share of its characters (a stream that breaks off). */
  cut?: number,
) {
  const calls = { lesson: 0 };
  const answers = (call: FakeCall) => {
    const v = call.context?.promptVersion ?? "";
    if (!v.startsWith(`${WRITER_VERSION}/`)) return undefined;
    if (v.endsWith("/lesson")) {
      calls.lesson += 1;
      const text = cut
        ? fixture.main.slice(0, Math.floor(fixture.main.length * cut))
        : fixture.main;
      // A cut stream ends as the token cap ends it (K3: `finish_reason length`).
      return { text, stream, ...(cut ? { finishReason: "length" as const } : {}) };
    }
    if (v.endsWith("/notes")) return notes === "ok" ? fixture.notes : "not json";
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

/** Speaker notes on every kept body slide (`s3` on) once the retry has finished. */
function expectNotesOnFinished(stored: Lesson, out: Lesson) {
  const states = stored.generation?.slideStates ?? {};
  const body = stored.slides.filter((s) => states[s.id] === "done" && /^s([3-9]|\d\d)$/.test(s.id));
  expect(body.length).toBeGreaterThan(0);
  for (const slide of body) {
    const now = out.slides.find((s) => s.id === slide.id);
    expect((now?.notes ?? "").length).toBeGreaterThan((slide.notes ?? "").length);
  }
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
      // Words, pictures and layout as saved; only the speaker notes may be added.
      const { notes: _n, ...shown } = slide;
      const { notes: _m, ...now } = lesson.slides.find((s) => s.id === slide.id) ?? slide;
      expect(now).toEqual(shown);
    }
  }
}

async function plannedState(): Promise<PipelineState> {
  return checkedWriterObjectives(initialState(romansLesson()), recordingDeps(writerAi().ai));
}

describe("a retry after the write stage threw", () => {
  test("after the editable deck was saved: finishes from it without writing again, notes written", async () => {
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
    // Every slide as saved, now with its speaker notes (written after editable, so none yet).
    expect(out.lesson.slides.map(({ notes: _n, ...s }) => s)).toEqual(
      stored.slides.map(({ notes: _n, ...s }) => s),
    );
    expectNotesOnFinished(stored, out.lesson);
    // The notes call is counted in the lesson's usage like every other call.
    expect(retry.budget.totals().calls).toBeGreaterThan(0);
    expect(out.lesson.generation?.usage).toEqual(retry.budget.totals());
  });

  test("a failed notes call on resume warns and still ships the deck as saved", async () => {
    const planned = await plannedState();
    const a0 = recordingDeps(writerAi().ai);
    const deps0: RecordedDeps = {
      ...a0,
      onProgress: async (_p, message) => {
        if (message === "Slides written") throw new TypeError("x is undefined");
      },
    };
    await expect(write(planned, deps0)).rejects.toBeInstanceOf(TypeError);
    const stored = storedAfter(a0);
    const lines: string[] = [];
    const logger = pino({ level: "warn" }, { write: (m: string) => void lines.push(m) });
    const retry = recordingDeps(writerAi(undefined, "fail").ai, { logger });
    const out = await write({ ...planned, lesson: stored }, retry);
    expect(out.lesson.generation?.stage).toBe("generated");
    expect(out.lesson.slides).toEqual(stored.slides);
    expect(lines.some((l) => l.includes("resumed deck shipped without speaker notes"))).toBe(true);
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
    expectNotesOnFinished(stored, out.lesson);
  }, 20_000);
});

describe("hasEditableDeck", () => {
  test("a stale editableAt never skips the writer: it needs the writer's planned checkpoint", async () => {
    const planned = await plannedState();
    const a0 = recordingDeps(writerAi().ai);
    const deps0: RecordedDeps = {
      ...a0,
      onProgress: async (_p, message) => {
        if (message === "Slides written") throw new TypeError("x is undefined");
      },
    };
    await expect(write(planned, deps0)).rejects.toBeInstanceOf(TypeError);
    const stored = a0.persisted.at(-1)?.lesson as Lesson;
    const g = stored.generation as NonNullable<Lesson["generation"]>;
    expect(hasEditableDeck(stored)).toBe(true);
    expect(hasEditableDeck({ ...stored, generation: { ...g, stage: "generated" } })).toBe(false);
    expect(
      hasEditableDeck({
        ...stored,
        generation: { ...g, promptVersions: { ...g.promptVersions, planned: "objectives.v9" } },
      }),
    ).toBe(false);
    expect(hasEditableDeck({ ...stored, generation: { ...g, editableAt: undefined } })).toBe(false);
  });
});

describe("UX-A: a writer that breaks off mid-stream", () => {
  test("keeps every finished slide (never the half-written one), and the retry resumes after them", async () => {
    const planned = await plannedState();
    // The writer runs out of length part-way: its JSON never closes (WriterIncompleteError).
    const broken = writerAi({ pieceChars: 60, paceMs: 5 }, "ok", 0.6);
    const a0 = recordingDeps(broken.ai);
    let shownDone = 0;
    const save = a0.persist;
    a0.persist = async (lesson, worksheet) => {
      const states = lesson.generation?.slideStates ?? {};
      const done = lesson.slides.filter((s, i) => i >= 2 && states[s.id] === "done").length;
      shownDone = Math.max(shownDone, done);
      return save(lesson, worksheet);
    };
    await expect(write(planned, a0)).rejects.toThrow(/incomplete/);
    await new Promise((r) => setTimeout(r, 300));
    const stored = a0.persisted.at(-1)?.lesson as Lesson;
    const states = stored.generation?.slideStates ?? {};
    const finished = stored.slides.filter((s, i) => i >= 2 && states[s.id] === "done");
    // Every slide the stream finished is still there and done; nothing is left `writing`.
    // The fixture cut at 60% has streamed past two body slides: those two, exactly, are kept.
    expect(shownDone).toBe(2);
    expect(finished.length).toBe(2);
    for (const slide of finished) expect(SlideSchema.safeParse(slide).success).toBe(true);
    expect(Object.values(states)).not.toContain("writing");
    expect(stored.slides.length).toBe(4);
    expect(stored.generation?.stage).toBe("planned");

    // Try again: the finished slides stand, in place, and the rest follows them once each.
    const retry = recordingDeps(writerAi().ai);
    const out = await write({ ...planned, lesson: stored }, retry);
    expectFinishedUntouched(stored, retry);
    const ids = out.lesson.slides.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Each finished slide sits where it was (the plan's title and objectives slides are the
    // writer's to replace, as on any run).
    for (const slide of finished) expect(ids.indexOf(slide.id)).toBe(stored.slides.indexOf(slide));
    expect(out.lesson.slides.length).toBeGreaterThan(stored.slides.length);
    expect(out.lesson.generation?.stage).toBe("generated");
  }, 20_000);
});

describe("part av: a deck that turned editable before its pictures settled", () => {
  test("a retry leaves no picture slot open: one with no picture found is laid away", async () => {
    const planned = await plannedState();
    const a0 = recordingDeps(writerAi().ai);
    const deps0: RecordedDeps = {
      ...a0,
      onProgress: async (_p, message) => {
        if (message === "Slides written") throw new TypeError("stopped while pictures settled");
      },
    };
    await expect(write(planned, deps0)).rejects.toBeInstanceOf(TypeError);
    const saved = storedAfter(a0);
    // The job stopped with a picture still coming on a done slide: its open frame was saved.
    const at = saved.slides.findIndex((s, i) => i >= 2 && s.elements.length > 0);
    const open = {
      id: "open-frame",
      type: "image",
      x: 980,
      y: 200,
      w: 800,
      h: 600,
      src: PLACEHOLDER_IMAGE,
      alt: "A Roman legionary in armour",
    } as unknown as Slide["elements"][number];
    const stored = {
      ...saved,
      slides: saved.slides.map((s, i) =>
        i === at ? { ...s, elements: [...s.elements, open] } : s,
      ),
    };
    const retry = recordingDeps(writerAi().ai);
    const out = await write({ ...planned, lesson: stored }, retry);
    const srcs = out.lesson.slides.flatMap((s) =>
      s.elements.flatMap((e) => (e.type === "image" ? [e.src] : [])),
    );
    expect(srcs).not.toContain(PLACEHOLDER_IMAGE);
    expect(out.lesson.slides.some((s) => s.elements.some((e) => e.id === "open-frame"))).toBe(
      false,
    );
    // The teacher's words on that slide are all still there.
    const words = (s: Slide) =>
      s.elements.flatMap((e) => (e.type === "text" && "text" in e ? [String(e.text)] : []));
    const was = stored.slides[at] as Slide;
    const now = out.lesson.slides.find((s) => s.id === was.id) as Slide;
    for (const w of words(was)) expect(words(now).join(" ")).toContain(w.slice(0, 20));
  });
});
