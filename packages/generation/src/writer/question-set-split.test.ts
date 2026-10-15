import { describe, expect, test } from "bun:test";
import { getTheme } from "@tj/slides/themes";
import { sampleBriefLesson } from "../testing";
import { layDraft } from "./lay-draft";
import { materialise, type Plan } from "./materialise";
import { continueQuickCheck, evenParts } from "./question-set-split";

/*
 * TEACH-101 part g on the writer's side: a quick check past its maximum continues on a second
 * quick-check slide (same heading, split as evenly as possible); and the live drafts of a quick
 * check never lose a question or an answer they showed, ending on the closed slide.
 */
type S = Record<string, unknown>;
const ctxAt = (key: "KS1" | "KS2") => ({
  brief: { ...sampleBriefLesson().brief, keyStage: key } as never,
  theme: getTheme(undefined as never, key as never),
  stage: key as never,
  index: 4,
  plan: { slides: [] } as unknown as Plan,
});
const lay = (s: S, key: "KS1" | "KS2") =>
  materialise(s, { ...ctxAt(key), visual: () => ({ status: "pending" }) });
const fits = (key: "KS1" | "KS2") => (s: S) => !lay(s, key).over.length;

const Y3: [string, string][] = [
  ["What is 46 + 30?", "76"],
  ["What is 85 − 40?", "45"],
  ["Sam has 23 stickers. He gets 20 more. How many now?", "43"],
  ["What is 52 + 40?", "92"],
  ["Mia has 70p. She spends 30p. How much is left?", "40p"],
];
const set = (items: [string, string][]): S => ({
  template: "question-set",
  heading: "Quick check: adding tens",
  questions: items.map((i) => i[0]),
  answers: items.map((i) => i[1]),
  instruction: null,
  picture: null,
});
const texts = (els: { type: string; name?: string; doc?: unknown }[], name: string) =>
  els
    .filter((e) => e.name === name)
    .map(
      (e) =>
        JSON.stringify(e.doc)
          .match(/"text":"([^"]*)"/g)
          ?.join("") ?? "",
    );

describe("a quick check past its maximum continues (TEACH-101 part g)", () => {
  test("five KS1 questions (max 4) become 3 + 2 on two quick checks, nothing over", () => {
    const s = set(Y3);
    expect(lay(s, "KS1").over.length).toBeGreaterThan(0);
    const qc = continueQuickCheck(s, fits("KS1"));
    expect(qc).toBeDefined();
    const parts = [qc?.first, ...(qc?.rest ?? [])] as S[];
    expect(parts.map((p) => (p.questions as string[]).length)).toEqual([3, 2]);
    expect(parts.flatMap((p) => p.questions as string[])).toEqual(Y3.map((i) => i[0]));
    expect(parts.flatMap((p) => p.answers as string[])).toEqual(Y3.map((i) => i[1]));
    for (const p of parts) {
      expect(p.heading).toBe(s.heading);
      const m = lay(p, "KS1");
      expect(m.over).toEqual([]);
      expect(texts(m.slide.elements, "Answer")).toHaveLength((p.questions as string[]).length);
    }
  });

  test("seven questions split 4 + 3, never 3 + 3 + 1", () => {
    expect(evenParts(7, 2)).toEqual([4, 3]);
    expect(evenParts(7, 3)).toEqual([3, 2, 2]);
    const seven: [string, string][] = [
      ...Y3,
      ["What is 18 + 50?", "68"],
      ["What is 61 + 20?", "81"],
    ];
    const qc = continueQuickCheck(set(seven), fits("KS1"));
    const parts = [qc?.first, ...(qc?.rest ?? [])] as S[];
    expect(parts.map((p) => (p.questions as string[]).length)).toEqual([4, 3]);
    expect(parts.flatMap((p) => p.answers as string[])).toEqual(seven.map((i) => i[1]));
    for (const p of parts) expect(lay(p, "KS1").over).toEqual([]);
  });

  test("a set that fits, or carries no answers, is left alone", () => {
    expect(continueQuickCheck(set(Y3.slice(0, 3)), fits("KS1"))).toBeUndefined();
    const plain = { ...set(Y3), answers: undefined };
    expect(continueQuickCheck(plain, fits("KS1"))).toBeUndefined();
  });
});
