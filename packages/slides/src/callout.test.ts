import { describe, expect, it } from "bun:test";
import {
  CALLOUT_KINDS,
  type IconElement,
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
  CALLOUT_ICON,
  CALLOUT_ICONS,
  CALLOUT_LABELS,
  CALLOUT_NAMES,
  type CalloutSpec,
  calloutHeight,
  calloutLines,
  fitCallout,
  isCalloutElement,
  workedExampleCalloutRoom,
} from "./callout";
import { fitSlide } from "./fit-slide";
import { SAFE, SPACE, TRIM } from "./grid";
import { boxH, CARD_PAD, FULL, IMAGE_TEXT_COLUMN, layoutSlide } from "./layouts";
import { PHOTO_NAME } from "./look";
import { type IdSupplier, materialiseSlide } from "./materialise";
import { SAFE_BOTTOM } from "./metrics";
import { stepDownSize } from "./reflow";
import { ceilingOf, type SlideSpec, SPEC_LIMITS } from "./specs";
import { CALLOUT_TONES, calloutTone, calloutTones, fontFloor, getTheme, THEMES } from "./themes";

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

/** Prose of `n` characters, cut at the end: what a writer's callout looks like, not a run of x's. */
const prose = (n: number) => {
  let out = "";
  while (out.length < n) out += "clouds are tiny drops of liquid water not vapour ";
  return out.slice(0, n).trim();
};
const SHORT = "Vapour is invisible.";
const MID =
  "Clouds are tiny drops of liquid water, not water vapour; the vapour itself is invisible.".padEnd(
    100,
    ".",
  );
const CEILING = prose(ceilingOf(SPEC_LIMITS.callout));
const LENGTHS = [
  { label: "short", text: SHORT },
  { label: "mid", text: MID },
  { label: "ceiling", text: CEILING },
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
  const icon = slide.elements.find((el) => el.name === CALLOUT_NAMES.icon);
  const label = slide.elements.find((el) => el.name === CALLOUT_NAMES.label);
  const text = slide.elements.find((el) => el.name === CALLOUT_NAMES.text);
  if (
    card?.type !== "shape" ||
    icon?.type !== "icon" ||
    label?.type !== "text" ||
    text?.type !== "text"
  ) {
    throw new Error("callout elements missing");
  }
  return { card, icon, label, text } as {
    card: ShapeElement;
    icon: IconElement;
    label: TextElement;
    text: TextElement;
  };
};
const inside = (el: SlideElement, r: { x: number; y: number; w: number; h: number }) =>
  el.x >= r.x && el.y >= r.y && el.x + el.w <= r.x + r.w && el.y + el.h <= r.y + r.h;
const trim = { x: TRIM, y: TRIM, w: SLIDE_W - 2 * TRIM, h: SLIDE_H - 2 * TRIM };
const plain = (el: TextElement) => richDocToPlainText(el.doc);

/**
 * The recipe with the callout laid in, before `materialiseSlide` fits it (TEACH-28). The geometry
 * below is `applyCallout`'s: the fit then sets each text box to its measured height, which the
 * "after the fit" block holds separately.
 */
const laidWith = (spec: SlideSpec, theme: ReturnType<typeof getTheme>, variant = ""): Slide => {
  if (spec.kind !== "content" && spec.kind !== "image-text") throw new Error("not a callout host");
  const laid = layoutSlide(spec.kind, theme.id, variant || undefined);
  const withCard = spec.callout
    ? applyCallout(laid, theme, spec.kind, variant, spec.callout)
    : laid;
  return { id: "s", kind: spec.kind, elements: withCard.elements };
};

describe("callout labels and colours", () => {
  it("carries a frozen uppercase label per kind, no emoji", () => {
    expect(CALLOUT_LABELS).toEqual({
      "watch-out": "COMMON MISTAKE",
      example: "EXAMPLE",
      "key-words": "KEY WORDS",
    });
    for (const kind of CALLOUT_KINDS) expect(/\p{Extended_Pictographic}/u.test(kind)).toBe(false);
  });

  it("draws a warning sign, a lightbulb and an open book (T75-7), never a magnifier or a key", () => {
    expect(CALLOUT_ICONS).toEqual({
      "watch-out": "triangle-alert",
      example: "lightbulb",
      "key-words": "book-open",
    });
  });

  for (const theme of THEMES) {
    it(`${theme.id}: the card, icon, label and text take the kind's tone from the theme's set`, () => {
      const set = calloutTones(theme);
      for (const kind of CALLOUT_KINDS) {
        const spec = content({ kind, text: SHORT });
        const slide = materialiseSlide(spec, theme.id, meta, counter(), "headed");
        const { card, icon, label, text } = trio(slide);
        expect(calloutTone(theme, kind)).toBe(set[kind]);
        expect(card.shape).toBe("rounded");
        expect(card.fill).toBe(set[kind].fill);
        expect(card.stroke).toBe(set[kind].line);
        expect(card.radius).toBe(theme.radius);
        expect(icon.icon).toBe(CALLOUT_ICONS[kind]);
        expect(icon.color).toBe(set[kind].icon);
        expect(icon.w).toBe(CALLOUT_ICON);
        expect(label.style.preset).toBe("caption");
        expect(plain(label)).toBe(CALLOUT_LABELS[kind]);
        expect(label.style.color).toBe(set[kind].ink);
        expect(text.style.preset).toBe("small");
        expect(text.style.color).toBe(set[kind].ink);
        expect(plain(text)).toBe(SHORT);
        // The icon heads the label row, the label beside it and centred on it.
        expect(icon.x).toBe(card.x + CARD_PAD);
        expect(label.x).toBeGreaterThanOrEqual(icon.x + icon.w);
        expect(label.y + label.h / 2).toBeCloseTo(icon.y + icon.h / 2, 5);
        expect(text.y).toBeGreaterThanOrEqual(icon.y + icon.h);
      }
    });
  }

  it("gives each kind its own hue and icon, so no two cards look alike", () => {
    for (const set of Object.values(CALLOUT_TONES)) {
      expect(new Set(CALLOUT_KINDS.map((k) => set[k].fill)).size).toBe(CALLOUT_KINDS.length);
    }
    expect(new Set(Object.values(CALLOUT_ICONS)).size).toBe(CALLOUT_KINDS.length);
  });
});

describe("the card hugs its text", () => {
  for (const theme of THEMES) {
    it(`${theme.id}: the card holds exactly the lines the ruler measures, no empty line under them`, () => {
      expect(calloutLines(theme, SHORT, FULL)).toBe(1);
      expect(calloutLines(theme, SHORT, IMAGE_TEXT_COLUMN.w)).toBe(1);
      expect(calloutLines(theme, "", FULL)).toBe(1);
      // The demo's misconception: one line across the full width on some themes, two on others;
      // either way the fitted text box is the box the card was sized for.
      const demo = "Clouds are tiny drops of liquid water, not water vapour; vapour is invisible.";
      for (const [spec, variant] of [
        [content({ kind: "watch-out", text: demo }), "headed"],
        [imageText({ kind: "watch-out", text: demo }), ""],
      ] as const) {
        const fitted = trio(
          materialiseSlide(spec, theme.id, meta, counter(), variant || undefined),
        );
        // The look lays a content slide's words first and the card goes in the column they leave
        // (TEACH-19), so its card is measured at its own width, not the recipe's.
        if (spec.kind === "content") {
          const at = fitted.text.style.fontSize;
          const n = calloutLines(theme, demo, fitted.card.w, at);
          expect(fitted.card.h).toBeGreaterThanOrEqual(calloutHeight(theme, n, at));
          expect(fitted.card.h).toBeLessThan(calloutHeight(theme, n, at) + 7);
          expect(inside(fitted.text, fitted.card)).toBe(true);
          continue;
        }
        const laid = trio(laidWith(spec, theme, variant));
        // No empty line under the text: the fitted box is within a point of the one the card was
        // sized for, or (image-text on Playground and Beacon, where master's fit steps every
        // image-text slide down one stop because it counts the half-bleed picture as overflow)
        // the same number of lines one stop smaller.
        const size = fitted.text.style.fontSize ?? theme.sizes.small;
        const line = size * theme.lineHeights.small;
        const lines = (h: number, at: number) => Math.round(h / (at * theme.lineHeights.small));
        expect(lines(fitted.text.h, size), `${spec.kind} lines`).toBe(
          lines(laid.text.h, laid.text.style.fontSize ?? Math.max(theme.sizes.small, 24)),
        );
        expect(laid.text.h - fitted.text.h, `${spec.kind} slack`).toBeLessThan(line);
        expect(fitted.card.h).toBe(laid.card.h);
      }
    });
  }
});

describe("callout on a content slide", () => {
  for (const theme of THEMES) {
    for (const variant of ["headed", "two-column"] as const) {
      for (const { label: length, text } of LENGTHS) {
        it(`${theme.id}/${variant}/${length}: the trio sits under the body, inside the safe area, as tall as its text`, () => {
          const spec = content({ kind: "watch-out", text });
          const notes: string[] = [];
          const slide = materialiseSlide(spec, theme.id, meta, counter(), variant, {}, (n) =>
            notes.push(n),
          );
          // The callout gives way first (rulings 102, 106): with no room under the words as the
          // look sets them (the key idea's side panel takes the other half), it is left off and
          // reported, and the words are untouched.
          if (!slide.elements.some(isCalloutElement)) {
            expect(notes).toHaveLength(1);
            return;
          }
          // Appended last, card first, after the look has laid the words (TEACH-19).
          const added = slide.elements.slice(-4);
          expect(added.map((el) => el.name)).toEqual([
            CALLOUT_NAMES.card,
            CALLOUT_NAMES.icon,
            CALLOUT_NAMES.label,
            CALLOUT_NAMES.text,
          ]);
          expect(slide.elements.filter(isCalloutElement)).toHaveLength(4);
          expect(new Set(slide.elements.map((el) => el.id)).size).toBe(slide.elements.length);
          for (const el of added) expect(el.authoredBy).toBe("ai");

          const laid = laidWith(spec, theme, variant);
          const laidWithout = laidWith(content(), theme, variant);
          const { card, label, text: textEl } = trio(laid);
          expect(inside(card, trim)).toBe(true);
          expect(inside(label, SAFE)).toBe(true);
          expect(inside(textEl, SAFE)).toBe(true);
          expect(card.x).toBe(SAFE.x);
          expect(card.w).toBe(SAFE.w);
          expect(card.y + card.h).toBe(CARD_BOTTOM);
          // On the rhythm, so the card is at most a baseline taller than its text needs.
          expect(card.y % 7).toBe(0);
          const size = textEl.style.fontSize;
          const lines = calloutLines(theme, text, FULL, size);
          expect(card.h).toBeGreaterThanOrEqual(calloutHeight(theme, lines, size));
          expect(card.h).toBeLessThan(calloutHeight(theme, lines, size) + 7);
          expect(textEl.y).toBeGreaterThan(label.y + label.h);

          // Every body box ends a gap above the card, never taller than the recipe left it, and
          // keeps at least two lines of body at the theme's stop.
          const bodies = laid.elements.filter(
            (el): el is TextElement =>
              el.type === "text" &&
              (variant === "two-column"
                ? el.name?.startsWith("Body") === true
                : el.style.preset === "body") &&
              !isCalloutElement(el),
          );
          expect(bodies.length).toBe(variant === "two-column" ? 2 : 1);
          for (const body of bodies) {
            const before = laidWithout.elements.find(
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
    for (const { label: length, text } of LENGTHS.filter((l) => l.label !== "ceiling")) {
      it(`${theme.id}/${length}: the card is in the text column, never over the picture, as tall as its text, and the body keeps two lines`, () => {
        const slide = laidWith(imageText({ kind: "key-words", text }), theme);
        const { card, label, text: textEl } = trio(slide);
        const image = slide.elements.find((el) => el.type === "image");
        if (!image) throw new Error("no image");
        expect(card.x).toBe(IMAGE_TEXT_COLUMN.x);
        expect(card.w).toBe(IMAGE_TEXT_COLUMN.w);
        expect(card.x).toBeGreaterThanOrEqual(image.x + image.w);
        expect(card.x + card.w).toBeLessThanOrEqual(SAFE.x + SAFE.w);
        expect(card.y + card.h).toBeLessThanOrEqual(CARD_BOTTOM);
        const size = textEl.style.fontSize;
        expect(card.h).toBe(calloutHeight(theme, calloutLines(theme, text, card.w, size), size));
        expect(inside(label, SAFE)).toBe(true);
        expect(inside(textEl, SAFE)).toBe(true);

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
            laidWith(content({ kind, text }), theme, "headed"),
            laidWith(content({ kind, text }), theme, "two-column"),
            laidWith(imageText({ kind, text }), theme),
          ];
          for (const slide of slides) {
            // A callout that does not fit even one stop down is left off, never clipped.
            if (!slide.elements.some(isCalloutElement)) {
              const w = slide.elements.some((el) => el.type === "image")
                ? IMAGE_TEXT_COLUMN.w
                : FULL;
              expect(fitCallout(theme, text, w, SLIDE_H)).toBeDefined();
              continue;
            }
            const { card, icon, label, text: textEl } = trio(slide);
            expect(inside(card, trim)).toBe(true);
            expect(inside(icon, card)).toBe(true);
            expect(inside(label, card)).toBe(true);
            expect(icon.y + icon.h).toBeLessThanOrEqual(textEl.y);
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

/*
 * After the fit (TEACH-28): `materialiseSlide` sets every text box to its measured height. Prose
 * the card was sized for stays inside it, and the card itself does not move. Long column callouts
 * have their own block below.
 */
describe("callout after the fit", () => {
  const FULL_PROSE =
    "Clouds are tiny drops of liquid water, not water vapour; the vapour itself is invisible, so what we see is condensation.";
  const FULL_CEILING_PROSE =
    "Clouds are tiny drops of liquid water, not water vapour; the vapour itself is invisible, so what we see in the sky is condensation that has formed around specks of dust and salt.";
  const COLUMN_PROSE =
    "Clouds are tiny drops of liquid water, not water vapour, which is invisible.";
  it("the prose fixtures are within the spec's ceiling", () => {
    expect(FULL_PROSE.length).toBeLessThanOrEqual(ceilingOf(SPEC_LIMITS.callout));
    expect(FULL_CEILING_PROSE.length).toBeLessThanOrEqual(ceilingOf(SPEC_LIMITS.callout));
    expect(FULL_CEILING_PROSE.length).toBeGreaterThan(ceilingOf(SPEC_LIMITS.callout) - 10);
  });
  for (const theme of THEMES) {
    it(`${theme.id}: the measured text stays in its card and the card stays where it was laid`, () => {
      const cases = [
        ...[SHORT, FULL_PROSE, FULL_CEILING_PROSE].flatMap((text) =>
          (["headed", "two-column"] as const).map(
            (variant) => [content({ kind: "watch-out", text }), variant] as const,
          ),
        ),
        ...[SHORT, COLUMN_PROSE].map((text) => [imageText({ kind: "example", text }), ""] as const),
      ];
      for (const [spec, variant] of cases) {
        const slide = materialiseSlide(spec, theme.id, meta, counter(), variant || undefined);
        // A content card with no room under the words is left off (rulings 102, 106).
        if (spec.kind === "content" && !slide.elements.some(isCalloutElement)) continue;
        const fitted = trio(slide);
        const where = `${spec.kind}/${variant}/${plain(fitted.text).length}`;
        if (spec.kind === "content") {
          // After the look (TEACH-19): at the foot, inside the safe width, clear of every word.
          expect(fitted.card.y + fitted.card.h, where).toBe(CARD_BOTTOM);
          expect(inside(fitted.card, SAFE), where).toBe(true);
          for (const el of slide.elements) {
            if (isCalloutElement(el) || el.name === "Accent bar") continue;
            const card = fitted.card;
            // Beside the card (a side panel or slot in the other column) is not over it.
            if (el.x >= card.x + card.w || el.x + el.w <= card.x) continue;
            expect(el.y + el.h + SPACE[2], `${where} ${el.name}`).toBeLessThanOrEqual(
              fitted.card.y,
            );
          }
        } else {
          const laid = trio(laidWith(spec, theme, variant));
          const rect = ({ x, y, w, h }: SlideElement) => ({ x, y, w, h });
          expect(rect(fitted.card), where).toEqual(rect(laid.card));
        }
        expect(inside(fitted.label, fitted.card), where).toBe(true);
        expect(inside(fitted.text, fitted.card), where).toBe(true);
        expect(inside(fitted.text, SAFE), where).toBe(true);
      }
    });
  }
});

/*
 * A long callout in the image-text column (rulings 91 and 102): the card grows to hold it and the
 * body above gives up room; past that the text steps down one stop, never under the 24pt floor;
 * past that the callout is left off and reported. It is never clipped and never runs off its card.
 */
describe("a long callout in the image-text column", () => {
  for (const themeId of ["chalk", "exam-hall", "night-lab"] as const) {
    const theme = getTheme(themeId);
    for (const n of [80, 120, 160]) {
      it(`${themeId}/${n} characters: held whole by a card that fits, or left off and reported`, () => {
        const text = prose(n);
        const notes: string[] = [];
        const spec = imageText({ kind: "watch-out", text });
        const slide = materialiseSlide(spec, theme.id, meta, counter(), undefined, {}, (note) =>
          notes.push(note),
        );
        if (!slide.elements.some(isCalloutElement)) {
          expect(notes).toHaveLength(1);
          expect(notes[0]).toContain("callout dropped");
          return;
        }
        expect(notes).toEqual([]);
        const { card, label, text: textEl } = trio(slide);
        expect(plain(textEl)).toBe(text);
        expect(card.x).toBe(IMAGE_TEXT_COLUMN.x);
        expect(card.w).toBe(IMAGE_TEXT_COLUMN.w);
        expect(card.y + card.h).toBeLessThanOrEqual(CARD_BOTTOM);
        expect(inside(label, card)).toBe(true);
        expect(inside(textEl, card)).toBe(true);
        expect(inside(textEl, SAFE)).toBe(true);
        // At most one stop down, never under the floor.
        const full = theme.sizes.small;
        const size = textEl.style.fontSize ?? full;
        expect(size).toBeGreaterThanOrEqual(fontFloor("small"));
        expect(size).toBeGreaterThanOrEqual(
          stepDownSize(theme, "small", Math.max(full, fontFloor("small"))),
        );
        // The fitted slide has nothing past the safe area but the full-bleed picture.
        const again = fitSlide(slide, theme);
        const image = slide.elements.find((el) => el.type === "image");
        expect(again.overflow.filter((id) => id !== image?.id)).toEqual([]);
      });
    }
  }

  it("grows the card for 120 characters on chalk rather than running past it", () => {
    const text = prose(120);
    const laid = trio(laidWith(imageText({ kind: "example", text }), getTheme("chalk")));
    expect(laid.card.h).toBeGreaterThan(calloutHeight(getTheme("chalk"), 3));
  });

  it("leaves a callout off when even one stop down it cannot fit the room", () => {
    const theme = getTheme("chalk");
    expect(fitCallout(theme, prose(160), IMAGE_TEXT_COLUMN.w, 60)).toBeUndefined();
    const notes: string[] = [];
    const huge = {
      kind: "image-text",
      factRefs: ["o3"],
      heading: "Clouds",
      body: "Warm air rises.",
      callout: { kind: "example", text: prose(900) },
    } as SlideSpec;
    const slide = materialiseSlide(huge, theme.id, meta, counter(), undefined, {}, (n) =>
      notes.push(n),
    );
    expect(slide.elements.some(isCalloutElement)).toBe(false);
    expect(notes).toHaveLength(1);
  });
});

/*
 * A long body beside the card: `applyToImageText` reserves the body two lines, so a body that
 * measures three or four has to be re-fitted by `fitSlide` inside `materialiseSlide`. The stored
 * slide must still hold every text in its box and keep the callout whole or leave it off.
 */
describe("a long body over an image-text callout", () => {
  const BODIES = {
    three:
      "Warm air rises from the sea carrying water vapour, then cools as it climbs over the land.",
    four: "Warm air rises from the sea carrying water vapour, then cools as it climbs over the hills, and the vapour condenses into the grey cloud that brings the rain.",
  };
  for (const themeId of ["chalk", "exam-hall", "night-lab"] as const) {
    const theme = getTheme(themeId);
    for (const [label, body] of Object.entries(BODIES)) {
      for (const n of [80, 120]) {
        it(`${themeId}/${label}-line body/${n}-character callout: nothing outside its box, the callout held or left off`, () => {
          const notes: string[] = [];
          const spec: SlideSpec = {
            kind: "image-text",
            factRefs: ["o3"],
            heading: "Clouds over the sea",
            body,
            callout: { kind: "watch-out", text: prose(n) },
          };
          const slide = materialiseSlide(spec, theme.id, meta, counter(), undefined, {}, (note) =>
            notes.push(note),
          );
          const image = slide.elements.find((el) => el.type === "image");
          // Re-fitting the stored slide finds nothing past the safe area but the picture.
          expect(fitSlide(slide, theme).overflow.filter((id) => id !== image?.id)).toEqual([]);
          const texts = slide.elements.filter((el): el is TextElement => el.type === "text");
          for (const el of texts)
            expect(inside(el, SAFE), `${el.name ?? el.style.preset}`).toBe(true);
          if (!slide.elements.some(isCalloutElement)) {
            expect(notes).toHaveLength(1);
            return;
          }
          expect(notes).toEqual([]);
          const { card, label: cardLabel, text } = trio(slide);
          expect(plain(text)).toBe(prose(n));
          expect(inside(cardLabel, card)).toBe(true);
          expect(inside(text, card)).toBe(true);
          for (const el of texts) {
            if (isCalloutElement(el)) continue;
            const clear = el.y + el.h <= card.y || el.x + el.w <= card.x || el.x >= card.x + card.w;
            expect(clear, `${el.style.preset} clear of the card`).toBe(true);
          }
        });
      }
    }
  }
});

/*
 * A content slide with a photo slot and a callout (TEACH-19 with TEACH-75): the look lays the
 * words beside the slot first, then the card goes under the text column, never across the slot;
 * with no room left there it is left off and reported. It never overflows either way.
 */
describe("a callout beside a photo slot", () => {
  const photo = { subject: "Clouds over the sea", mustShow: ["cumulus"] };
  const bodies = {
    short: "The sun heats water until it evaporates. High up it cools and condenses into cloud.",
    long: "The sun heats water in seas, lakes and puddles until it evaporates into the air. The warm vapour rises, cools high up and condenses around specks of dust into tiny drops. Billions of drops together make a cloud, and when they join into bigger drops they fall as rain.",
  };
  for (const theme of THEMES) {
    for (const side of ["left", "right"] as const) {
      for (const [bodyName, body] of Object.entries(bodies)) {
        for (const { label: length, text } of LENGTHS) {
          it(`${theme.id}/${side}/${bodyName} body/${length}: under the words, clear of the slot, or left off and reported`, () => {
            const notes: string[] = [];
            const spec = { ...content({ kind: "watch-out", text }), body };
            const slide = materialiseSlide(
              spec,
              theme.id,
              meta,
              counter(),
              undefined,
              { photo, slotSide: side },
              (note) => notes.push(note),
            );
            const slot = slide.elements.find((el) => el.name === PHOTO_NAME);
            if (!slot) throw new Error("no photo slot");
            expect(fitSlide(slide, theme).overflow).toEqual([]);
            if (!slide.elements.some(isCalloutElement)) {
              expect(notes).toHaveLength(1);
              expect(notes[0]).toMatch(/^callout dropped/);
              return;
            }
            expect(notes).toEqual([]);
            const { card, label, text: textEl } = trio(slide);
            expect(inside(card, SAFE)).toBe(true);
            expect(card.y + card.h).toBe(CARD_BOTTOM);
            expect(inside(label, card)).toBe(true);
            expect(inside(textEl, card)).toBe(true);
            // Never across the slot: the card keeps to the other side of the gutter.
            const clear =
              card.x >= slot.x + slot.w + SPACE[5] || card.x + card.w <= slot.x - SPACE[5];
            expect(clear).toBe(true);
            // Every word in its column ends a gap above it.
            for (const el of slide.elements) {
              if (isCalloutElement(el) || el === slot || el.name === "Accent bar") continue;
              if (el.x >= card.x + card.w || el.x + el.w <= card.x) continue;
              expect(el.y + el.h + SPACE[2], el.name ?? el.type).toBeLessThanOrEqual(card.y);
            }
          });
        }
      }
    }
  }

  it("a short callout beside the slot always shows on every theme", () => {
    for (const theme of THEMES) {
      const slide = materialiseSlide(
        content({ kind: "example", text: SHORT }),
        theme.id,
        meta,
        counter(),
        undefined,
        { photo },
      );
      expect(slide.elements.filter(isCalloutElement)).toHaveLength(4);
    }
  });
});

/*
 * The callout is secondary (rulings 102, 106): the words keep exactly the size and shape they
 * have without it. A list is never flattened and type never steps down to make room for the card.
 */
describe("the words are the same with or without a callout", () => {
  const bodyOf = (slide: Slide) =>
    slide.elements
      .filter((el): el is TextElement => el.type === "text" && !isCalloutElement(el))
      .map((el) => ({
        name: el.name,
        x: el.x,
        y: el.y,
        w: el.w,
        h: el.h,
        size: el.style.fontSize,
        text: plain(el),
      }));
  const specs = {
    paragraph: content(),
    long: {
      ...content(),
      body: "The sun heats water in seas, lakes and puddles until it evaporates into the air. The warm vapour rises, cools high up and condenses around specks of dust into tiny drops. Billions of drops together make a cloud, and when they join into bigger drops they fall as rain.",
    },
    points: {
      ...content(),
      points: ["Heat makes water evaporate.", "Vapour cools and condenses.", "Drops fall as rain."],
    },
  } as Record<string, SlideSpec>;
  for (const theme of THEMES) {
    for (const [name, spec] of Object.entries(specs)) {
      for (const { label: length, text } of LENGTHS) {
        for (const structure of [{}, { photo: { subject: "Clouds" } }]) {
          const where = `${theme.id}/${name}/${length}/${"photo" in structure ? "photo" : "plain"}`;
          it(`${where}: identical body size, shape and element count`, () => {
            const without = materialiseSlide(spec, theme.id, meta, counter(), undefined, structure);
            const withCard = materialiseSlide(
              { ...spec, callout: { kind: "watch-out", text } } as SlideSpec,
              theme.id,
              meta,
              counter(),
              undefined,
              structure,
            );
            const rest = withCard.elements.filter((el) => !isCalloutElement(el));
            expect(rest.length).toBe(without.elements.length);
            expect(rest.map((el) => el.type)).toEqual(without.elements.map((el) => el.type));
            expect(bodyOf(withCard)).toEqual(bodyOf(without));
          });
        }
      }
    }
  }
});
