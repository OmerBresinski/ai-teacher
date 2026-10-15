import { describe, expect, test } from "bun:test";
import { getTheme } from "@tj/slides/themes";
import { sampleBriefLesson } from "../testing";
import { layDraft } from "./lay-draft";
import { materialise, type Plan } from "./materialise";
import { continueQuickCheck } from "./question-set-split";

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

  test("a set that fits, or carries no answers, is left alone", () => {
    expect(continueQuickCheck(set(Y3.slice(0, 3)), fits("KS1"))).toBeUndefined();
    const plain = { ...set(Y3), answers: undefined };
    expect(continueQuickCheck(plain, fits("KS1"))).toBeUndefined();
  });
});

describe("quick check drafts while the writer streams (TEACH-101 part g)", () => {
  test("prefix replay: no question or answer vanishes, and the last draft is the closed slide", () => {
    const items = Y3.slice(0, 4);
    const full = set(items);
    // The stream's order: heading, questions one by one, then answers one by one.
    const prefixes: S[] = [{ heading: full.heading }];
    for (let k = 1; k <= items.length; k++)
      prefixes.push({ heading: full.heading, questions: items.slice(0, k).map((i) => i[0]) });
    for (let k = 1; k <= items.length; k++)
      prefixes.push({
        heading: full.heading,
        questions: items.map((i) => i[0]),
        answers: items.slice(0, k).map((i) => i[1]),
      });
    prefixes.push({ ...full });
    const sizes = new Map<string, number>();
    const ctx = ctxAt("KS2");
    let seenQ: string[] = [];
    let seenA: string[] = [];
    let last: ReturnType<typeof layDraft>;
    for (const fields of prefixes) {
      const d = layDraft({ template: "question-set", fields }, ctx, sizes, "KS2");
      expect(d).toBeDefined();
      const els = d?.elements ?? [];
      const all = JSON.stringify(els);
      for (const q of seenQ) expect(all).toContain(q.replace(/"/g, '\\"'));
      for (const a of seenA) expect(all).toContain(a);
      seenQ = ((fields.questions as string[]) ?? []).slice();
      seenA = ((fields.answers as string[]) ?? []).slice();
      last = d;
    }
    const closed = lay(full, "KS2").slide;
    const shape = (els: typeof closed.elements) =>
      els.map((e) => [e.name, e.x, e.y, e.w, e.h, e.revealStep ?? 0]);
    expect(shape(last?.elements ?? [])).toEqual(shape(closed.elements));
    expect(texts(closed.elements, "Answer")).toHaveLength(items.length);
  });
});
