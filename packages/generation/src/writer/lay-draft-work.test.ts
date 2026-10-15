import { describe, expect, test } from "bun:test";
import { getTheme } from "@tj/slides/themes";
import { peekPartial } from "./draft";
import { layDraft, stableIds } from "./lay-draft";
import { materialise } from "./materialise";

/*
 * TEACH-230 part b in draft mode (ADR 0039): practice and the exit ticket type in as the writer
 * streams. A real writer slide is fed through `peekPartial` prefix by prefix:
 * - no element, once shown, vanishes while the slide is written;
 * - the whole slide through the draft path is the closed slide, geometry and ids;
 * - every id a draft shows is an id the closed slide keeps;
 * - no answer shows in any draft.
 */
type S = Record<string, unknown>;
type El = { id: string; type: string; x: number; y: number; w: number; h: number; children?: El[] };
const flat = (els: El[]): El[] => els.flatMap((e) => [e, ...flat(e.children ?? [])]);
const box = (e: El) =>
  `${e.id} ${e.type} ${Math.round(e.x)},${Math.round(e.y)},${Math.round(e.w)},${Math.round(e.h)}`;

const INDEX = 6;
const ctx = {
  brief: {
    id: "t",
    topic: "Fractions of amounts",
    subject: "maths",
    yearGroup: "Year 5",
    year: 5,
    keyStage: "ks2",
    theme: "paper",
    readingLevel: "",
    language: "en-GB",
    durationMin: 60,
    exitTicketOnSlides: true,
  },
  theme: getTheme("paper"),
  stage: "ks2",
  index: INDEX,
  plan: { flow: [], slides: [] },
} as never;

// Writer slides as the y5 fractions run wrote them (field order as streamed), answers included.
const CASES: Record<string, S> = {
  practice: {
    template: "practice",
    heading: "Your turn: fractions of amounts",
    instruction: "In your book",
    questions: ["Find {1/4} of 28.", "Find {3/5} of 40.", "Find {2/3} of 36.", "Find {5/8} of 64."],
    answers: ["7", "24", "24", "40"],
    picture: null,
  },
  "exit ticket": {
    template: "exit-ticket",
    heading: "Fractions of amounts",
    questions: [
      "Find {1/6} of 42.",
      "Find {4/5} of 30.",
      "{3/8} of 32 seats are booked. How many?",
    ],
    answers: ["7", "24", "12"],
    picture: null,
  },
};

describe("practice and exit ticket in draft mode", () => {
  for (const [name, slide] of Object.entries(CASES)) {
    const closed = flat(
      stableIds(
        materialise(slide, { ...(ctx as object), visual: () => ({ status: "pending" }) } as never)
          .slide as never,
        `s${INDEX + 1}`,
      ).elements as unknown as El[],
    );
    const text = JSON.stringify(slide);
    const drafts: { els: El[]; raw: string }[] = [];
    for (let at = 10; at <= text.length; at += 10) {
      const p = peekPartial(text.slice(0, at));
      const v = p?.value as S | undefined;
      if (!v || typeof v.template !== "string" || p?.open?.[0] === "template") continue;
      const { template, ...fields } = v;
      const laid = layDraft(
        { template, fields, ...(p?.open ? { open: p.open } : {}) },
        ctx,
        new Map(),
        "KS2",
      );
      if (laid)
        drafts.push({ els: flat(laid.elements as unknown as El[]), raw: JSON.stringify(laid) });
    }

    test(`${name}: the whole slide through the draft path is the closed slide`, () => {
      const { template, ...fields } = slide;
      const whole = layDraft({ template: template as string, fields }, ctx, new Map(), "KS2");
      expect(flat(whole?.elements as unknown as El[]).map(box)).toEqual(closed.map(box));
    });

    test(`${name}: no element, once shown, vanishes`, () => {
      expect(drafts.length).toBeGreaterThan(5);
      const seen = new Set<string>();
      for (const d of drafts) {
        const ids = new Set(d.els.map((e) => e.id));
        expect([...seen].filter((id) => !ids.has(id))).toEqual([]);
        for (const id of ids) seen.add(id);
      }
    });

    test(`${name}: every draft id is kept by the closed slide`, () => {
      const kept = new Set(closed.map((e) => e.id));
      const extra = drafts.flatMap((d) => d.els.map((e) => e.id).filter((id) => !kept.has(id)));
      expect([...new Set(extra)]).toEqual([]);
    });

    test(`${name}: no answer shows in a draft`, () => {
      for (const d of drafts) {
        expect(d.raw).not.toContain('"question"');
        expect(d.raw).not.toContain("modelAnswer");
        expect(d.els.some((e) => (e as { name?: string }).name === "Answer")).toBe(false);
      }
    });
  }
});
