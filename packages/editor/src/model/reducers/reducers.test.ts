import { describe, expect, test } from "bun:test";
import {
  type Lesson,
  parseLesson,
  type ShapeElement,
  type SlideElement,
} from "@tj/domain/documents";
import { newLesson, newSlide, newText, uid } from "../factories";
import { unionRect } from "../geometry";
import * as r from "./index";

function shape(x: number, y: number, w = 100, h = 50): ShapeElement {
  return { id: uid(), type: "shape", shape: "rect", x, y, w, h };
}

/** A one-slide lesson with an empty first slide, as TeachDeck's store tests start. */
function blank(...els: SlideElement[]): { lesson: Lesson; slideId: string } {
  const lesson = newLesson("Test");
  const first = lesson.slides[0];
  if (!first) throw new Error("newLesson has a slide");
  first.elements = els;
  return { lesson, slideId: first.id };
}

const elements = (lesson: Lesson, slideId: string) =>
  lesson.slides.find((s) => s.id === slideId)?.elements ?? [];
const el = (lesson: Lesson, slideId: string, id: string) => {
  const found = elements(lesson, slideId).find((e) => e.id === id);
  if (!found) throw new Error(`no element ${id}`);
  return found;
};

describe("reducer contract", () => {
  test("a change stamps updatedAt, keeps version and stays a valid lesson", async () => {
    const { lesson } = blank();
    await new Promise((resolve) => setTimeout(resolve, 2));
    const next = r.setTitle(lesson, "Renamed");
    expect(next.title).toBe("Renamed");
    expect(next.updatedAt > lesson.updatedAt).toBe(true);
    expect(next.version).toBe(lesson.version);
    expect(parseLesson(next)).toEqual(next);
    expect(lesson.title).toBe("Test");
  });

  test("a no-op returns the same lesson object", () => {
    const { lesson, slideId } = blank();
    expect(r.updateElement(lesson, slideId, "missing", { x: 1 })).toBe(lesson);
    expect(r.deleteSlide(lesson, "missing")).toBe(lesson);
    expect(r.setFitVersion(lesson, lesson.fitVersion ?? 0)).toBe(lesson);
    expect(r.updateSlide(lesson, "missing", { notes: "x" })).toBe(lesson);
    expect(r.align(lesson, slideId, [], "left")).toBe(lesson);
  });

  test("silent reducers are marked and leave updatedAt alone", () => {
    const a = shape(0, 0);
    const { lesson, slideId } = blank(a);
    expect(r.isSilentReducer(r.setFitVersion)).toBe(true);
    expect(r.isSilentReducer(r.updateElementLayout)).toBe(true);
    expect(r.isSilentReducer(r.setTitle)).toBe(false);
    const next = r.updateElementLayout(lesson, slideId, a.id, { h: 80 });
    expect(el(next, slideId, a.id).h).toBe(80);
    expect(next.updatedAt).toBe(lesson.updatedAt);
    // under half a point is measurement jitter, not a change
    expect(r.updateElementLayout(lesson, slideId, a.id, { h: 50.3 })).toBe(lesson);
    const fitted = r.setFitVersion(lesson, 99);
    expect(fitted.fitVersion).toBe(99);
    expect(fitted.updatedAt).toBe(lesson.updatedAt);
  });

  test("editing one slide keeps the other slides' identity", () => {
    let lesson = newLesson("Three");
    lesson = r.addSlide(lesson, "content").lesson;
    lesson = r.addSlide(lesson, "content").lesson;
    const [s0, s1, s2] = lesson.slides;
    if (!s0 || !s1 || !s2) throw new Error("three slides");
    const next = r.setSlideNotes(lesson, s1.id, "hello");
    expect(next.slides[0]).toBe(s0);
    expect(next.slides[1]).not.toBe(s1);
    expect(next.slides[1]?.notes).toBe("hello");
    expect(next.slides[2]).toBe(s2);
  });
});

describe("lesson", () => {
  test("setTheme, setLessonMeta adds and removes keys", () => {
    const { lesson } = blank();
    expect(r.setTheme(lesson, "paper").themeId).toBe("paper");
    const withMeta = r.setLessonMeta(lesson, { subject: "Maths", yearGroup: "Year 4" });
    expect(withMeta.subject).toBe("Maths");
    expect(withMeta.yearGroup).toBe("Year 4");
    const cleared = r.setLessonMeta(withMeta, { subject: "", yearGroup: undefined });
    expect("subject" in cleared).toBe(false);
    expect("yearGroup" in cleared).toBe(false);
  });
});

describe("slides", () => {
  test("addSlide after the first: recipe elements, identity of the untouched slides", () => {
    let lesson = newLesson("Three");
    lesson = r.addSlide(lesson, "content").lesson;
    lesson = r.addSlide(lesson, "content").lesson;
    const [s0, s1, s2] = lesson.slides;
    if (!s0 || !s1 || !s2) throw new Error("three slides");
    const { lesson: next, id } = r.addSlide(lesson, "content", s0.id);
    expect(next.slides).toHaveLength(4);
    expect(next.slides[1]?.id).toBe(id);
    expect(next.slides[1]?.kind).toBe("content");
    expect(next.slides[1]?.elements).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "text" })]),
    );
    expect(next.slides[0]).toBe(s0);
    expect(next.slides[2]).toBe(s1);
    expect(next.slides[3]).toBe(s2);
  });

  test("addSlide without afterId appends; unknown afterId appends", () => {
    const { lesson, slideId } = blank();
    expect(r.addSlide(lesson, "content").lesson.slides[1]?.kind).toBe("content");
    expect(r.addSlide(lesson, "content", null).lesson.slides[1]?.kind).toBe("content");
    expect(r.addSlide(lesson, "content", "nope").lesson.slides[1]?.kind).toBe("content");
    expect(r.addSlide(lesson, "content", slideId).lesson.slides[0]?.id).toBe(slideId);
  });

  test("insertSlide and pasteSlide: a pasted slide is a clone with fresh ids", () => {
    const a = shape(0, 0);
    const { lesson, slideId } = blank(a);
    const extra = newSlide("content", lesson.themeId);
    const inserted = r.insertSlide(lesson, extra, slideId);
    expect(inserted.slides[1]).toBe(extra);
    const src = lesson.slides[0];
    if (!src) throw new Error("slide");
    const { lesson: pasted, id } = r.pasteSlide(lesson, src, slideId);
    expect(pasted.slides).toHaveLength(2);
    expect(id).not.toBe(slideId);
    expect(pasted.slides[1]?.id).toBe(id);
    expect(pasted.slides[1]?.elements[0]?.id).not.toBe(a.id);
  });

  test("duplicateSlide inserts after the source with fresh ids; unknown id is a no-op", () => {
    const a = shape(0, 0);
    const { lesson, slideId } = blank(a);
    const { lesson: next, id } = r.duplicateSlide(lesson, slideId);
    expect(id).toBeTruthy();
    expect(next.slides.map((s) => s.id)).toEqual([slideId, id as string]);
    expect(next.slides[1]?.elements[0]?.id).not.toBe(a.id);
    expect(next.slides[1]?.elements[0]?.x).toBe(0);
    expect(r.duplicateSlide(lesson, "nope")).toEqual({ lesson, id: null });
  });

  test("deleteSlide: unknown id no-op, last slide refused, otherwise removed", () => {
    const { lesson, slideId } = blank();
    expect(r.deleteSlide(lesson, "nope")).toBe(lesson);
    expect(r.deleteSlide(lesson, slideId)).toBe(lesson);
    const { lesson: two, id } = r.addSlide(lesson, "content");
    const one = r.deleteSlide(two, slideId);
    expect(one.slides.map((s) => s.id)).toEqual([id as string]);
  });

  test("moveSlide clamps the target index", () => {
    let lesson = newLesson("Three");
    lesson = r.addSlide(lesson, "content").lesson;
    lesson = r.addSlide(lesson, "content").lesson;
    const [i0 = "", i1 = "", i2 = ""] = lesson.slides.map((s) => s.id);
    expect(r.moveSlide(lesson, i0, 2).slides.map((s) => s.id)).toEqual([i1, i2, i0]);
    expect(r.moveSlide(lesson, i2, -5).slides.map((s) => s.id)).toEqual([i2, i0, i1]);
    expect(r.moveSlide(lesson, i0, 99).slides.map((s) => s.id)).toEqual([i1, i2, i0]);
    expect(r.moveSlide(lesson, "nope", 1)).toBe(lesson);
  });

  test("moveSlides lands a set at the insertion line in order; nudgeSlides steps it by one", () => {
    let lesson = newLesson("Four");
    for (let i = 0; i < 3; i++) lesson = r.addSlide(lesson, "content").lesson;
    const [a = "", b = "", c = "", d = ""] = lesson.slides.map((s) => s.id);
    const order = (l: typeof lesson) => l.slides.map((s) => s.id);
    // Slide 1 dropped below slide 3 (insertion index 3 in a four-slide deck).
    expect(order(r.moveSlides(lesson, [a], 3))).toEqual([b, c, a, d]);
    // Two picked slides keep their relative order and travel together.
    expect(order(r.moveSlides(lesson, [d, b], 0))).toEqual([b, d, a, c]);
    expect(order(r.moveSlides(lesson, [a, b], 4))).toEqual([c, d, a, b]);
    // Same place, unknown ids, nothing picked: the same object.
    expect(r.moveSlides(lesson, [a], 0)).toBe(lesson);
    expect(r.moveSlides(lesson, [a], 1)).toBe(lesson);
    expect(r.moveSlides(lesson, ["nope"], 2)).toBe(lesson);
    // Untouched slides keep their identity.
    expect(r.moveSlides(lesson, [a], 3).slides[0]).toBe(lesson.slides[1]);

    expect(order(r.nudgeSlides(lesson, [b], 1))).toEqual([a, c, b, d]);
    expect(order(r.nudgeSlides(lesson, [b], -1))).toEqual([b, a, c, d]);
    expect(order(r.nudgeSlides(lesson, [c, d], 1))).toEqual([a, b, c, d]);
    expect(r.nudgeSlides(lesson, [a], -1)).toBe(lesson);
    expect(r.nudgeSlides(lesson, [], 1)).toBe(lesson);
  });

  test("updateSlide, setSlideBackground, setSlideNotes add and remove", () => {
    const { lesson, slideId } = blank();
    expect(r.updateSlide(lesson, slideId, { transition: "fade" }).slides[0]?.transition).toBe(
      "fade",
    );
    const bg = r.setSlideBackground(lesson, slideId, { color: "#fff" });
    expect(bg.slides[0]?.background).toEqual({ color: "#fff" });
    expect("background" in (r.setSlideBackground(bg, slideId, undefined).slides[0] ?? {})).toBe(
      false,
    );
    const notes = r.setSlideNotes(lesson, slideId, "Remember the diagram");
    expect(notes.slides[0]?.notes).toBe("Remember the diagram");
    expect("notes" in (r.setSlideNotes(notes, slideId, "   ").slides[0] ?? {})).toBe(false);
  });
});

describe("question", () => {
  test("setQuestion sets and clears; setExplanation writes the right field per type", () => {
    const { lesson, slideId } = blank();
    const tf = r.setQuestion(lesson, slideId, { type: "true-false", correct: true });
    expect(tf.slides[0]?.question?.type).toBe("true-false");
    const why = r.setExplanation(tf, slideId, " Because water evaporates ");
    expect(why.slides[0]?.question).toMatchObject({ explanation: "Because water evaporates" });
    const cleared = r.setExplanation(why, slideId, "");
    expect("explanation" in (cleared.slides[0]?.question ?? {})).toBe(false);

    const open = r.setQuestion(lesson, slideId, { type: "open-response" });
    const model = r.setExplanation(open, slideId, "A model answer");
    expect(model.slides[0]?.question).toMatchObject({ modelAnswer: "A model answer" });

    expect(r.setExplanation(lesson, slideId, "no question")).toBe(lesson);
    expect("question" in (r.setQuestion(tf, slideId, undefined).slides[0] ?? {})).toBe(false);
  });
});

describe("elements", () => {
  test("addElement / addElements append in order", () => {
    const a = shape(0, 0);
    const b = shape(1, 1);
    const c = shape(2, 2);
    const { lesson, slideId } = blank();
    const one = r.addElement(lesson, a, slideId);
    const three = r.addElements(one, [b, c], slideId);
    expect(elements(three, slideId).map((e) => e.id)).toEqual([a.id, b.id, c.id]);
    expect(r.addElement(lesson, a, "nope")).toBe(lesson);
  });

  test("updateElement with a patch, with a mutator, and inside a group", () => {
    const t = newText("body", "hi", { x: 0, y: 0, w: 100, h: 40 });
    const a = shape(0, 0);
    const b = shape(200, 0);
    const { lesson, slideId } = blank(t, a, b);
    const patched = r.updateElement(lesson, slideId, t.id, { x: 50 });
    expect(el(patched, slideId, t.id).x).toBe(50);
    const mutated = r.updateElement<typeof t>(lesson, slideId, t.id, (e) => {
      e.style.fontSize = 30;
    });
    expect((el(mutated, slideId, t.id) as typeof t).style.fontSize).toBe(30);
    const { lesson: grouped, id: g } = r.group(lesson, slideId, [a.id, b.id]);
    const inner = r.updateElement(grouped, slideId, a.id, { locked: true });
    const grp = el(inner, slideId, g as string);
    expect(grp.type === "group" && grp.children[0]?.locked).toBe(true);
  });

  test("updateElements patches every id it finds", () => {
    const a = shape(0, 0);
    const b = shape(1, 1);
    const { lesson, slideId } = blank(a, b);
    const next = r.updateElements(lesson, slideId, [a.id, b.id, "nope"], { opacity: 0.5 });
    expect(elements(next, slideId).map((e) => e.opacity)).toEqual([0.5, 0.5]);
  });

  test("transformElements moves, rotates and scales about the selection centre; locked skipped", () => {
    const a = shape(100, 100, 100, 100);
    const b = shape(300, 100, 100, 100);
    const { lesson, slideId } = blank(a, b);
    const scaled = r.transformElements(lesson, slideId, [a.id, b.id], { scale: 2 });
    expect(el(scaled, slideId, a.id).x).toBe(-50);
    expect(el(scaled, slideId, a.id).w).toBe(200);
    expect(el(scaled, slideId, b.id).x).toBe(350);
    const moved = r.transformElements(lesson, slideId, [a.id], { dx: 5, dy: -5, rotation: 370 });
    expect(el(moved, slideId, a.id)).toMatchObject({ x: 105, y: 95, rotation: 10 });
    const locked = r.updateElement(lesson, slideId, a.id, { locked: true });
    expect(r.transformElements(locked, slideId, [a.id], { dx: 5 })).toBe(locked);
  });

  test("deleteElements removes top-level ids and untouched groups keep identity", () => {
    const a = shape(0, 0);
    const b = shape(1, 1);
    const c = shape(2, 2);
    const { lesson, slideId } = blank(a, b, c);
    const { lesson: grouped } = r.group(lesson, slideId, [b.id, c.id]);
    const grp = elements(grouped, slideId).find((e) => e.type === "group");
    const next = r.deleteElements(grouped, slideId, [a.id]);
    expect(elements(next, slideId)).toHaveLength(1);
    expect(elements(next, slideId)[0]).toBe(grp);
    expect(r.deleteElements(lesson, slideId, ["nope"])).toBe(lesson);
  });

  test("deleting all children removes the group; one survivor is unwrapped; several re-fit", () => {
    const a = shape(100, 100);
    const b = shape(300, 200);
    const { lesson, slideId } = blank(a, b);
    const { lesson: grouped, id: g } = r.group(lesson, slideId, [a.id, b.id]);
    const survivor = r.deleteElements(grouped, slideId, [a.id]);
    expect(elements(survivor, slideId).map((e) => e.id)).toEqual([b.id]);
    expect(el(survivor, slideId, b.id)).toMatchObject({ x: 300, y: 200 });

    const gone = r.deleteElements(grouped, slideId, [a.id, b.id]);
    expect(elements(gone, slideId)).toHaveLength(0);
    expect(g).toBeTruthy();

    const c = shape(0, 0);
    const d = shape(200, 0);
    const e = shape(400, 0);
    const three = blank(c, d, e);
    const { lesson: g3, id: gid } = r.group(three.lesson, three.slideId, [c.id, d.id, e.id]);
    const refit = r.deleteElements(g3, three.slideId, [c.id]);
    const grp = el(refit, three.slideId, gid as string);
    expect(grp).toMatchObject({ x: 200, y: 0, w: 300, h: 50 });
    expect(grp.type === "group" && grp.children.map((ch) => ch.x)).toEqual([0, 200]);
  });

  test("duplicateElements: fresh ids offset by 16, appended on top", () => {
    const a = shape(10, 10);
    const b = shape(50, 50);
    const { lesson, slideId } = blank(a, b);
    const { lesson: next, ids } = r.duplicateElements(lesson, slideId, [a.id]);
    expect(ids).toHaveLength(1);
    expect(ids[0]).not.toBe(a.id);
    expect(elements(next, slideId).map((e) => e.id)).toEqual([a.id, b.id, ids[0] as string]);
    expect(el(next, slideId, ids[0] as string)).toMatchObject({ x: 26, y: 26 });
    expect(r.duplicateElements(lesson, slideId, [a.id], 40).lesson.slides[0]?.elements[2]?.x).toBe(
      50,
    );
    expect(r.duplicateElements(lesson, slideId, ["nope"])).toEqual({ lesson, ids: [] });
  });

  test("pasteElements offsets each paste further when the copies become the clipboard", () => {
    const a = shape(10, 10);
    const { lesson, slideId } = blank(a);
    const first = r.pasteElements(lesson, [a], slideId);
    const second = r.pasteElements(first.lesson, first.copies, slideId);
    expect(el(first.lesson, slideId, first.ids[0] as string).x).toBe(26);
    expect(el(second.lesson, slideId, second.ids[0] as string).x).toBe(42);
    expect(r.pasteElements(lesson, [], slideId)).toEqual({ lesson, ids: [], copies: [] });
  });
});

describe("arrange", () => {
  test("reorder: front/back keep relative order, forward with multi-select moves both one step", () => {
    const a = shape(0, 0);
    const b = shape(0, 0);
    const c = shape(0, 0);
    const d = shape(0, 0);
    const { lesson, slideId } = blank(a, b, c, d);
    const ids = (l: Lesson) => elements(l, slideId).map((e) => e.id);
    expect(ids(r.reorder(lesson, slideId, [a.id, b.id], "forward"))).toEqual([
      c.id,
      a.id,
      b.id,
      d.id,
    ]);
    expect(ids(r.reorder(lesson, slideId, [d.id], "back"))[0]).toBe(d.id);
    expect(ids(r.reorder(lesson, slideId, [a.id, c.id], "front"))).toEqual([
      b.id,
      d.id,
      a.id,
      c.id,
    ]);
    expect(ids(r.reorder(lesson, slideId, [d.id], "backward"))).toEqual([a.id, b.id, d.id, c.id]);
    expect(r.reorder(lesson, slideId, ["nope"], "front")).toBe(lesson);
  });

  test("align: a single element uses the slide, several use their union", () => {
    const a = shape(100, 100, 100, 50);
    const b = shape(500, 300, 100, 50);
    const { lesson, slideId } = blank(a, b);
    expect(el(r.align(lesson, slideId, [a.id], "hcenter"), slideId, a.id).x).toBe(430);
    const left = r.align(lesson, slideId, [a.id, b.id], "left");
    expect(el(left, slideId, a.id).x).toBe(100);
    expect(el(left, slideId, b.id).x).toBe(100);
    const centred = r.align(lesson, slideId, [a.id, b.id], "hcenter");
    const union = unionRect([a, b].map((e) => ({ x: e.x, y: e.y, w: e.w, h: e.h })));
    const mid = union.x + union.w / 2;
    for (const id of [a.id, b.id]) {
      const e = el(centred, slideId, id);
      expect(e.x + e.w / 2).toBe(mid);
    }
    const bottom = r.align(lesson, slideId, [a.id, b.id], "bottom");
    expect(el(bottom, slideId, a.id).y).toBe(300);
    expect(el(r.align(lesson, slideId, [a.id], "vcenter"), slideId, a.id).y).toBe(245);
    expect(el(r.align(lesson, slideId, [a.id], "right"), slideId, a.id).x).toBe(860);
    expect(el(r.align(lesson, slideId, [a.id], "top"), slideId, a.id).y).toBe(0);
  });

  test("distribute: equal gaps, outer two unchanged, fewer than three is a no-op", () => {
    const a = shape(0, 0, 100, 50);
    const b = shape(150, 0, 100, 50);
    const c = shape(500, 0, 100, 50);
    const { lesson, slideId } = blank(a, b, c);
    const next = r.distribute(lesson, slideId, [a.id, b.id, c.id], "h");
    expect(el(next, slideId, a.id).x).toBe(0);
    expect(el(next, slideId, c.id).x).toBe(500);
    expect(el(next, slideId, b.id).x).toBe(250);
    expect(r.distribute(lesson, slideId, [a.id, b.id], "h")).toBe(lesson);
    const p = shape(0, 0, 10, 10);
    const q = shape(0, 100, 10, 10);
    const m = shape(0, 20, 10, 10);
    const column = blank(p, q, m);
    const v = r.distribute(column.lesson, column.slideId, [p.id, q.id, m.id], "v");
    expect(el(v, column.slideId, m.id).y).toBe(50);
    expect(el(v, column.slideId, q.id).y).toBe(100);
  });

  test("group/ungroup round-trips positions and ids; group has the union bounds", () => {
    const a = shape(100, 100);
    const b = shape(300, 200);
    const { lesson, slideId } = blank(a, b);
    const { lesson: grouped, id: g } = r.group(lesson, slideId, [a.id, b.id]);
    expect(g).toBeTruthy();
    const grp = el(grouped, slideId, g as string);
    expect(grp).toMatchObject({ type: "group", x: 100, y: 100, w: 300, h: 150 });
    expect(elements(grouped, slideId)).toHaveLength(1);
    const { lesson: back, ids } = r.ungroup(grouped, slideId, g as string);
    expect(ids).toEqual([a.id, b.id]);
    expect(elements(back, slideId)).toEqual([a, b]);
  });

  test("group keeps an existing group out of the new one; fewer than two is a no-op", () => {
    const a = shape(0, 0);
    const b = shape(200, 0);
    const c = shape(400, 0);
    const d = shape(600, 0);
    const { lesson, slideId } = blank(a, b, c, d);
    const { lesson: one, id: g1 } = r.group(lesson, slideId, [a.id, b.id]);
    const { lesson: two, id: g2 } = r.group(one, slideId, [c.id, d.id, g1 as string]);
    expect(g2).toBeTruthy();
    expect(elements(two, slideId).map((e) => e.id)).toContain(g1 as string);
    expect(elements(two, slideId)).toHaveLength(2);
    expect(r.group(lesson, slideId, [a.id])).toEqual({ lesson, id: null });
    expect(r.group(one, slideId, [g1 as string, c.id])).toEqual({ lesson: one, id: null });
    expect(r.ungroup(lesson, slideId, a.id)).toEqual({ lesson, ids: [] });
  });
});
