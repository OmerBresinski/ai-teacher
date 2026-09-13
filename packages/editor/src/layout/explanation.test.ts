import { describe, expect, test } from "bun:test";
import type { Slide, SlideKind, Theme } from "@tj/domain/documents";
import { docFromText } from "../model/factories";
import { SAFE } from "../model/grid";
import { layoutSlide } from "../model/layouts";
import { fontFloor, getTheme, THEMES } from "../model/themes";
import {
  EXPLANATION_PLACEHOLDER,
  explanationLane,
  explanationLayout,
  hasExplanationPanel,
  PANEL,
  panelHeight,
  panelType,
  RESERVED_LINES,
  reservedLines,
} from "./explanation";
import { lintSlide } from "./lint";
import { SAFE_BOTTOM } from "./reflow";
import { rulerFor } from "./test-ruler";

/*
 * The "Why?" panel's geometry (TeachDeck `lib/__tests__/explanation-panel.test.ts`, TEACH-113 gap
 * analysis). The measurement-free constants live in `@tj/slides`; what is pinned here is the
 * editor's half — which slides reserve a lane, how much, and that the panel never sits on a card.
 */

const KINDS: SlideKind[] = ["true-false", "multiple-choice"];

/** The recipe for `kind`, as the slide the renderer would be handed. */
function slideOf(kind: SlideKind, theme: Theme): Slide {
  const { elements, question } = layoutSlide(kind, theme.id);
  return { id: `sl-${kind}`, kind, elements, question };
}

const lowestOption = (slide: Slide) =>
  slide.elements.filter((e) => e.type === "option").reduce((m, e) => Math.max(m, e.y + e.h), 0);

const ONE_LINE = "Water vapour is invisible.";
/** Two lines in every theme: the demo lesson's own reason. */
const TWO_LINES = "Clouds are tiny droplets of liquid water. Water vapour is invisible.";
const LONG =
  "Clouds are made of tiny droplets of liquid water, not of water vapour, because the vapour " +
  "has already cooled and condensed by the time you can see anything at all in the sky above you.";

describe("which questions carry a Why? panel", () => {
  test("true-false and multiple choice do, nothing else does", () => {
    expect(hasExplanationPanel({ type: "true-false", correct: true })).toBe(true);
    expect(hasExplanationPanel({ type: "multiple-choice", options: [] })).toBe(true);
    expect(hasExplanationPanel({ type: "open-response" })).toBe(false);
    expect(hasExplanationPanel({ type: "sort", order: [] })).toBe(false);
    expect(hasExplanationPanel(undefined)).toBe(false);
  });
});

describe("question recipes reserve the panel lane", () => {
  for (const theme of THEMES) {
    for (const kind of KINDS) {
      test(`${kind} on ${theme.id}: every element clears the reserved lane and lints clean`, () => {
        const slide = slideOf(kind, theme);
        const lane = explanationLane(slide);
        expect(lane.h).toBeGreaterThanOrEqual(panelHeight(theme, reservedLines(slide, theme)));
        for (const el of slide.elements) {
          if (el.w * el.h >= 960 * 540 * 0.85) continue; // a backdrop is the ground, not a box
          expect(el.y + el.h).toBeLessThanOrEqual(lane.y - PANEL.above + 0.5);
        }
        expect(lintSlide(slide, rulerFor(theme), theme).laneOverflow).toEqual([]);
      });
    }
  }
});

describe("the panel fits the safe area", () => {
  for (const theme of THEMES) {
    for (const kind of KINDS) {
      for (const [name, text] of [
        ["a one-line reason", ONE_LINE],
        ["the editor placeholder", EXPLANATION_PLACEHOLDER],
        ["a long reason", LONG],
      ] as const) {
        test(`${kind} on ${theme.id}: ${name}`, () => {
          const slide = slideOf(kind, theme);
          const box = explanationLayout({ slide, theme, text });
          expect(box.x).toBe(SAFE.x);
          expect(box.w).toBe(SAFE.w);
          expect(box.y).toBeGreaterThanOrEqual(SAFE.y);
          expect(box.y + box.h).toBeLessThanOrEqual(SAFE_BOTTOM);
          // And never on the answer cards.
          expect(box.y).toBeGreaterThanOrEqual(lowestOption(slide) + PANEL.above);
          expect(box.collapsed).toBe(false);
          expect(box.bodySize).toBeGreaterThanOrEqual(fontFloor("body"));
        });
      }

      test(`${kind} on ${theme.id}: a one-line reason needs no step down`, () => {
        const box = explanationLayout({ slide: slideOf(kind, theme), theme, text: ONE_LINE });
        expect(box.lines).toBe(1);
        expect(box.bodySize).toBe(panelType(theme).bodySize);
        expect(box.overflowing).toBe(false);
      });
    }

    test(`true-false on ${theme.id}: a two-line reason fits without stepping down`, () => {
      const slide = slideOf("true-false", theme);
      const box = explanationLayout({ slide, theme, text: TWO_LINES });
      expect(box.lines).toBe(2);
      expect(box.bodySize).toBe(panelType(theme).bodySize);
      expect(box.overflowing).toBe(false);
    });
  }

  test("a long reason steps the body down rather than spilling out of the lane", () => {
    const theme = getTheme("chalk");
    const slide = slideOf("true-false", theme);
    const short = explanationLayout({ slide, theme, text: ONE_LINE });
    const long = explanationLayout({ slide, theme, text: LONG });
    expect(long.lines).toBeGreaterThan(short.lines);
    expect(long.bodySize).toBeLessThanOrEqual(short.bodySize);
    expect(long.y + long.h).toBe(SAFE_BOTTOM);
    expect(long.y).toBeGreaterThanOrEqual(lowestOption(slide) + PANEL.above);
  });
});

describe("cards pushed into the lane", () => {
  const theme = getTheme("chalk");

  test("the panel gives up its own room rather than sitting on a card", () => {
    const base = slideOf("true-false", theme);
    const slide: Slide = {
      ...base,
      elements: base.elements.map((el) =>
        el.type === "option" ? { ...el, y: SAFE_BOTTOM - el.h } : el,
      ),
    };
    const box = explanationLayout({ slide, theme, text: ONE_LINE });
    expect(box.lane).toBe(0);
    expect(box.h).toBe(0);
    expect(box.collapsed).toBe(true);
    expect(box.overflowing).toBe(true);
    expect(box.y).toBeGreaterThanOrEqual(lowestOption(slide));
  });

  test("the panel sits under a note, not on it, and the linter reports the note", () => {
    const base = slideOf("true-false", theme);
    const noteTop = SAFE_BOTTOM - 40;
    const note = {
      id: "note",
      type: "text" as const,
      x: SAFE.x,
      y: noteTop,
      w: 300,
      h: 30,
      doc: docFromText("A note the teacher left under the cards"),
      style: { preset: "small" as const, autoHeight: false },
    };
    const slide: Slide = { ...base, elements: [...base.elements, note] };
    const box = explanationLayout({ slide, theme, text: ONE_LINE });
    expect(box.y).toBeGreaterThanOrEqual(noteTop + 30);
    expect(box.lane).toBeLessThan(explanationLayout({ slide: base, theme, text: ONE_LINE }).lane);
    expect(box.overflowing).toBe(true);
    expect(lintSlide(slide, rulerFor(theme), theme).laneOverflow).toContain("note");
  });

  test("the lane is inside the safe area and stable while the panel grows", () => {
    const slide = slideOf("multiple-choice", theme);
    const lane = explanationLane(slide);
    expect(lane.x).toBe(SAFE.x);
    expect(lane.w).toBe(SAFE.w);
    expect(lane.y + lane.h).toBe(SAFE_BOTTOM);
    const short = explanationLayout({ slide, theme, text: ONE_LINE });
    const long = explanationLayout({ slide, theme, text: LONG });
    expect(short.lane).toBe(lane.h);
    expect(long.lane).toBe(lane.h);
  });
});

describe("reservedLines", () => {
  for (const theme of THEMES) {
    test(`true or false always asks for two on ${theme.id}`, () => {
      expect(reservedLines(slideOf("true-false", theme), theme)).toBe(RESERVED_LINES["true-false"]);
      expect(reservedLines(slideOf("true-false", theme), theme, rulerFor(theme))).toBe(2);
    });

    test(`multiple choice takes what the slide can give on ${theme.id}`, () => {
      const slide = slideOf("multiple-choice", theme);
      const asked = reservedLines(slide, theme, rulerFor(theme));
      expect(asked).toBeGreaterThanOrEqual(RESERVED_LINES["multiple-choice"]);
      expect(asked).toBeLessThanOrEqual(2);
      // Never more than the lane has room for.
      expect(explanationLane(slide).h).toBeGreaterThanOrEqual(panelHeight(theme, asked));
    });
  }

  test("a stem that wraps hands no line back to the panel", () => {
    const theme = getTheme("chalk");
    const base = slideOf("multiple-choice", theme);
    const slide: Slide = {
      ...base,
      elements: base.elements.map((el) =>
        el.type === "text" && el.style.preset === "heading"
          ? { ...el, doc: docFromText(`${LONG} ${LONG}`) }
          : el,
      ),
    };
    expect(reservedLines(slide, theme, rulerFor(theme))).toBe(RESERVED_LINES["multiple-choice"]);
  });

  test("a slide with no panel asks for nothing", () => {
    const theme = getTheme("chalk");
    expect(reservedLines(slideOf("content", theme), theme)).toBe(0);
    expect(reservedLines(slideOf("open-response", theme), theme)).toBe(0);
  });
});
