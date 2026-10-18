import { describe, expect, it } from "bun:test";
import type { Lesson, Slide, SlideElement } from "@tj/domain/documents";
import { creditedLesson } from "@tj/domain/documents/fixtures";
import { dimGround, dimInk, surfaceStyle } from "@tj/slides/surfaces";
import { layoutTemplate } from "@tj/slides/templates";
import { atKeyStage, getTheme } from "@tj/slides/themes";
import JSZip from "jszip";
import { choiceMarks, choiceText } from "../slide/elements/choice";
import { hingeFade } from "../slide/elements/HingeMarks";
import { buildSlidePlan, exportLessonPptx, hexagonAdj } from "./pptx";

/*
 * TEACH-256 part b: the hinge reveals in one click, so PowerPoint gets one more build slide: the
 * right card ringed and ticked in `verdict-right`, its key in `key:right`, the others washed.
 * Cards and keys are rounded rectangles (own corners), the tick an ellipse.
 */
async function hingeDeck(themeId: string) {
  const theme = atKeyStage(getTheme(themeId, null), "ks2");
  const r = layoutTemplate(
    {
      template: "hinge",
      heading: "Which of these metals is magnetic?",
      options: ["Copper", "Iron", "Aluminium", "All of them"],
      correct: 2,
    },
    theme,
    "ks2",
  );
  const slide = {
    id: "s1",
    kind: r.slide.kind,
    elements: r.slide.elements,
    question: r.slide.question,
  };
  const lesson = { ...creditedLesson(), themeId, slides: [slide] } as never as Lesson;
  const zip = await JSZip.loadAsync(await (await exportLessonPptx(lesson, theme)).arrayBuffer());
  const xml = async (n: number) =>
    (await zip.file(`ppt/slides/slide${n}.xml`)?.async("string")) ?? "";
  return {
    lesson,
    theme,
    ask: await xml(1),
    reveal: await xml(2),
    third: zip.file("ppt/slides/slide3.xml"),
  };
}

describe("PPTX hinge reveal", () => {
  it("one build slide for the one-click reveal", async () => {
    const { lesson, third } = await hingeDeck("paper");
    expect(buildSlidePlan(lesson).map((b) => b.step)).toEqual([0, 1]);
    expect(third).toBeNull();
  }, 30_000);

  for (const id of ["paper", "dark-slate", "dark-ember"])
    it(`${id}: the reveal slide adds ring, key and tick in the theme's roles; the ask slide has none`, async () => {
      const { ask, reveal, theme } = await hingeDeck(id);
      const right = surfaceStyle(theme, "verdict-right").fill.slice(1).toUpperCase();
      const key = surfaceStyle(theme, "key", "right").fill.slice(1).toUpperCase();
      expect(ask).not.toContain(`val="${right}"`);
      expect(reveal).toContain(`val="${right}"`);
      expect(reveal).toContain(`val="${key}"`);
      const geoms = (x: string) => [...x.matchAll(/<a:prstGeom prst="(\w+)"/g)].map((m) => m[1]);
      expect(geoms(reveal).filter((g) => g === "ellipse").length).toBe(
        geoms(ask).filter((g) => g === "ellipse").length + 1,
      );
      expect(reveal).not.toContain("Reveal wash");
      expect(reveal).not.toContain("<a:alpha");
    }, 30_000);

  /*
   * Part d (ruling 258): each wrong card is redrawn opaque with its words in the dim tone; the right
   * card's words keep their ink. Part i (TEACH-215): that card is the gold's `.34` fade over the
   * stage (`hingeFade`), drawn as plain colours: PowerPoint gets the faded state as its build slide. Read per card from the shapes PowerPoint draws: the
   * last shape drawn at a card's place is the one a pupil sees.
   */
  for (const id of ["paper", "dark-slate", "dark-ember"])
    it(`${id}: each wrong card's words are dim on the ground, the right card's keep their ink`, async () => {
      const { ask, reveal, theme, lesson } = await hingeDeck(id);
      const slide = lesson.slides[0] as Slide;
      const dimOf = (cardId: string) =>
        hex(hingeFade(slide, theme, cardId)?.words ?? dimInk(theme));
      const groundOf = (cardId: string) =>
        hex(hingeFade(slide, theme, cardId)?.ground ?? dimGround(theme));
      const wrongIds = choiceMarks(slide, true, Number.POSITIVE_INFINITY)
        .filter((m) => m.state === "dim")
        .map((m) => m.id);
      const dims = new Set(wrongIds.map(dimOf));
      const grounds = new Set(wrongIds.map(groundOf));
      const words = new Map(
        slide.elements.filter((e) => e.type === "text").map((e) => [e, choiceText(slide, e.id)]),
      );
      const drawn = shapes(reveal);
      const marks = choiceMarks(slide, true, Number.POSITIVE_INFINITY);
      expect(marks.filter((m) => m.state === "dim")).toHaveLength(3);
      for (const { id: cardId, state } of marks) {
        const card = slide.elements.find((e) => e.id === cardId) as SlideElement;
        const [word] = [...words].find(([e]) => within(e, card)) ?? [];
        const text = word ? (words.get(word) as string) : "";
        expect(text.length).toBeGreaterThan(0);
        const asked = shapes(ask).filter((s) => s.text === text);
        const shown = drawn.filter((s) => s.text === text);
        expect(asked).toHaveLength(1);
        const dim = dimOf(cardId);
        const ground = groundOf(cardId);
        expect(asked[0]?.runs.some((c) => dims.has(c))).toBe(false);
        const top = shown.at(-1);
        const atCard = drawn.filter((s) => s.x === emu(card.x) && s.y === emu(card.y) && !s.text);
        if (state === "dim") {
          // Drawn twice: the original, then the dim redraw over it on an opaque ground card.
          expect(shown).toHaveLength(2);
          expect(top?.runs.length).toBeGreaterThan(0);
          expect(top?.runs.every((c) => c === dim)).toBe(true);
          expect(atCard.at(-1)?.fill).toBe(ground);
          expect(drawn.indexOf(atCard.at(-1) as Sp)).toBeGreaterThan(-1);
          expect(drawn.indexOf(atCard.at(-1) as Sp)).toBeLessThan(drawn.indexOf(top as Sp));
        } else {
          expect(shown).toHaveLength(1);
          expect(top?.runs.length).toBeGreaterThan(0);
          expect(top?.runs.some((c) => dims.has(c))).toBe(false);
          // Never redrawn faded (a dark card on its own-coloured stage fades to itself: skip that).
          const own = card.type === "shape" && card.fill ? hex(card.fill) : "";
          expect(atCard.some((s) => s.fill && s.fill !== own && grounds.has(s.fill))).toBe(false);
        }
      }
    }, 30_000);

  it("a wrong card a teacher made see-through exports without throwing, its dim words on the ground", async () => {
    const theme = atKeyStage(getTheme("paper", null), "ks2");
    const { lesson } = await hingeDeck("paper");
    const slide = lesson.slides[0] as Slide;
    const [wrong] = choiceMarks(slide, true, Number.POSITIVE_INFINITY).filter(
      (m) => m.state === "dim",
    );
    const card = slide.elements.find((e) => e.id === wrong?.id) as SlideElement;
    const clear = {
      ...lesson,
      slides: [
        {
          ...slide,
          elements: slide.elements.map((e) =>
            e.id === card.id && e.type === "shape" ? { ...e, fill: "transparent" } : e,
          ),
        },
      ],
    } as Lesson;
    const zip = await JSZip.loadAsync(await (await exportLessonPptx(clear, theme)).arrayBuffer());
    const reveal = (await zip.file("ppt/slides/slide2.xml")?.async("string")) ?? "";
    const atCard = shapes(reveal).filter(
      (s) => s.x === emu(card.x) && s.y === emu(card.y) && !s.text,
    );
    expect(atCard.at(-1)?.fill).toBe(hex(dimGround(theme)));
  }, 30_000);
});

type Sp = { x: number; y: number; text: string; fill?: string; runs: string[] };
const hex = (c: string) => c.slice(1, 7).toUpperCase();
const emu = (pt: number) => Math.round(pt * 12700);
const within = (e: SlideElement, card: SlideElement) =>
  e.x >= card.x && e.y >= card.y && e.x + e.w <= card.x + card.w && e.y + e.h <= card.y + card.h;
/** The slide's shapes in drawing order: place, words, shape fill and each run's colour. */
function shapes(xml: string): Sp[] {
  return [...xml.matchAll(/<p:sp>([\s\S]*?)<\/p:sp>/g)].map(([, sp = ""]) => {
    const off = /<a:off x="(\d+)" y="(\d+)"/.exec(sp);
    const spPr = /<p:spPr>([\s\S]*?)<\/p:spPr>/.exec(sp)?.[1] ?? "";
    const fill = /^(?:(?!<a:ln)[\s\S])*?<a:solidFill><a:srgbClr val="(\w+)"/.exec(spPr)?.[1];
    const runs = [...sp.matchAll(/<a:r>([\s\S]*?)<\/a:r>/g)];
    return {
      x: Number(off?.[1]),
      y: Number(off?.[2]),
      text: runs.map((r) => /<a:t>([^<]*)/.exec(r[1] ?? "")?.[1] ?? "").join(""),
      fill,
      runs: runs.flatMap((r) => /<a:srgbClr val="(\w+)"/.exec(r[1] ?? "")?.[1] ?? []),
    };
  });
}

describe("the hexagon preset matches the editor's outline (TEACH-215 part c)", () => {
  // ECMA-376 `hexagon`: x1 = ss * adj / 100000. The editor cuts 25% of the width.
  for (const [w, h] of [
    [413, 373],
    [32, 32],
    [48, 44],
    [44, 48],
  ] as const)
    it(`${w}x${h}: the side points sit at 25% of the width`, () => {
      expect((Math.min(w, h) * hexagonAdj(w, h)) / 100_000).toBeCloseTo(w * 0.25, 1);
    });
});
