import { describe, expect, test } from "bun:test";
import type { RichDoc, Slide, SlideElement, TextElement } from "@tj/domain/documents";
import { docFromBullets, docFromText } from "../model/factories";
import { BASELINE, SAFE } from "../model/grid";
import { docFromNumbered } from "../model/layouts";
import { fontFloor, getTheme } from "../model/themes";
import {
  docLineCount,
  type MeasureInput,
  reflowSlide,
  SAFE_BOTTOM,
  splitDocToFit,
  splitListElement,
  stepDownSize,
  withSafety,
} from "./reflow";
import { rulerFor } from "./test-ruler";

/*
 * The fitting engine's pure half, stage by stage (TeachDeck `lib/__tests__/layout-reflow.test.ts`,
 * TEACH-113 gap analysis): fit, push down, step down, split, and the two doc splitters the tidy
 * uses to build a continuation slide. `tidy.test.ts` covers the same engine through `tidySlide`;
 * these pin the engine's own contract — what moved, what stepped, where it would split.
 */

const theme = getTheme("chalk");
const ruler = rulerFor(theme);

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

function textEl(
  id: string,
  over: Partial<TextElement> & Pick<TextElement, "x" | "y" | "w" | "h">,
): TextElement {
  const { x, y, w, h, ...rest } = over;
  return {
    id,
    type: "text",
    x,
    y,
    w,
    h,
    doc: docFromText("Short"),
    style: { preset: "body", autoHeight: true },
    ...rest,
  };
}

const slideOf = (elements: SlideElement[]): Slide => ({ id: "sl", kind: "content", elements });

function byId(elements: SlideElement[], id: string): SlideElement {
  const found = elements.find((e) => e.id === id);
  if (!found) throw new Error(`no element ${id}`);
  return found;
}

const fontSizeOf = (el: SlideElement) => (el.type === "text" ? el.style.fontSize : undefined);

describe("reflowSlide — fit", () => {
  test("sets an auto-height box to exactly its measured content, so the renderer agrees", () => {
    const el = textEl("a", { x: SAFE.x, y: SAFE.y, w: 400, h: 30, doc: docFromText(words(30)) });
    const { elements } = reflowSlide(slideOf([el]), theme, ruler);
    const measured = ruler({
      doc: el.doc,
      width: 400,
      style: el.style,
      preset: "body",
      fontSize: theme.sizes.body,
      inset: 0,
      chrome: 0,
    });
    // The 4% cushion is spent as clearance below the box, never stored in it: in edit mode the
    // auto-height owner would revert anything else and every tidy would walk the slide down.
    expect(byId(elements, "a").h).toBe(Math.round(measured));
  });

  test("is idempotent: tidying a tidy slide changes nothing", () => {
    const slide = slideOf([
      textEl("a", { x: SAFE.x, y: SAFE.y, w: 500, h: 30, doc: docFromText(words(12)) }),
      textEl("b", { x: SAFE.x, y: 220, w: 500, h: 30, doc: docFromText(words(8)) }),
    ]);
    const once = reflowSlide(slide, theme, ruler);
    const twice = reflowSlide(slideOf(once.elements), theme, ruler);
    expect(twice.elements.map((e) => [e.id, e.y, e.h])).toEqual(
      once.elements.map((e) => [e.id, e.y, e.h]),
    );
    expect(twice.moved).toEqual([]);
  });

  test("a fixed-height box keeps its authored height", () => {
    const fixed = textEl("f", {
      x: SAFE.x,
      y: SAFE.y,
      w: 400,
      h: 30,
      style: { preset: "body", autoHeight: false },
      doc: docFromText(words(60)),
    });
    expect(byId(reflowSlide(slideOf([fixed]), theme, ruler).elements, "f").h).toBe(30);
  });
});

describe("reflowSlide — push down", () => {
  test("pushes a colliding element down, keeping the authored gap, on the 7pt rhythm", () => {
    const a = textEl("a", { x: SAFE.x, y: 60, w: 500, h: 40, doc: docFromText(words(40)) });
    const b = textEl("b", { x: SAFE.x, y: 120, w: 500, h: 40, doc: docFromText("Short") });
    const { elements, moved } = reflowSlide(slideOf([a, b]), theme, ruler);
    const A = byId(elements, "a");
    const B = byId(elements, "b");
    expect(A.y).toBe(60); // the first block never moves
    expect(A.h).toBeGreaterThan(40);
    // The authored gap was 120 - 100 = 20, kept below the grown box plus its 4% cushion.
    expect(B.y).toBeGreaterThanOrEqual(A.y + withSafety(A.h) + 20);
    expect(B.y % BASELINE).toBe(0);
    expect(moved).toEqual(["b"]);
  });

  test("does not creep: pushing twice lands in the same place", () => {
    const a = textEl("a", { x: SAFE.x, y: 60, w: 500, h: 40, doc: docFromText(words(40)) });
    const b = textEl("b", { x: SAFE.x, y: 120, w: 500, h: 40, doc: docFromText("Short") });
    const once = reflowSlide(slideOf([a, b]), theme, ruler);
    const twice = reflowSlide(slideOf(once.elements), theme, ruler);
    expect(twice.moved).toEqual([]);
    expect(byId(twice.elements, "b").y).toBe(byId(once.elements, "b").y);
  });

  test("leaves side-by-side boxes alone: no horizontal overlap, no push", () => {
    const left = textEl("l", { x: 58, y: 100, w: 400, h: 40, doc: docFromText(words(40)) });
    const right = textEl("r", { x: 500, y: 160, w: 400, h: 40, doc: docFromText("Short") });
    const { elements, moved } = reflowSlide(slideOf([left, right]), theme, ruler);
    expect(byId(elements, "r").y).toBe(160);
    expect(moved).toEqual([]);
  });

  test("never moves a locked element or an image, but pushes past them", () => {
    const image: SlideElement = {
      id: "img",
      type: "image",
      x: 58,
      y: 100,
      w: 400,
      h: 100,
      src: "x",
      fit: "cover",
    };
    const locked = textEl("lk", {
      x: 58,
      y: 60,
      w: 400,
      h: 30,
      locked: true,
      doc: docFromText(words(40)),
    });
    const below = textEl("b", { x: 58, y: 220, w: 400, h: 30, doc: docFromText("Short") });
    const { elements } = reflowSlide(slideOf([locked, image, below]), theme, ruler);
    expect(byId(elements, "lk").y).toBe(60);
    expect(byId(elements, "lk").h).toBe(30); // locked keeps its authored height too
    expect(byId(elements, "img").y).toBe(100);
    expect(byId(elements, "b").y).toBeGreaterThanOrEqual(200); // below the image
  });

  test("separates two text blocks that already overlap, which is the whole point", () => {
    // The state a slide arrives in: auto-height has already grown the first box into the second,
    // so there is no authored gap left to preserve.
    const a = textEl("a", { x: 58, y: 100, w: 400, h: 120, doc: docFromText(words(30)) });
    const b = textEl("b", { x: 58, y: 160, w: 400, h: 40, doc: docFromText("Short") });
    const { elements, moved } = reflowSlide(slideOf([a, b]), theme, ruler);
    const A = byId(elements, "a");
    const B = byId(elements, "b");
    expect(moved).toEqual(["b"]);
    expect(B.y).toBeGreaterThanOrEqual(A.y + A.h);
    expect(reflowSlide(slideOf(elements), theme, ruler).moved).toEqual([]); // and it settles
  });

  test("leaves a hairline rule in the flow: it travels with the blocks it separates", () => {
    const rule: SlideElement = {
      id: "rule",
      type: "shape",
      shape: "rect",
      x: 58,
      y: 160,
      w: 400,
      h: 1,
    };
    const a = textEl("a", { x: 58, y: 100, w: 400, h: 120, doc: docFromText(words(30)) });
    const { elements, moved } = reflowSlide(slideOf([a, rule]), theme, ruler);
    expect(moved).toEqual(["rule"]);
    expect(byId(elements, "rule").y).toBeGreaterThanOrEqual(byId(elements, "a").h + 100);
  });

  test("does not 'fix' deliberate layering: a label sitting on a shape stays put", () => {
    const card: SlideElement = {
      id: "card",
      type: "shape",
      shape: "rounded",
      x: 58,
      y: 100,
      w: 400,
      h: 120,
    };
    const label = textEl("label", {
      x: 78,
      y: 120,
      w: 360,
      h: 40,
      doc: docFromText("On the card"),
    });
    const { elements, moved } = reflowSlide(slideOf([card, label]), theme, ruler);
    expect(byId(elements, "label").y).toBe(120);
    expect(moved).toEqual([]);
  });

  test("option cards in one row share the tallest height, so the row never goes ragged", () => {
    const option = (id: string, x: number, text: string): SlideElement => ({
      id,
      type: "option",
      x,
      y: 300,
      w: 400,
      h: 60,
      doc: docFromText(text),
      label: id.toUpperCase(),
    });
    const slide: Slide = {
      ...slideOf([option("a", 58, "Short"), option("b", 502, words(24))]),
      question: { type: "multiple-choice", options: [] },
    };
    const { elements } = reflowSlide(slide, theme, ruler);
    expect(byId(elements, "a").h).toBe(byId(elements, "b").h);
    expect(byId(elements, "a").h).toBeGreaterThan(60);
  });
});

describe("reflowSlide — step down", () => {
  test("steps body type down one stop when the slide overruns the safe area", () => {
    const el = textEl("a", {
      x: SAFE.x,
      y: SAFE.y,
      w: SAFE.w,
      h: 40,
      doc: docFromText(words(220)),
    });
    const { elements, stepped } = reflowSlide(slideOf([el]), theme, ruler);
    const size = fontSizeOf(byId(elements, "a"));
    expect(stepped).toContain("a");
    expect(size).toBeDefined();
    expect(size ?? 0).toBeLessThan(theme.sizes.body);
    expect(size ?? 0).toBeGreaterThanOrEqual(fontFloor("body"));
  });

  test("never steps a caption, and never below the legibility floor", () => {
    expect(stepDownSize(theme, "body", theme.sizes.body)).toBeGreaterThanOrEqual(fontFloor("body"));
    expect(stepDownSize(theme, "small", fontFloor("small"))).toBe(fontFloor("small"));
    const caption = textEl("c", {
      x: SAFE.x,
      y: SAFE.y,
      w: SAFE.w,
      h: 20,
      style: { preset: "caption", autoHeight: true },
      doc: docFromText(words(400)),
    });
    const { elements, stepped } = reflowSlide(slideOf([caption]), theme, ruler);
    expect(stepped).not.toContain("c");
    expect(fontSizeOf(byId(elements, "c"))).toBeUndefined();
  });

  test("leaves a fitting slide at its authored size", () => {
    const el = textEl("a", {
      x: SAFE.x,
      y: SAFE.y,
      w: SAFE.w,
      h: 40,
      doc: docFromText("Two short words"),
    });
    const { stepped, overflow, splitAt, laneOverflow } = reflowSlide(slideOf([el]), theme, ruler);
    expect(stepped).toEqual([]);
    expect(overflow).toEqual([]);
    expect(laneOverflow).toEqual([]);
    expect(splitAt).toBeUndefined();
  });

  test("a reserved lane (fitBottom) steps the type down and reports laneOverflow, never overflow", () => {
    // Enough copy to run into a lane held back for the "Why?" panel, but not off the slide.
    const el = textEl("a", { x: SAFE.x, y: SAFE.y, w: SAFE.w, h: 40, doc: docFromText(words(60)) });
    const plain = reflowSlide(slideOf([el]), theme, ruler);
    expect(plain.overflow).toEqual([]);
    expect(plain.stepped).toEqual([]);
    const lane = SAFE_BOTTOM - 200;
    const kept = reflowSlide(slideOf([el]), theme, ruler, { fitBottom: lane });
    expect(kept.overflow).toEqual([]);
    expect(kept.splitAt).toBeUndefined();
    const a = byId(kept.elements, "a");
    const stepped = kept.stepped.includes("a");
    const clear = a.y + withSafety(a.h) <= lane + 0.5;
    // Either the step-down bought the room, or what is left standing in the lane is named.
    expect(stepped || clear).toBe(true);
    expect(kept.laneOverflow).toEqual(clear ? [] : ["a"]);
  });
});

describe("reflowSlide — split", () => {
  test("reports splitAt for the first element that still does not fit", () => {
    const heading = textEl("h", {
      x: SAFE.x,
      y: SAFE.y,
      w: SAFE.w,
      h: 40,
      style: { preset: "heading", autoHeight: true },
      doc: docFromText("Learning objectives"),
    });
    const list = textEl("list", {
      x: SAFE.x,
      y: 140,
      w: SAFE.w,
      h: 40,
      doc: docFromNumbered(
        Array.from({ length: 24 }, (_, i) => `Objective number ${i + 1} for this lesson`),
      ),
    });
    const { splitAt, overflow, elements } = reflowSlide(slideOf([heading, list]), theme, ruler);
    expect(splitAt).toBe(1);
    expect(overflow).toContain("list");
    const placed = elements[1];
    expect(placed).toBeDefined();
    expect((placed?.y ?? 0) + (placed?.h ?? 0)).toBeGreaterThan(SAFE_BOTTOM);
  });
});

describe("splitListElement", () => {
  const firstNode = (doc: RichDoc) => doc.content?.[0];

  test("splits a numbered list and continues the numbering", () => {
    const doc = docFromNumbered(["One", "Two", "Three", "Four", "Five"]);
    const { head, tail } = splitListElement(doc, 3);
    expect(tail).not.toBeNull();
    if (!tail) return;
    expect(docLineCount(head)).toBe(3);
    expect(docLineCount(tail)).toBe(2);
    expect(firstNode(head)?.attrs?.start).toBe(1);
    expect(firstNode(tail)?.attrs?.start).toBe(4);
    expect(firstNode(tail)?.type).toBe("orderedList");
  });

  test("splits a bullet list without inventing a start attribute", () => {
    const doc = docFromBullets(["a", "b", "c"]);
    const { head, tail } = splitListElement(doc, 1);
    expect(tail).not.toBeNull();
    if (!tail) return;
    expect(docLineCount(head)).toBe(1);
    expect(docLineCount(tail)).toBe(2);
    expect(firstNode(tail)?.type).toBe("bulletList");
    expect(firstNode(tail)?.attrs?.start).toBeUndefined();
  });

  test("splits plain paragraphs on their blocks", () => {
    const doc = docFromText("one\ntwo\nthree");
    const { head, tail } = splitListElement(doc, 2);
    expect(tail).not.toBeNull();
    if (!tail) return;
    expect(docLineCount(head)).toBe(2);
    expect(docLineCount(tail)).toBe(1);
  });

  test("returns no tail when the split point is out of range", () => {
    const doc = docFromNumbered(["One", "Two"]);
    expect(splitListElement(doc, 0).tail).toBeNull();
    expect(splitListElement(doc, 2).tail).toBeNull();
    expect(splitListElement(doc, 9).tail).toBeNull();
  });
});

describe("splitDocToFit", () => {
  const base: Omit<MeasureInput, "doc"> = {
    width: SAFE.w,
    preset: "body",
    fontSize: theme.sizes.body,
    inset: 0,
    chrome: 0,
  };

  test("keeps the whole doc when it already fits", () => {
    const doc = docFromNumbered(["One", "Two"]);
    const { tail, lines } = splitDocToFit(doc, base, 400, ruler);
    expect(tail).toBeNull();
    expect(lines).toBe(2);
  });

  test("carries the overspill into the tail", () => {
    const doc = docFromNumbered(Array.from({ length: 12 }, (_, i) => `Objective ${i + 1}`));
    const { head, tail, lines } = splitDocToFit(doc, base, 200, ruler);
    expect(tail).not.toBeNull();
    if (!tail) return;
    expect(docLineCount(head)).toBe(lines);
    expect(docLineCount(head) + docLineCount(tail)).toBe(12);
    expect(ruler({ ...base, doc: head })).toBeLessThanOrEqual(200);
  });

  test("never produces an empty head", () => {
    const doc = docFromNumbered(["A very long objective indeed", "Another one"]);
    const { head } = splitDocToFit(doc, base, 1, ruler);
    expect(docLineCount(head)).toBe(1);
  });
});
