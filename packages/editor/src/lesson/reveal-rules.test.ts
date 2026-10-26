/**
 * The reveal rules of a slide being written (Greg 26 Oct: "the layouts seem to update before text
 * comes in"): a region appears when its own content starts arriving. The title types first; a box,
 * card or answer area shows with the first word inside it; a picture box with the slide's first
 * word, never before; a draft with no words is a blank slide, never an empty layout.
 */
import { describe, expect, test } from "bun:test";
import type { Slide } from "@tj/domain/documents";
import { CATCH_UP_STEPS, catchUpStep, revealSlide, wordCount } from "./live-draft";

// A draft whose layout came before any word keeps the ruled outline in `LiveSlide` (ruling 278);
// `revealSlide` itself never draws an empty layout.

const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
const text = (id: string, name: string, t: string, x: number, y: number, w = 400, h = 40) => ({
  id,
  type: "text",
  name,
  x,
  y,
  w,
  h,
  doc: doc(t),
});
const shape = (id: string, name: string, x: number, y: number, w: number, h: number) => ({
  id,
  type: "shape",
  shape: "rounded",
  name,
  x,
  y,
  w,
  h,
});
const image = (id: string, x: number, y: number, w: number, h: number) => ({
  id,
  type: "image",
  name: "Photo",
  src: "placeholder",
  x,
  y,
  w,
  h,
});
const slideOf = (elements: unknown[]) =>
  ({ id: "s7", kind: "content", elements }) as unknown as Slide;
const ids = (s: Slide) => s.elements.map((e) => e.id);

// The quiz the judge saw (32.06 s): the answer area is the first element (the slide's back layer),
// the question types under the heading, the options sit inside the answer area.
const quiz = slideOf([
  shape("area", "surface field", 60, 260, 840, 260),
  text("title", "Heading", "Which part holds the plant up?", 60, 40, 840, 60),
  text("stem", "Stem", "Look at the picture and choose.", 60, 140, 840, 40),
  text("a", "Option", "Roots", 100, 300, 300, 40),
  text("b", "Option", "Stem", 500, 300, 300, 40),
]);

describe("revealSlide", () => {
  test("a draft with no words shows nothing: never an empty layout", () => {
    expect(revealSlide(quiz, 0).slide.elements).toEqual([]);
    const photo = slideOf([image("pic", 500, 120, 400, 300), text("title", "Heading", "", 60, 40)]);
    expect(revealSlide(photo, 0).slide.elements).toEqual([]);
  });

  test("the title types first, wherever it sits in the element list", () => {
    const s = slideOf([
      text("lead", "Lead", "Roots take in water.", 60, 200),
      text("title", "Heading", "Roots", 60, 40),
    ]);
    const one = revealSlide(s, 1);
    expect(ids(one.slide)).toEqual(["title"]);
    expect(one.at).toBe("title");
    const two = revealSlide(s, 2);
    expect(ids(two.slide)).toEqual(["lead", "title"]);
    expect(two.at).toBe("lead");
  });

  test("the answer area waits for its own first word, not the question's", () => {
    const titleWords = 6;
    const stemWords = 6;
    // While the title and the question type, the empty answer area is not drawn.
    for (let n = 1; n <= titleWords + stemWords; n++)
      expect(ids(revealSlide(quiz, n).slide)).not.toContain("area");
    // The first option word arrives: the area comes with it.
    expect(ids(revealSlide(quiz, titleWords + stemWords + 1).slide)).toEqual([
      "area",
      "title",
      "stem",
      "a",
    ]);
  });

  test("a card holding text in a group shows with its words (children laid relative to it)", () => {
    const s = slideOf([
      text("title", "Heading", "Look closely", 60, 40),
      {
        id: "cards",
        type: "group",
        x: 60,
        y: 200,
        w: 840,
        h: 200,
        children: [
          shape("card1", "Card", 0, 0, 400, 200),
          text("c1", "Card text", "Find the roots.", 20, 20, 360, 40),
          shape("card2", "Card", 440, 0, 400, 200),
          text("c2", "Card text", "Find the stem.", 460, 20, 360, 40),
        ],
      },
    ]);
    expect(ids(revealSlide(s, 2).slide)).toEqual(["title"]);
    const first = revealSlide(s, 3).slide;
    const group = first.elements[1] as unknown as { children: { id: string }[] };
    expect(group.children.map((c) => c.id)).toEqual(["card1", "c1"]);
    // The second card stays off until its own first word.
    const second = revealSlide(s, 5).slide.elements[1] as unknown as { children: { id: string }[] };
    expect(second.children.map((c) => c.id)).toEqual(["card1", "c1"]);
    const third = revealSlide(s, 6).slide.elements[1] as unknown as { children: { id: string }[] };
    expect(third.children.map((c) => c.id)).toEqual(["card1", "c1", "card2", "c2"]);
  });

  test("a picture box comes with the slide's first word (the title), never before it", () => {
    const s = slideOf([
      image("pic", 500, 120, 400, 300),
      text("title", "Heading", "Four plant parts", 60, 40),
      text("cap", "Caption", "Say each name and point to it.", 60, 440),
    ]);
    expect(ids(revealSlide(s, 0).slide)).toEqual([]);
    expect(ids(revealSlide(s, 1).slide)).toEqual(["pic", "title"]);
  });

  test("a shape with no words in it (a rule, an accent) comes with the next text in reading order", () => {
    const s = slideOf([
      text("title", "Heading", "Stems", 60, 40),
      shape("rule", "Divider", 60, 120, 840, 4),
      text("lead", "Lead", "Stems hold the plant up.", 60, 200),
    ]);
    expect(ids(revealSlide(s, 1).slide)).toEqual(["title"]);
    expect(ids(revealSlide(s, 2).slide)).toEqual(["title", "rule", "lead"]);
  });

  test("a slide with no text box (a picture, shapes) shows every region at once", () => {
    const s = slideOf([image("pic", 100, 60, 760, 420), shape("frame", "Frame", 90, 50, 780, 440)]);
    expect(ids(revealSlide(s, 0).slide)).toEqual(["pic", "frame"]);
  });

  test("a shape with no text after it comes with the title, not only at the end", () => {
    const s = slideOf([
      text("title", "Heading", "Stems", 60, 40),
      text("lead", "Lead", "Stems hold the plant up.", 60, 120),
      shape("foot", "Accent", 0, 520, 960, 20),
    ]);
    expect(ids(revealSlide(s, 1).slide)).toEqual(["title", "foot"]);
  });

  test("each picture and badge in a row comes with its own label, one by one (judge 638)", () => {
    // Match the parts: four pictures, a badge under each, a label under each badge.
    const els: unknown[] = [text("title", "Heading", "Match the parts", 60, 30, 840, 50)];
    const names = ["leaves", "roots", "flowers", "stem"];
    names.forEach((n, i) => {
      const x = 70 + i * 210;
      els.push(image(`p${i}`, x, 190, 184, 138));
      els.push(shape(`b${i}`, "Badge", x + 80, 340, 24, 24));
      els.push(text(`l${i}`, "Label", `${i + 1} ${n}`, x, 380, 184, 30));
    });
    const s = slideOf(els);
    // Title out (3 words): no picture box stands empty before its label.
    expect(ids(revealSlide(s, 3).slide)).toEqual(["title"]);
    // The first label's first word: its picture and badge with it, the others still to come.
    expect(ids(revealSlide(s, 4).slide)).toEqual(["title", "p0", "b0", "l0"]);
    expect(ids(revealSlide(s, 6).slide)).toEqual(["title", "p0", "b0", "l0", "p1", "b1", "l1"]);
  });

  test("the slide's visual zone (a big picture) comes with the title, before its caption (judge 638b)", () => {
    const s = slideOf([
      text("title", "Heading", "Four plant parts", 60, 30, 840, 50),
      image("fig", 264, 125, 432, 324),
      text("cap", "Caption", "Say each part as you point.", 264, 460, 432, 30),
    ]);
    expect(ids(revealSlide(s, 1).slide)).toEqual(["title", "fig"]);
  });

  test("every word out: the whole slide, no caret", () => {
    const all = revealSlide(quiz, wordCount(quiz));
    expect(ids(all.slide)).toEqual(ids(quiz));
    expect(all.at).toBeUndefined();
  });
});

describe("catch-up typing", () => {
  test("a slide written whole types in within the same few steps, whatever its length", () => {
    for (const total of [1, 5, 18, 40, 120]) {
      const steps = Math.ceil(total / catchUpStep(total));
      expect(steps).toBeLessThanOrEqual(CATCH_UP_STEPS);
      expect(catchUpStep(total)).toBeGreaterThanOrEqual(1);
    }
  });
});
