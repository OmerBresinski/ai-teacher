import { describe, expect, test } from "bun:test";
import type { Slide, SlideElement, TextElement } from "@tj/domain/documents";
import { buildEndAnswers, relayEndAnswers } from "./relayout";
import { ANSWERS_NAMES } from "./templates/end-answers";
import { atKeyStage, getTheme } from "./themes";

/*
 * TEACH-215 part l: Answers slides saved before the kicker was a caption hold the old builder's
 * body kicker. Unedited, they still rebuild on a theme switch; a kicker the teacher changed
 * (colour, words, preset, an added format) marks the slides as theirs, and they are kept.
 */
const para = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
const LESSON: Slide[] = [
  {
    id: "s1",
    kind: "open-response",
    elements: [
      {
        id: "h1",
        type: "text",
        name: "Heading",
        x: 64,
        y: 46,
        w: 832,
        h: 54,
        doc: para("Explain this street"),
        style: { preset: "heading" },
      } as SlideElement,
    ],
    question: {
      type: "open-response",
      modelAnswer: "1. Wood burned easily.\n2. Wind carried sparks.",
    },
  } as Slide,
  {
    id: "s2",
    kind: "exit-ticket",
    elements: [
      {
        id: "h2",
        type: "text",
        name: "Heading",
        x: 64,
        y: 46,
        w: 832,
        h: 54,
        doc: para("Show what you know"),
        style: { preset: "heading" },
      } as SlideElement,
    ],
    question: {
      type: "open-response",
      modelAnswer: "1. Houses were close.\n2. Buckets were slow.",
    },
  } as Slide,
];
const from = atKeyStage(getTheme("paper", null), "ks1");
const to = atKeyStage(getTheme("dark-slate", null), "ks1");

/** The deck as the builder before part l saved it: each kicker set as body at the body step. */
function savedBeforePartL(edit: (k: TextElement) => TextElement = (k) => k): Slide[] {
  return [...LESSON, ...buildEndAnswers(LESSON, from, "ks1")].map((s) => ({
    ...s,
    elements: s.elements.map((e) => {
      if (e.type !== "text" || e.name !== ANSWERS_NAMES.kicker) return e;
      const old: TextElement = { ...e, style: { ...e.style, preset: "body", fontSize: 28 } };
      return edit(old);
    }),
  }));
}
const relay = (saved: Slide[]) => relayEndAnswers(saved, from, "ks1", saved, to, "ks1");

describe("a theme switch and Answers slides saved with the body kicker", () => {
  test("unedited: built again in the new theme, the kicker a caption", () => {
    const out = relay(savedBeforePartL());
    expect(out).not.toBeNull();
    const kickers = (out ?? [])
      .flatMap((s) => s.elements)
      .filter((e) => e.name === ANSWERS_NAMES.kicker);
    expect(kickers.length).toBeGreaterThan(0);
    for (const k of kickers) expect(k.type === "text" && k.style?.preset).toBe("caption");
  });

  const EDITS: [string, (k: TextElement) => TextElement][] = [
    ["its colour", (k) => ({ ...k, style: { ...k.style, color: "#123456" } })],
    ["its words", (k) => ({ ...k, doc: para("HOMEWORK") as TextElement["doc"] })],
    ["its preset", (k) => ({ ...k, style: { ...k.style, preset: "heading" } })],
    ["an added format", (k) => ({ ...k, style: { ...k.style, align: "center" } })],
    ["its weight", (k) => ({ ...k, style: { ...k.style, fontWeight: 400 } })],
  ];
  for (const [what, edit] of EDITS)
    test(`a teacher's edit to ${what} keeps the slides as they are`, () => {
      expect(relay(savedBeforePartL(edit))).toBeNull();
    });
});
