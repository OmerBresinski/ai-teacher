import { describe, expect, test } from "bun:test";
import { isContinuation, type Slide } from "@tj/domain/documents";
import { fitSlide } from "./fit-slide";
import { materialiseSlide, materialiseSlides } from "./materialise";
import type { SlideSpec, SlideSpecOf } from "./specs";
import { docLines } from "./structure";
import { floorBelow } from "./text-style";
import { getTheme } from "./themes";

/*
 * Generation-time continuation (UX ruling 91): a teaching slide whose words do not fit at or above
 * the body floor is materialised as the slides it needs, split at a sentence.
 */

const meta = { promptVersion: "t", model: "m", at: "2026-09-26T00:00:00.000Z" };
const theme = getTheme("chalk");
let n = 0;
const ids = () => `c${++n}`;

/** 85 words, as the writer now sets a full explanation (59 to 92 words a teaching slide). */
const LONG = [
  "Roman towns brought new buildings and new ways of life to many parts of Britain.",
  "People could visit public bath houses and busy markets, and some lived in homes built in Roman styles.",
  "Towns were laid out on a grid of straight streets, with a forum at the centre for trade and meetings.",
  "Some pupils think Roman rule changed everyone's life in the same way, but this is wrong.",
  "The changes depended on where people lived and what they chose to adopt from Roman life.",
].join(" ");
/** Half as long again: more than two slides' worth. */
const LONGER = [
  LONG,
  "Traders sold pottery, wine and olive oil brought from across the empire by road and by sea.",
  "Some Britons learned Latin, wore Roman clothes and worshipped Roman gods alongside their own.",
  "Others kept living in round houses in the countryside and farmed much as their families always had.",
].join(" ");

const spec = (body: string, extra: Partial<SlideSpecOf<"content">> = {}): SlideSpec => ({
  kind: "content",
  factRefs: ["o2", "k4"],
  heading: "Roman towns and daily life",
  body,
  notes: "Ask pupils which changes reached the countryside.",
  ...extra,
});

const heading = (slide: Slide) =>
  docLines(
    (slide.elements.find((e) => e.name === "Heading") as { doc: Parameters<typeof docLines>[0] })
      .doc,
  ).join(" ");
const words = (slides: Slide[]) =>
  slides
    .flatMap((s) =>
      s.elements
        .filter((e) => e.type === "text" && e.style.preset === "body")
        .flatMap((e) => (e.type === "text" ? docLines(e.doc) : [])),
    )
    .join(" ")
    .replace(/\s+/g, " ");

describe("materialiseSlides: a teaching slide too long for one slide continues", () => {
  test("an over-long body becomes two slides, each within the slide, split at a sentence", () => {
    const slides = materialiseSlides(spec(LONG), "chalk", meta, ids);
    expect(slides.length).toBe(2);
    for (const slide of slides) expect(fitSlide(slide, theme).overflow).toEqual([]);
    const [first, second] = slides as [Slide, Slide];
    expect(heading(first)).toBe("Roman towns and daily life");
    expect(heading(second)).toBe("Roman towns and daily life (continued)");
    expect(isContinuation(second, first)).toBe(true);
    // Every word once, in order; the first slide ends on a full stop.
    expect(words(slides)).toBe(LONG);
    expect(words([first]).trim()).toMatch(/\.$/);
    // Notes stay on the first slide; every element of both carries the spec's fact references.
    expect(first.notes).toBe("Ask pupils which changes reached the countryside.");
    expect(second.notes).toBeUndefined();
    for (const e of slides.flatMap((s) => s.elements)) {
      expect(e.generatedFrom?.factRefs).toEqual(["o2", "k4"]);
    }
    // Ids are unique across both slides and their elements.
    const all = slides.flatMap((s) => [s.id, ...s.elements.map((e) => e.id)]);
    expect(new Set(all).size).toBe(all.length);
  });

  test("a body too long for two slides continues again, evenly, never below the floor", () => {
    const slides = materialiseSlides(spec(LONGER), "chalk", meta, ids);
    expect(slides.length).toBeGreaterThanOrEqual(3);
    for (const slide of slides) expect(fitSlide(slide, theme).overflow).toEqual([]);
    for (const slide of slides.slice(1)) {
      expect(heading(slide)).toBe("Roman towns and daily life (continued)");
    }
    expect(words(slides)).toBe(LONGER);
    // No page below the floor, and no page a stub: the sentences shared out evenly.
    const bodies = slides.map((s) => s.elements.find((e) => e.name === "Body"));
    for (const b of bodies) {
      expect(b?.type === "text" && (b.style.fontSize ?? 0) >= floorBelow(theme, "body")).toBe(true);
    }
    const counts = slides.map((s) => words([s]).split(/(?<=\.) /).length);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  test("a split is balanced: a continuation is never one short sentence", () => {
    const slides = materialiseSlides(spec(LONG), "chalk", meta, ids);
    const counts = slides.map((s) => words([s]).split(/(?<=\.) /).length);
    expect(counts.length).toBe(2);
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(2);
  });

  test("a body that fits stays one slide, as materialiseSlide sets it", () => {
    const short = "Roman towns brought new buildings. People visited bath houses and markets.";
    const slides = materialiseSlides(spec(short), "chalk", meta, ids);
    expect(slides.length).toBe(1);
    expect(fitSlide(slides[0] as Slide, theme).overflow).toEqual([]);
    const one = materialiseSlide(spec(short), "chalk", meta, ids);
    expect(one.elements.map((e) => e.name)).toEqual(
      (slides[0] as Slide).elements.map((e) => e.name),
    );
  });

  test("materialiseSlide still makes one slide of an over-long body (the editor's Tidy continues it)", () => {
    const one = materialiseSlide(spec(LONG), "chalk", meta, ids);
    expect(heading(one)).toBe("Roman towns and daily life");
  });

  test("a diagram slide too long for its column gives up the slot and continues across the full measure", () => {
    const slides = materialiseSlides(
      spec(LONGER, { diagram: "Plan of a Roman town: forum, baths, grid of streets" }),
      "chalk",
      meta,
      ids,
    );
    expect(slides.length).toBeGreaterThanOrEqual(2);
    for (const slide of slides) expect(fitSlide(slide, theme).overflow).toEqual([]);
    // Too long to sit beside the drawing at the body size: the slot gives way, and its
    // instruction goes to the first slide's notes.
    expect(slides.some((s) => s.elements.some((e) => e.name === "Diagram placeholder"))).toBe(
      false,
    );
    expect(slides[0]?.notes).toContain("Plan of a Roman town");
    expect(words(slides)).toBe(LONGER);
  });

  test("a list too long for one slide keeps its lead and first points, then the rest as a list", () => {
    const points = [
      "Bath houses gave people a place to wash, relax and meet friends from across the town every day.",
      "Markets sold pottery, wine and olive oil carried from distant parts of the empire by road and sea.",
      "Straight roads linked the towns, so soldiers, traders and messages moved much faster than before.",
      "Temples to Roman gods stood beside older shrines, and many Britons worshipped at both of them.",
      "Villas in the countryside had mosaic floors, heated rooms and gardens laid out in the Roman way.",
    ];
    const lead =
      "Roman towns changed daily life for many Britons in ways that pupils can still see in the remains today. Each change reached some people more than others.";
    const slides = materialiseSlides(spec(lead, { points }), "chalk", meta, ids);
    expect(slides.length).toBe(2);
    for (const slide of slides) expect(fitSlide(slide, theme).overflow).toEqual([]);
    const shown = (s: Slide) =>
      s.elements
        .filter((e) => e.name === "Point")
        .map((e) => (e.type === "text" ? docLines(e.doc).join(" ") : ""));
    const [first, second] = slides as [Slide, Slide];
    // Every point once, in order, the first slide under the lead and the rest continued.
    expect([...shown(first), ...shown(second)]).toEqual(points);
    expect(shown(first).length).toBeGreaterThanOrEqual(2);
    expect(shown(second).length).toBeGreaterThanOrEqual(2);
    expect(words([first])).toContain("Roman towns changed daily life");
    expect(words([second])).not.toContain("Roman towns changed daily life");
    expect(heading(second)).toBe("Roman towns and daily life (continued)");
  });

  test("a question kind is never continued here", () => {
    const quiz = materialiseSlides(
      {
        kind: "exit-ticket",
        factRefs: [],
        heading: "Exit ticket",
        items: ["What did Roman towns have at their centre?", "Name one thing sold in markets."],
      } as never,
      "chalk",
      meta,
      ids,
    );
    expect(quiz.length).toBe(1);
  });
});
