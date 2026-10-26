import { describe, expect, test } from "bun:test";
import type { Lesson, Slide, SlideElement } from "@tj/domain/documents";
import { mergeJobLesson, withoutEditorCopies } from "@tj/domain/documents";
import { imageElement, lesson as plainLesson, textElement } from "@tj/domain/documents/fixtures";
import { markTeacherEdited } from "./LessonEditor";

/*
 * TEACH-251 part p (ADR 0037): the editor marks the slides a teacher's step changed, and only
 * those; the job's merge keeps a marked slide whole and takes its own copy of any other.
 */

const generating = (slides: Slide[]): Lesson => ({
  ...plainLesson(),
  slides,
  generation: {
    jobId: "job",
    stage: "planned",
    startedAt: "2026-10-26T04:00:00.000Z",
    promptVersions: {},
    usage: { calls: 1, inputTokens: 1, outputTokens: 1, costUsd: 0 },
    findings: [],
    slideStates: { a: "done", b: "done" },
  },
});
const text = (id: string, extra: Partial<SlideElement> = {}) =>
  textElement(id, "Water evaporates.", {
    style: { preset: "body", color: "#111111", fontSize: 32 },
    ...extra,
  } as Partial<SlideElement>);
const slideOf = (id: string, elements: SlideElement[]): Slide =>
  ({ id, kind: "content", elements }) as Slide;
const withSlide = (l: Lesson, s: Slide): Lesson => ({
  ...l,
  slides: l.slides.map((x) => (x.id === s.id ? s : x)),
});
const get = (l: Lesson, id: string) => l.slides.find((s) => s.id === id) as Slide;

describe("markTeacherEdited", () => {
  const base = generating([slideOf("a", [text("a-t")]), slideOf("b", [text("b-t")])]);

  test("a move, resize, recolour or font size marks only the slide it changed", () => {
    const moved = text("a-t", { x: 10, y: 300, w: 400, h: 90 });
    const recoloured = text("a-t", {
      style: { preset: "body", color: "#c0392b", fontSize: 40 },
    } as Partial<SlideElement>);
    for (const el of [moved, recoloured]) {
      const out = markTeacherEdited(base, withSlide(base, slideOf("a", [el])));
      expect(get(out, "a").teacherEdited).toBe(true);
      expect(get(out, "b").teacherEdited).toBeUndefined();
    }
  });

  test("a step that changes the theme marks nothing; a lesson no job wrote is never marked", () => {
    const rethemed = {
      ...withSlide(base, slideOf("a", [text("a-t", { x: 1 })])),
      themeId: "crayon",
    };
    expect(markTeacherEdited(base, rethemed)).toBe(rethemed);
    const { generation: _g, ...plain } = base;
    const edited = withSlide(plain as Lesson, slideOf("a", [text("a-t", { x: 1 })]));
    expect(markTeacherEdited(plain as Lesson, edited)).toBe(edited);
  });

  test("an edit in the same step as a theme pick is marked; the redraw of other slides is not", () => {
    const step = {
      ...base,
      themeId: "crayon",
      slides: [
        slideOf("a", [textElement("a-t", "Puddles dry up.")]),
        slideOf("b", [
          text("b-t", {
            x: 3,
            style: { preset: "body", color: "#ff0000", fontSize: 20 },
          } as Partial<SlideElement>),
        ]),
      ],
    };
    const out = markTeacherEdited(base, step);
    expect(get(out, "a").teacherEdited).toBe(true);
    expect(get(out, "b").teacherEdited).toBeUndefined();
  });

  test("an unchanged copy is returned as it is", () => {
    const same = { ...base, slides: base.slides.map((s) => ({ ...s })) };
    expect(markTeacherEdited(base, same)).toBe(same);
  });
});

describe("a marked slide survives a late picture; an unmarked one takes it", () => {
  test("teacher's geometry and styles stay, the picture lands; the job-end copy then merges again", () => {
    const ph = imageElement("a-pic", { src: "" });
    const jobBase = generating([
      slideOf("a", [text("a-t"), ph]),
      slideOf("b", [text("b-t"), ph && { ...ph, id: "b-pic" }]),
    ]);
    // The editor's copy: slide a moved and recoloured by the teacher (marked), slide b only
    // repainted by the editor (unmarked).
    const teacherText = text("a-t", {
      x: 12,
      y: 280,
      style: { preset: "body", color: "#c0392b", fontSize: 40 },
    } as Partial<SlideElement>);
    const mine = markTeacherEdited(jobBase, withSlide(jobBase, slideOf("a", [teacherText, ph])));
    const repainted = withSlide(
      mine,
      slideOf("b", [
        text("b-t", { style: { preset: "body", color: "#0000ff" } } as Partial<SlideElement>),
        { ...ph, id: "b-pic" },
      ]),
    );
    // The job swaps both placeholders for pictures.
    const theirs = generating([
      slideOf("a", [text("a-t"), imageElement("a-photo", { src: "/files/a.jpg" })]),
      slideOf("b", [text("b-t"), imageElement("b-photo", { src: "/files/b.jpg" })]),
    ]);
    const merged = mergeJobLesson(jobBase, withoutEditorCopies(repainted, jobBase), theirs);
    expect(get(merged, "a").elements.map((e) => e.id)).toEqual(["a-t", "a-photo"]);
    expect(get(merged, "a").elements[0]).toEqual(teacherText);
    expect(get(merged, "a").teacherEdited).toBe(true);
    expect(get(merged, "b")).toEqual(get(theirs, "b"));
    // The editor's job-end save is that merged copy (the row then); a later write of the job
    // (a late diagram on b) still lands, and slide a stays the teacher's.
    const late = withSlide(
      theirs,
      slideOf("b", [
        text("b-t"),
        imageElement("b-photo", { src: "/files/b.jpg" }),
        imageElement("b-fig", { src: "/files/f.svg" }),
      ]),
    );
    const after = mergeJobLesson(theirs, merged, late);
    expect(get(after, "b").elements.map((e) => e.id)).toEqual(["b-t", "b-photo", "b-fig"]);
    expect(get(after, "a").elements[0]).toEqual(teacherText);
  });
});
