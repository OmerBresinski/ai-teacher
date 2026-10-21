import { describe, expect, test } from "bun:test";
import type { GroupElement, LayoutRef, Lesson, TextElement } from "@tj/domain/documents";
import { snapToScale, steppedDown, unfixed } from "@tj/slides";
import * as kit from "@tj/slides/relayout";
import { docFromText, newLesson } from "../model/factories";
import { setLayoutKit } from "../model/layout-kit";
import * as r from "../model/reducers";
import { syncLayoutGroups as settle } from "../model/reducers/layout-sync";
import { getTheme, renderTheme } from "../model/themes";
import { relayLayouts } from "./retheme";

/*
 * Ruling 21 A (TEACH-215 part e). A saved hinge laid before the gold sizes is re-laid at them when
 * the teacher switches theme (`relayLayouts`) or edits its words (`syncLayoutGroups`): intended,
 * the layout owns its type. A size or preset the teacher (or Tidy, or the fitter) sets lets the
 * layout's fixed size go (`unfixed`), so it never re-arms.
 */
const ref: LayoutRef = {
  template: "hinge",
  input: {
    heading: "Which is a solid?",
    options: ["Ice", "Steam", "Water", "Air"],
    correct: 0,
  },
};

function saved(themeId: string): Lesson {
  const lesson = { ...newLesson("Matter"), themeId, ageBand: "ks2" } as Lesson;
  const slide = lesson.slides[0];
  if (!slide) throw new Error("newLesson has a slide");
  const theme = renderTheme(lesson);
  const g = kit.layoutGroup(ref, theme, kit.stageOf(theme, lesson.ageBand), "g1");
  // As a lesson saved before part e stored it: a smaller scale size, no fixedSize.
  g.children = g.children.map((c) =>
    c.type === "text" && c.style.fixedSize
      ? { ...c, style: { ...unfixed(c.style), fontSize: 24 } }
      : c,
  );
  slide.elements = [g];
  return lesson;
}
const texts = (l: Lesson) => {
  const g = l.slides[0]?.elements[0] as GroupElement | undefined;
  const own = (g?.children ?? []).filter(
    (c): c is TextElement => c.type === "text" && c.name === "Option text",
  );
  return own.map((c) => [c.style.fontSize, c.style.fixedSize]);
};
const fresh = (l: Lesson) => {
  const theme = renderTheme(l);
  const g = kit.layoutGroup(ref, theme, kit.stageOf(theme, l.ageBand), "g1");
  return texts({ ...l, slides: [{ ...(l.slides[0] as Lesson["slides"][number]), elements: [g] }] });
};

describe("saved lessons take the gold sizes when re-laid", () => {
  test("a theme switch re-lays a saved hinge at the new theme's gold sizes, fixed", () => {
    const before = saved("paper");
    expect(texts(before).every(([s, f]) => s === 24 && !f)).toBe(true);
    const switched = { ...before, themeId: "exam-hall" };
    const after = relayLayouts(switched, kit, before);
    expect(texts(after)).toEqual(fresh(switched));
    expect(texts(after).every(([s, f]) => (s as number) > 24 && f === true)).toBe(true);
  });

  test("typing in an option re-lays the saved hinge at the gold sizes", () => {
    setLayoutKit(kit);
    const before = saved("paper");
    const group = before.slides[0]?.elements[0] as GroupElement | undefined;
    const id = group?.children.find((c) => c.name === "Option text")?.id ?? "";
    const out = settle(
      before,
      r.updateElement(before, before.slides[0]?.id as string, id, { doc: docFromText("Ice cube") }),
    );
    expect(texts(out).every(([, f]) => f === true)).toBe(true);
    expect(texts(out).some(([s]) => (s as number) > 24)).toBe(true);
    setLayoutKit(null);
  });
});

describe("a size set outside the layout lets fixedSize go", () => {
  const theme = getTheme("paper", "ks2");
  const slide = (style: TextElement["style"]) => ({
    elements: [
      { id: "t", type: "text", x: 0, y: 0, w: 400, h: 60, doc: docFromText("Ice"), style },
    ],
  });
  const fixed = { preset: "body" as const, fontSize: 37.3, fixedSize: true };
  test("a layout's fixed size is neither snapped nor counted as a step down", () => {
    expect(fontOf(snapToScale(slide(fixed), theme))).toBe(37.3);
    expect(steppedDown(slide({ ...fixed, fontSize: 20 }), theme)).toEqual([]);
  });
  test("the teacher's size (unfixed) is snapped to the scale again; a preset change too", () => {
    const teacher = { ...unfixed(fixed), fontSize: 37.3 };
    expect("fixedSize" in teacher).toBe(false);
    expect(fontOf(snapToScale(slide(teacher), theme))).not.toBe(37.3);
    const preset = { ...unfixed(fixed), preset: "heading" as const, fontSize: undefined };
    expect("fixedSize" in preset).toBe(false);
    expect(steppedDown(slide({ ...unfixed(fixed), fontSize: 20 }), theme)).not.toEqual([]);
  });
});
const fontOf = (s: { elements: readonly unknown[] }) =>
  (s.elements[0] as TextElement).style.fontSize;
