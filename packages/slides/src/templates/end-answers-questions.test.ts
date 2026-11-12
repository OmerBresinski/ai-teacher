import { describe, expect, test } from "bun:test";
import type { Slide, SlideElement } from "@tj/domain/documents";
import { endAnswersUntouched } from "../relayout";
import { THEMES } from "../themes";
import {
  ANSWERS_NAMES,
  answerGroupsOf,
  endAnswerSlides,
  shortQuestion,
  withoutQuestions,
} from "./end-answers";
import { layoutTemplate } from "./index";

/*
 * CRITIQUE-2 (12 Nov): the Answers slides showed "1 ? 2 ?" and, once revealed, only the answers,
 * so a class marking its work could not tell which question an answer belonged to. Each answer
 * now carries its question's short text, shown from the start; only the answer waits its step.
 */
const paper = THEMES.find((t) => t.id === "paper") ?? (THEMES[0] as (typeof THEMES)[number]);
const deck = (): Slide[] =>
  [
    layoutTemplate(
      {
        template: "practice",
        heading: "Practise and stretch",
        questions: [
          "Share 14 m of ribbon into 4 equal pieces. Use 3 pieces. How long is that?",
          "A 13 m ribbon loses 2/5 of its length. Then 1 m more is cut off. How much remains?",
        ],
        answers: ["10 1/2 m", "6 4/5 m"],
      },
      paper,
      "ks2",
    ),
    layoutTemplate(
      {
        template: "exit-ticket",
        heading: "Exit ticket",
        questions: ["What is 2/5 of 9?", "A 10 m rope has 1/4 cut off. How much is left?"],
        answers: ["3 3/5", "7 1/2 m"],
      },
      paper,
      "ks2",
    ),
  ].map((r, i) => ({ id: `s${i}`, ...r.slide }) as Slide);

const words = (e: SlideElement): string => {
  const walk = (n: unknown): string =>
    !n || typeof n !== "object"
      ? ""
      : "text" in n && typeof n.text === "string"
        ? n.text
        : "content" in n && Array.isArray(n.content)
          ? n.content.map(walk).join("")
          : "";
  return walk("doc" in e ? e.doc : undefined);
};

describe("short question text", () => {
  test("a question of up to 16 words is shown whole", () => {
    expect(shortQuestion("What is 2/5 of 9?")).toBe("What is 2/5 of 9?");
    expect(shortQuestion("  A 10 m rope has 1/4 cut off.   How much is left? ")).toBe(
      "A 10 m rope has 1/4 cut off. How much is left?",
    );
  });
  test("a longer one keeps its first sentence, or its first 12 words, then an ellipsis", () => {
    expect(
      shortQuestion(
        "A 13 m ribbon loses 2/5 of its length. Then 1 m more is cut off from the end. How much ribbon remains now?",
      ),
    ).toBe("A 13 m ribbon loses 2/5 of its length …");
    expect(
      shortQuestion(
        "One row of wooden houses has small gaps between them and another row has a wide gap where houses were pulled down, so which row is safer?",
      ),
    ).toBe("One row of wooden houses has small gaps between them and another …");
  });
});

describe("answers carry their questions", () => {
  test("each practice and exit answer gets its task's words", () => {
    const groups = answerGroupsOf(deck());
    expect(groups.map((g) => g.items.map((it) => it.q))).toEqual([
      [
        "Share 14 m of ribbon into 4 equal pieces. Use 3 pieces. How long is that?",
        // 17 words: its first sentence stands for it.
        "A 13 m ribbon loses 2/5 of its length …",
      ],
      ["What is 2/5 of 9?", "A 10 m rope has 1/4 cut off. How much is left?"],
    ]);
  });

  test("the question shows from the start and sits above its answer; only the answer reveals", () => {
    const slides = endAnswerSlides(answerGroupsOf(deck()), paper, "ks2");
    const answers = slides.filter((s) => s.answersRole === "answers");
    const all = answers.flatMap((s) => s.elements);
    const qs = all.filter((e) => e.name === ANSWERS_NAMES.question);
    expect(qs.map(words)).toEqual([
      "Share 14 m of ribbon into 4 equal pieces. Use 3 pieces. How long is that?",
      "A 13 m ribbon loses 2/5 of its length …",
      "What is 2/5 of 9?",
      "A 10 m rope has 1/4 cut off. How much is left?",
    ]);
    for (const q of qs) expect(q.revealStep).toBeUndefined();
    const shown = all.filter((e) => e.name === ANSWERS_NAMES.answer);
    expect(shown.map(words)).toEqual(["10 1/2 m", "6 4/5 m", "3 3/5", "7 1/2 m"]);
    // Each answer starts below its question and every one waits for a click.
    shown.forEach((a, i) => {
      const q = qs[i] as SlideElement;
      expect(a.revealStep).toBeGreaterThan(0);
      expect(a.y).toBeGreaterThanOrEqual(q.y + q.h);
    });
    // Nothing runs off the body.
    for (const e of all) expect(e.y + e.h).toBeLessThanOrEqual(540);
  });

  test("Answers slides built before questions were shown still count as untouched", () => {
    const d = deck();
    const old = endAnswerSlides(withoutQuestions(answerGroupsOf(d)), paper, "ks2");
    expect(old.flatMap((s) => s.elements).some((e) => e.name === ANSWERS_NAMES.question)).toBe(
      false,
    );
    expect(endAnswersUntouched([...d, ...old], paper, "ks2")).toBe(true);
    const now = endAnswerSlides(answerGroupsOf(d), paper, "ks2");
    expect(endAnswersUntouched([...d, ...now], paper, "ks2")).toBe(true);
  });
});
