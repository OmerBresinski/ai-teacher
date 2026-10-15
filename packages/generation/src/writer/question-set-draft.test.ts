import { describe, expect, test } from "bun:test";
import { getTheme } from "@tj/slides/themes";
import { peekPartial } from "./draft";
import { layDraft, stableIds } from "./lay-draft";
import { materialise } from "./materialise";
import { continueQuickCheck } from "./question-set-split";

/*
 * TEACH-101 part g in draft mode (ADR 0039; modelled on the pilot layouts' draft test, PR #535).
 * A real quick check, as the writer gives it (`items: [{ question, answer }]`), is fed through the
 * draft path prefix by prefix:
 * - no element, once shown, vanishes while the slide is written;
 * - the whole slide through the draft path is the closed slide (geometry and ids), less its
 *   revealed answers, which no draft shows;
 * - every id a draft shows is an id the closed slide keeps.
 */
type S = Record<string, unknown>;
type El = { id: string; type: string; name?: string; x: number; y: number; w: number; h: number };
type Children = { children?: El[] };
const flat = (els: El[]): El[] => els.flatMap((e) => [e, ...flat((e as Children).children ?? [])]);
const box = (e: El) =>
  `${e.id} ${e.type} ${Math.round(e.x)},${Math.round(e.y)},${Math.round(e.w)},${Math.round(e.h)}`;

const brief = {
  id: "t",
  topic: "the heart",
  subject: "science",
  yearGroup: "Year 6",
  year: 6,
  keyStage: "ks2",
  theme: "paper",
  readingLevel: "",
  language: "en-GB",
  durationMin: 60,
  exitTicketOnSlides: true,
} as S;
const INDEX = 5;
const ctx = {
  brief,
  theme: getTheme("paper"),
  stage: "ks2",
  index: INDEX,
  plan: { flow: [], slides: [] },
} as never;

const SLIDE: S = {
  template: "question-set",
  heading: "Quick check: the heart",
  items: [
    { question: "Which organ pumps blood around the body?", answer: "The heart" },
    { question: "Which vessels carry blood away from the heart?", answer: "Arteries" },
    { question: "Which gas does blood pick up in the lungs?", answer: "Oxygen" },
    { question: "What is the beat you feel in your wrist?", answer: "Your pulse" },
    { question: "Which liquid part of blood carries nutrients?", answer: "Plasma" },
  ],
  instruction: null,
  picture: null,
};
const ANSWERS = (SLIDE.items as S[]).map((i) => i.answer as string);

const laidClosed = stableIds(
  materialise(SLIDE, { ...(ctx as object), visual: () => ({ status: "pending" }) } as never).slide,
  `s${INDEX + 1}`,
);
const closed = flat(laidClosed.elements as unknown as El[]);
const text = JSON.stringify(SLIDE);
const drafts: { els: El[]; json: string }[] = [];
for (let at = 10; at <= text.length; at += 10) {
  const p = peekPartial(text.slice(0, at));
  const v = p?.value as S | undefined;
  if (!v || typeof v.template !== "string" || p?.open?.[0] === "template") continue;
  const { template, ...fields } = v;
  const laid = layDraft({ template, fields }, ctx, new Map(), "KS2");
  if (laid)
    drafts.push({ els: flat(laid.elements as unknown as El[]), json: JSON.stringify(laid) });
}

describe("quick check in draft mode (TEACH-101 part g)", () => {
  test("the closed slide is a quick check that fits, with one revealed answer per question", () => {
    expect(closed.filter((e) => e.name === "Answer")).toHaveLength(ANSWERS.length);
    expect(continueQuickCheck(SLIDE, () => true)).toBeUndefined();
    expect(drafts.length).toBeGreaterThan(10);
  });

  test("no element, once shown, vanishes while the slide is written", () => {
    let shown = new Set<string>();
    for (const d of drafts) {
      const ids = new Set(d.els.map((e) => e.id));
      for (const id of shown) expect(ids.has(id), id).toBe(true);
      shown = ids;
    }
  });

  test("the whole slide through the draft path is the closed slide, less its revealed answers", () => {
    const { template, ...fields } = SLIDE;
    const whole = layDraft({ template: template as string, fields }, ctx, new Map(), "KS2");
    const a = flat(whole?.elements as unknown as El[]).map(box);
    const b = closed.filter((e) => !(e as { revealStep?: number }).revealStep).map(box);
    expect(a).toEqual(b);
    expect(whole?.question).toBeUndefined();
  });

  test("every id a draft shows is kept by the closed slide; no draft shows an answer", () => {
    const kept = new Set(closed.map((e) => e.id));
    const extra = drafts.flatMap((d) => d.els.map((e) => e.id).filter((id) => !kept.has(id)));
    expect([...new Set(extra)]).toEqual([]);
    for (const d of drafts) for (const a of ANSWERS) expect(d.json).not.toContain(`"text":"${a}"`);
  });
});
