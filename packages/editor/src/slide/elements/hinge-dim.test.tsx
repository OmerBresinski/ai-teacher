import { describe, expect, test } from "bun:test";
import type { RichNode, Slide, SlideElement } from "@tj/domain/documents";
import { contrastRatio, mix } from "@tj/slides";
import { dimGround, dimInk } from "@tj/slides/surfaces";
import { layoutTemplate, type TemplateInput } from "@tj/slides/templates";
import { THEMES } from "@tj/slides/themes";
import { renderToStaticMarkup } from "react-dom/server";
import { choiceMarks } from "./choice";
import HingeMarks, { HINGE_FADE, hingeDimParts, hingeFade } from "./HingeMarks";

/*
 * TEACH-256 part d (rulings 258, 248): the one-click reveal redraws each wrong hinge card with its
 * words, key and bars in the theme's dim tone, never an opacity wash; the right card is not dimmed.
 * TEACH-215 part i: the card, its line and its key fade as the gold's `.34` over the stage behind;
 * the words keep the dim tone, stepped toward the ink only where that faded card needs it for 4.5:1.
 */
const LOOKS: [string, TemplateInput][] = [
  [
    "tiles",
    {
      template: "hinge",
      heading: "Which part makes seeds?",
      options: ["Leaf", "Root", "Flower"],
      choices: [
        { text: "Leaf", icon: "leaf" },
        { text: "Root", icon: "root" },
        { text: "Flower", icon: "flower" },
      ],
      correct: 2,
    },
  ],
  [
    "2x2",
    {
      template: "hinge",
      heading: "Which of these metals is magnetic?",
      options: ["Copper", "Iron", "Aluminium", "All of them"],
      correct: 2,
    },
  ],
  [
    "rows",
    {
      template: "hinge",
      heading: "Quick check",
      stem: "Which part of the blood carries oxygen around the body?",
      options: ["Red blood cells", "White blood cells", "Platelets", "Plasma"],
      correct: 1,
    },
  ],
];

/** Every colour a text part's words are drawn in: its style, and each run that sets its own. */
function wordColours(e: SlideElement): string[] {
  if (e.type !== "text") return [];
  const out = [e.style.color].filter((c): c is string => typeof c === "string");
  const stack: RichNode[] = [...(e.doc.content ?? [])];
  for (let n = stack.pop(); n; n = stack.pop()) {
    for (const m of n.marks ?? [])
      if (m.type === "textStyle" && typeof m.attrs?.color === "string") out.push(m.attrs.color);
    stack.push(...(n.content ?? []));
  }
  return out;
}

const fillOf = (e: SlideElement | undefined): string =>
  e?.type === "shape" && e.fill ? e.fill : "(no fill)";

const inside = (card: SlideElement) => (e: SlideElement) =>
  e.id !== card.id &&
  e.x >= card.x &&
  e.y >= card.y &&
  e.x + e.w <= card.x + card.w &&
  e.y + e.h <= card.y + card.h;

describe("hinge reveal: wrong options in the dim tone", () => {
  for (const theme of THEMES)
    for (const [look, input] of LOOKS)
      test(`${theme.id}, ${look}: each wrong card's words read at 4.5:1 on that card's own fill`, () => {
        const r = layoutTemplate(input, theme, "ks2");
        const slide = { id: "s1", ...r.slide } as Slide;
        const marks = choiceMarks(slide, true, 0);
        const wrong = marks.filter((m) => m.state === "dim");
        const right = marks.filter((m) => m.state === "right");
        expect(right).toHaveLength(1);
        expect(wrong.length).toBe(marks.length - 1);
        for (const { id } of wrong) {
          const fade = hingeFade(slide, theme, id);
          const dim = fade?.words as string;
          const [card, ...parts] = hingeDimParts(slide, theme, id);
          // The redraw is the card itself, opaque, so nothing of the full-ink original shows.
          expect(card?.id).toBe(id);
          const fill = fillOf(card);
          expect(fill).toMatch(/^#[0-9a-f]{6}$/i);
          // The gold's fade: the card's own fill at .34 over the stage behind it.
          const own = fillOf(slide.elements.find((e) => e.id === id));
          expect(fill).toBe(mix(own, fade?.behind as string, HINGE_FADE));
          // The dim tone itself wherever it already reads on the faded card.
          if (contrastRatio(dimInk(theme), fill) >= 4.5) expect(dim).toBe(dimInk(theme));
          const words = parts.filter((p) => p.type === "text");
          expect(words.length).toBeGreaterThan(0);
          for (const w of words) {
            const colours = wordColours(w);
            expect(colours.length).toBeGreaterThan(0);
            expect(w.opacity ?? 1).toBe(1);
            for (const c of colours)
              expect({ id: w.id, c, ratio: contrastRatio(c, fill) >= 4.5 }).toEqual({
                id: w.id,
                c: dim,
                ratio: true,
              });
          }
          // The key's letter on the dim key reads as the words do on the card.
          const key = parts.find((p) => p.name === "Hinge key");
          // An outline key (Poster, Calm: TEACH-215 part k) has no fill: its letter sits on the card.
          const keyFill = fillOf(key) === "transparent" ? fill : fillOf(key);
          const letter = key?.type === "shape" ? key.textStyle?.color : undefined;
          expect(contrastRatio(letter as string, keyFill)).toBeGreaterThanOrEqual(4.5);
          // The key goes pale in its own colour (a letter's tone, the ink or the accent), as in the gold.
          const own0 = slide.elements.find((e) => e.id === key?.id);
          const keyOwn = fillOf(own0);
          if (/^#[0-9a-f]{6}$/i.test(keyOwn))
            expect(keyFill).toBe(mix(keyOwn, fade?.behind as string, HINGE_FADE));
        }
        // The right card is never redrawn, and its words keep their full ink.
        const [rightMark] = right;
        const rightCard = slide.elements.find((e) => e.id === rightMark?.id) as SlideElement;
        const rightWords = slide.elements
          .filter(inside(rightCard))
          .filter((e) => e.type === "text");
        expect(rightWords.length).toBeGreaterThan(0);
        for (const w of rightWords)
          for (const c of wordColours(w)) {
            expect(c).not.toBe(dimInk(theme));
            expect(contrastRatio(c, fillOf(rightCard))).toBeGreaterThanOrEqual(4.5);
          }
      });

  test("generated hinge cards are always shapes with an opaque fill", () => {
    for (const theme of THEMES)
      for (const [, input] of LOOKS) {
        const slide = { id: "s1", ...layoutTemplate(input, theme, "ks2").slide } as Slide;
        for (const { id } of choiceMarks(slide, true, 0)) {
          const card = slide.elements.find((e) => e.id === id);
          expect(fillOf(card)).toMatch(/^#[0-9a-f]{6}$/i);
        }
      }
  });

  test("a see-through card a teacher made never throws: its dim words sit on the opaque ground", () => {
    const theme = THEMES[0] as (typeof THEMES)[number];
    const r = layoutTemplate(LOOKS[2]?.[1] as TemplateInput, theme, "ks2");
    const slide = { id: "s1", ...r.slide } as Slide;
    const [wrong] = choiceMarks(slide, true, 0).filter((m) => m.state === "dim");
    const id = wrong?.id as string;
    for (const fill of [`${fillOf(slide.elements.find((e) => e.id === id))}80`, "transparent"]) {
      const clear: Slide = {
        ...slide,
        elements: slide.elements.map((e) =>
          e.id === id && e.type === "shape" ? { ...e, fill } : e,
        ),
      };
      const [card, ...parts] = hingeDimParts(clear, theme, id);
      expect(fillOf(card)).toBe(dimGround(theme));
      for (const w of parts.filter((p) => p.type === "text"))
        for (const c of wordColours(w))
          expect(contrastRatio(c, fillOf(card))).toBeGreaterThanOrEqual(4.5);
      const html = renderToStaticMarkup(
        <HingeMarks
          slide={clear}
          theme={theme}
          marks={[{ id, state: "dim" }]}
          placed={new Map([[id, clear.elements.find((e) => e.id === id) as SlideElement]])}
        />,
      );
      expect(html).toContain('data-choice-mark="dim"');
    }
  });

  /*
   * TEACH-215 part i review: a picture in a wrong card fades into the stage (a stage plate under it,
   * its own opacity multiplied); a library icon keeps its faded card; a non-hex shadow fades, its
   * alpha kept; a gradient stage fades toward its first stop; a part that overhangs the card fades.
   */
  test("pictures, icons, odd shadows, gradient stages and overhanging parts all fade", () => {
    const theme = THEMES.find((t) => t.id === "treehouse") as (typeof THEMES)[number];
    const slide = {
      id: "s1",
      ...layoutTemplate(LOOKS[1]?.[1] as TemplateInput, theme, "ks2").slide,
    } as Slide;
    const [wrong] = choiceMarks(slide, true, 0).filter((m) => m.state === "dim");
    const id = wrong?.id as string;
    const card = slide.elements.find((e) => e.id === id) as SlideElement;
    const box = { x: card.x + 10, y: card.y + 4, w: 30, h: 30 };
    const extra: SlideElement[] = [
      { ...box, id: "pic", type: "image", src: "/p.jpg", opacity: 0.5 } as SlideElement,
      { ...box, id: "ico", type: "image", src: "/i.svg", name: "Option icon" } as SlideElement,
      {
        ...box,
        id: "over",
        type: "shape",
        shape: "rect",
        fill: "#112233",
        y: card.y - 6,
      } as SlideElement,
    ];
    const stage = slide.elements.find((e) => e.name === "surface:field-b") as SlideElement;
    const odd: Slide = {
      ...slide,
      elements: [
        ...slide.elements.map((e) =>
          e.id === stage.id
            ? ({ ...e, fill: "linear-gradient(180deg, #102030 0%, #FFFFFF 100%)" } as SlideElement)
            : e.id === id
              ? ({ ...e, shadow: { x: 4, y: 4, color: "rgba(0, 0, 0, 0.5)" } } as SlideElement)
              : e,
        ),
        ...extra,
      ],
    };
    const fade = hingeFade(odd, theme, id);
    expect(fade?.behind).toBe("#102030");
    const parts = hingeDimParts(odd, theme, id);
    const [quiet] = parts;
    expect(quiet?.type === "shape" ? quiet.shadow?.color : "").toBe(
      `${mix("#000000", "#102030", HINGE_FADE)}80`,
    );
    const pic = parts.find((p) => p.id === "pic");
    expect(pic?.opacity).toBeCloseTo(0.5 * HINGE_FADE, 6);
    const plate = parts.find((p) => p.id === "pic-stage");
    expect(fillOf(plate)).toBe("#102030");
    expect(parts.indexOf(plate as SlideElement)).toBeLessThan(parts.indexOf(pic as SlideElement));
    expect(parts.find((p) => p.id === "ico")?.opacity).toBeCloseTo(HINGE_FADE, 6);
    expect(parts.some((p) => p.id === "ico-stage")).toBe(false);
    expect(fillOf(parts.find((p) => p.id === "over"))).toBe(mix("#112233", "#102030", HINGE_FADE));
  });
});
