import { describe, expect, it } from "bun:test";
import {
  CALLOUT_KINDS,
  richDocToPlainText,
  type ShapeElement,
  SLIDE_H,
  SLIDE_W,
  type Slide,
  type SlideElement,
  type TextElement,
} from "@tj/domain/documents";
import {
  applyCallout,
  CALLOUT_LABELS,
  CALLOUT_LINES,
  CALLOUT_NAMES,
  type CalloutSpec,
  calloutHeight,
  calloutLines,
  isCalloutElement,
  workedExampleCalloutRoom,
} from "./callout";
import { SAFE, SPACE, TRIM } from "./grid";
import { boxH, FULL, IMAGE_TEXT_COLUMN, layoutSlide } from "./layouts";
import { type IdSupplier, materialiseSlide } from "./materialise";
import { SAFE_BOTTOM } from "./metrics";
import { ceilingOf, type SlideSpec, SPEC_LIMITS } from "./specs";
import { fontFloor, getTheme, THEMES } from "./themes";

/*
 * The slide callout (UX ruling 84, TEACH-75): geometry per kind, theme and text length. The
 * no-callout path is pinned by `layouts.test.ts` (the frozen default recipes) and
 * `materialise.test.ts`; these hold what a callout adds and what it takes away.
 */

const meta = { promptVersion: "test", model: "test", at: "2026-09-23T09:00:00.000Z" };
const counter = (): IdSupplier => {
  let n = 0;
  return () => `e${++n}`;
};
const CARD_BOTTOM = SAFE_BOTTOM - SPACE[1];

/**
 * Three lengths and the lines the estimate gives them on every theme: twenty characters is one
 * line across either width; a hundred is two across the full width (sixty-two to sixty-seven
 * characters a line at the `small` stop) and past the column's three (twenty-nine to thirty-two);
 * the ceiling is three across the full width and past three in the column, so the cap holds.
 */
const SHORT = "Vapour is invisible.";
const MID =
  "Clouds are tiny drops of liquid water, not water vapour; the vapour itself is invisible.".padEnd(
    100,
    ".",
  );
const CEILING = "x".repeat(ceilingOf(SPEC_LIMITS.callout));
const LENGTHS = [
  { label: "short", text: SHORT, full: 1, column: 1 },
  { label: "mid", text: MID, full: 2, column: CALLOUT_LINES.column },
  { label: "ceiling", text: CEILING, full: CALLOUT_LINES.full, column: CALLOUT_LINES.column },
] as const;

const content = (callout?: CalloutSpec): SlideSpec => ({
  kind: "content",
  factRefs: ["m1"],
  heading: "The sun powers the cycle",
  body: "The sun heats water until it evaporates. High up it cools and condenses into cloud.",
  ...(callout ? { callout } : {}),
});
const imageText = (callout?: CalloutSpec): SlideSpec => ({
  kind: "image-text",
  factRefs: ["o3"],
  heading: "Clouds over the sea",
  body: "Warm air rises from the sea carrying water vapour.",
  ...(callout ? { callout } : {}),
});
const workedExample = (callout?: CalloutSpec): SlideSpec => ({
  kind: "worked-example",
  factRefs: ["w1"],
  question: "Why does a puddle disappear on a sunny day?",
  steps: ["The sun warms the puddle.", "Water becomes vapour.", "The puddle shrinks.", "Gone."],
  ...(callout ? { callout } : {}),
});

const trio = (slide: Slide) => {
  const card = slide.elements.find((el) => el.name === CALLOUT_NAMES.card);
  const label = slide.elements.find((el) => el.name === CALLOUT_NAMES.label);
  const text = slide.elements.find((el) => el.name === CALLOUT_NAMES.text);
  if (card?.type !== "shape" || label?.type !== "text" || text?.type !== "text") {
    throw new Error("callout trio missing");
  }
  return { card, label, text } as { card: ShapeElement; label: TextElement; text: TextElement };
};
const inside = (el: SlideElement, r: { x: number; y: number; w: number; h: number }) =>
  el.x >= r.x && el.y >= r.y && el.x + el.w <= r.x + r.w && el.y + el.h <= r.y + r.h;
const trim = { x: TRIM, y: TRIM, w: SLIDE_W - 2 * TRIM, h: SLIDE_H - 2 * TRIM };
const plain = (el: TextElement) => richDocToPlainText(el.doc);

describe("callout labels and colours", () => {
  it("carries a frozen uppercase label per kind, no emoji", () => {
    expect(CALLOUT_LABELS).toEqual({
      "watch-out": "WATCH OUT",
      example: "EXAMPLE",
      "key-words": "KEY WORDS",
    });
    for (const kind of CALLOUT_KINDS) expect(/\p{Extended_Pictographic}/u.test(kind)).toBe(false);
  });

  for (const theme of THEMES) {
    it(`${theme.id}: the card is the theme's surface, the label accent for watch-out, muted otherwise`, () => {
      for (const kind of CALLOUT_KINDS) {
        const spec = content({ kind, text: SHORT });
        const slide = materialiseSlide(spec, theme.id, meta, counter(), "headed");
        const { card, label, text } = trio(slide);
        expect(card.shape).toBe("rounded");
        expect(card.fill).toBe(theme.colors.surface);
        expect(card.radius).toBe(theme.radius);
        expect(label.style.preset).toBe("caption");
        expect(plain(label)).toBe(CALLOUT_LABELS[kind]);
        expect(label.style.color).toBe(
          kind === "watch-out" ? theme.colors.accent : theme.colors.muted,
        );
        expect(text.style.preset).toBe("small");
        expect(text.style.color).toBeUndefined();
        expect(plain(text)).toBe(SHORT);
      }
    });
  }
});

describe("the card is sized to its text", () => {
  for (const theme of THEMES) {
    it(`${theme.id}: one line for a short callout, the cap for the ceiling, never more`, () => {
      for (const { text, full, column } of LENGTHS) {
        expect(calloutLines(theme, text, FULL, CALLOUT_LINES.full)).toBe(full);
        expect(calloutLines(theme, text, IMAGE_TEXT_COLUMN.w, CALLOUT_LINES.column)).toBe(column);
      }
      expect(calloutLines(theme, "", FULL, CALLOUT_LINES.full)).toBe(1);
    });
  }
});

describe("callout on a content slide", () => {
  for (const theme of THEMES) {
    for (const variant of ["headed", "two-column"] as const) {
      for (const { label: length, text, full } of LENGTHS) {
        it(`${theme.id}/${variant}/${length}: the trio sits under the body, inside the safe area, ${full} line(s) tall`, () => {
          const spec = content({ kind: "watch-out", text });
          const without = materialiseSlide(content(), theme.id, meta, counter(), variant);
          const slide = materialiseSlide(spec, theme.id, meta, counter(), variant);
          // Appended, card first, after every element the recipe laid.
          const added = slide.elements.slice(without.elements.length);
          expect(added.map((el) => el.name)).toEqual([
            CALLOUT_NAMES.card,
            CALLOUT_NAMES.label,
            CALLOUT_NAMES.text,
          ]);
          expect(slide.elements.filter(isCalloutElement)).toHaveLength(3);
          expect(new Set(slide.elements.map((el) => el.id)).size).toBe(slide.elements.length);
          for (const el of added) expect(el.authoredBy).toBe("ai");

          const { card, label, text: textEl } = trio(slide);
          expect(inside(card, trim)).toBe(true);
          expect(inside(label, SAFE)).toBe(true);
          expect(inside(textEl, SAFE)).toBe(true);
          expect(card.x).toBe(SAFE.x);
          expect(card.w).toBe(SAFE.w);
          expect(card.y + card.h).toBe(CARD_BOTTOM);
          // On the rhythm, so the card is at most a baseline taller than its text needs.
          expect(card.y % 7).toBe(0);
          expect(card.h).toBeGreaterThanOrEqual(calloutHeight(theme, full));
          expect(card.h).toBeLessThan(calloutHeight(theme, full) + 7);
          expect(textEl.h).toBeGreaterThanOrEqual(boxH(theme, "small", full));
          expect(textEl.y).toBeGreaterThan(label.y + label.h);

          // Every body box ends a gap above the card, never taller than the recipe left it, and
          // keeps at least two lines of body at the theme's stop.
          const bodies = slide.elements.filter(
            (el): el is TextElement =>
              el.type === "text" &&
              (variant === "two-column"
                ? el.name?.startsWith("Body") === true
                : el.style.preset === "body") &&
              !isCalloutElement(el),
          );
          expect(bodies.length).toBe(variant === "two-column" ? 2 : 1);
          for (const body of bodies) {
            const before = without.elements.find(
              (el) => el.type === "text" && el.x === body.x && el.y === body.y,
            );
            if (!before) throw new Error("the recipe's body is missing");
            expect(body.y + body.h + SPACE[2]).toBeLessThanOrEqual(card.y);
            expect(body.h).toBeLessThanOrEqual(before.h);
            expect(body.h).toBeGreaterThanOrEqual(boxH(theme, "body", 2));
            // A one-line card ends below the headed recipe's four-line body box: nothing moves.
            if (variant === "headed" && length === "short") expect(body.h).toBe(before.h);
          }
        });
      }
    }
  }

  it("refuses the statement variant rather than laying a card under a centred sentence", () => {
    const theme = getTheme("chalk");
    const laid = layoutSlide("content", theme.id, "statement");
    expect(() =>
      applyCallout(laid, theme, "content", "statement", { kind: "example", text: SHORT }),
    ).toThrow(/statement/);
  });
});

describe("callout on an image-text slide", () => {
  for (const theme of THEMES) {
    for (const { label: length, text, column } of LENGTHS) {
      it(`${theme.id}/${length}: the card is in the text column, never over the picture, ${column} line(s) tall, and the body keeps two lines`, () => {
        const slide = materialiseSlide(
          imageText({ kind: "key-words", text }),
          theme.id,
          meta,
          counter(),
        );
        const { card, label, text: textEl } = trio(slide);
        const image = slide.elements.find((el) => el.type === "image");
        if (!image) throw new Error("no image");
        expect(card.x).toBe(IMAGE_TEXT_COLUMN.x);
        expect(card.w).toBe(IMAGE_TEXT_COLUMN.w);
        expect(card.x).toBeGreaterThanOrEqual(image.x + image.w);
        expect(card.x + card.w).toBeLessThanOrEqual(SAFE.x + SAFE.w);
        expect(card.y + card.h).toBeLessThanOrEqual(CARD_BOTTOM);
        expect(card.h).toBe(calloutHeight(theme, column));
        expect(inside(label, SAFE)).toBe(true);
        expect(inside(textEl, SAFE)).toBe(true);
        expect(textEl.h).toBeGreaterThanOrEqual(boxH(theme, "small", column));

        const texts = slide.elements.filter(
          (el): el is TextElement => el.type === "text" && !isCalloutElement(el),
        );
        const [caption, heading, body] = texts;
        if (!caption || !heading || !body) throw new Error("column slots missing");
        for (const el of texts) expect(inside(el, SAFE), `${el.style.preset} in safe`).toBe(true);
        // The stack keeps the recipe's gaps and now ends on the card.
        expect(heading.y).toBe(caption.y + caption.h + 12);
        expect(body.y).toBe(heading.y + heading.h + 19);
        expect(card.y).toBe(body.y + body.h + SPACE[2]);
        // Two lines of body at the projector floor, the size the engine steps a long body to.
        expect(body.h).toBeGreaterThanOrEqual(
          Math.ceil(fontFloor("body") * theme.lineHeights.body * 2),
        );
      });
    }
  }
});

describe("callout on a worked example", () => {
  for (const theme of THEMES) {
    it(`${theme.id}: there is no room under the working card, so the slide goes without`, () => {
      // Measured against the recipe: even a one-line card would leave the working under a body
      // line, and the four steps the spec allows already fill it (TEACH-247).
      expect(workedExampleCalloutRoom(theme)).toBeLessThan(0);
      expect(workedExampleCalloutRoom(theme, 1)).toBeLessThan(boxH(theme, "body", 2));
      const withCallout = materialiseSlide(
        workedExample({ kind: "example", text: SHORT }),
        theme.id,
        meta,
        counter(),
      );
      const without = materialiseSlide(workedExample(), theme.id, meta, counter());
      expect(withCallout).toEqual(without);
      expect(withCallout.elements.some(isCalloutElement)).toBe(false);
    });
  }
});

/* Every kind × host × theme × length: nothing off the slide, nothing on the picture. */
describe("callout geometry sweep", () => {
  for (const theme of THEMES) {
    for (const kind of CALLOUT_KINDS) {
      for (const { label: length, text } of LENGTHS) {
        it(`${theme.id}/${kind}/${length}: every element inside its bounds on both hosts`, () => {
          const slides = [
            materialiseSlide(content({ kind, text }), theme.id, meta, counter(), "headed"),
            materialiseSlide(content({ kind, text }), theme.id, meta, counter(), "two-column"),
            materialiseSlide(imageText({ kind, text }), theme.id, meta, counter()),
          ];
          for (const slide of slides) {
            const { card, label, text: textEl } = trio(slide);
            expect(inside(card, trim)).toBe(true);
            expect(inside(label, card)).toBe(true);
            expect(inside(textEl, card)).toBe(true);
            expect(label.y + label.h).toBeLessThanOrEqual(textEl.y);
            expect(plain(label)).toBe(CALLOUT_LABELS[kind]);
            expect(plain(textEl)).toBe(text);
            for (const el of slide.elements) {
              if (el.type !== "text" || isCalloutElement(el)) continue;
              // No text box the recipe laid reaches the card.
              const clearOfCard =
                el.y + el.h <= card.y || el.x + el.w <= card.x || el.x >= card.x + card.w;
              expect(clearOfCard, `${el.style.preset} clear of the card`).toBe(true);
            }
          }
        });
      }
    }
  }
});
