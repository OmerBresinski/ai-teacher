import { describe, expect, mock, test } from "bun:test";
import type { FakeCall } from "@tj/ai/testing";
import type { Lesson, Slide } from "@tj/domain/documents";
import { PLACEHOLDER_IMAGE } from "@tj/slides/layouts";
import { labAi, romansLesson } from "../planner/testing";
import { initialState, type RecordedDeps, recordingDeps } from "../testing";
import { writerRoute } from "../writer/ai-services";
import * as stage from "../writer/stage";
import { checkedWriterObjectives } from "./objectives";

/*
 * TEACH-247 part av: a job cancelled after its editable deck (which holds picture frames open)
 * saves the deck again with those frames laid out without them, after the job's signal aborted.
 * The writer is stood in for: it hands over the editable deck, then the job is cancelled.
 */
const controller = new AbortController();
let heldDeck: stage.WriterSlide[] = [];
let plainDeck: stage.WriterSlide[] = [];
// bun's module mock is process-wide: other files in the same run get the real writer.
const realRunWriter = stage.runWriter;
let standIn = false;
mock.module("../writer/stage", () => ({
  ...stage,
  runWriter: async (run: Parameters<typeof stage.runWriter>[0]) => {
    if (!standIn) return realRunWriter(run);
    await run.onEditable?.(heldDeck, plainDeck);
    controller.abort("cancelled");
    // A cancelled job's next model call rejects with the abort, as `@tj/ai` does.
    throw new DOMException("The operation was aborted.", "AbortError");
  },
}));
const { write } = await import("./write");

const frames = (l: Lesson | undefined) =>
  (l?.slides ?? []).flatMap((s) =>
    s.elements.filter(
      (e) => e.type === "image" && (e as { src?: string }).src === PLACEHOLDER_IMAGE,
    ),
  ).length;

describe("a job cancelled after the editable deck", () => {
  test("saves the deck again without its held frames, after the signal aborted", async () => {
    const ai = labAi({
      route: writerRoute,
      extra: (call: FakeCall) =>
        (call.context?.promptVersion ?? "").endsWith("/objectives")
          ? JSON.stringify({
              objectives: [
                "Describe who invaded Britain in AD 43.",
                "Explain why the Romans invaded Britain.",
                "Evaluate how far the invasion changed Britain.",
              ],
            })
          : undefined,
    });
    const planned = await checkedWriterObjectives(initialState(romansLesson()), recordingDeps(ai));
    const slides = planned.lesson.slides.map((s: Slide) => ({ ...s, notes: s.notes ?? "" }));
    const frame = {
      id: "held-pic",
      type: "image",
      x: 500,
      y: 100,
      w: 400,
      h: 300,
      src: PLACEHOLDER_IMAGE,
      alt: "",
    };
    plainDeck = slides as unknown as stage.WriterSlide[];
    heldDeck = slides.map((s, i) =>
      i === slides.length - 1 ? { ...s, elements: [...s.elements, frame] } : s,
    ) as unknown as stage.WriterSlide[];
    const base = recordingDeps(ai);
    const abortedAtSave: boolean[] = [];
    const deps = {
      ...base,
      signal: controller.signal,
      persist: async (l: Lesson) => {
        abortedAtSave.push(controller.signal.aborted);
        return base.persist(l);
      },
    } as RecordedDeps;
    standIn = true;
    try {
      await expect(write(planned, deps)).rejects.toThrow("aborted");
    } finally {
      standIn = false;
    }
    const saves = base.persisted.map((p) => p.lesson as Lesson);
    // The editable save held the frame; the save after the cancel lays the deck without it.
    expect(frames(saves.at(-2))).toBe(1);
    expect(frames(saves.at(-1))).toBe(0);
    expect(abortedAtSave.at(-1)).toBe(true);
    expect(saves.at(-1)?.slides.map((s) => s.id)).toEqual(saves.at(-2)?.slides.map((s) => s.id));
  });
});
