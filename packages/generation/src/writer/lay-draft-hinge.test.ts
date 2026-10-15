import { describe, expect, test } from "bun:test";
import { getTheme } from "@tj/slides/themes";
import { peekPartial } from "./draft";
import { layDraft, stableIds } from "./lay-draft";
import { materialise } from "./materialise";

/*
 * The hinge in draft mode (TEACH-256 part b; ADR 0039, `layDraft`), modelled on the pilot layouts'
 * draft test. Writer hinge slides (answer first, as the live pack asks) are fed through the draft
 * path prefix by prefix:
 * - an element, once shown, never vanishes while the slide is written (the title waits for the
 *   stem, `holdHingeTitle`, so the heading is never typed in and then swapped out);
 * - the whole slide through the draft path is the closed slide, geometry and ids;
 * - every id a draft shows is an id the closed slide keeps;
 * - no draft marks the right answer (drafts carry no question data);
 * - the look only steps one way once options arrive: grid -> rows when an option outgrows one
 *   line (code picks the look from the words so far, ruling 161), never back.
 */
type S = Record<string, unknown>;
type El = {
  id: string;
  type: string;
  name?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  children?: El[];
};
const flat = (els: El[]): El[] => els.flatMap((e) => [e, ...flat(e.children ?? [])]);
const box = (e: El) =>
  `${e.type} ${Math.round(e.x)},${Math.round(e.y)},${Math.round(e.w)},${Math.round(e.h)}`;

const theme = getTheme("paper");
const brief = {
  id: "t",
  topic: "t",
  subject: "science",
  yearGroup: "Year 8",
  year: 8,
  keyStage: "ks3",
  theme: "paper",
  readingLevel: "",
  language: "en-GB",
  durationMin: 60,
  exitTicketOnSlides: true,
} as S;
const INDEX = 7;
const ctx = { brief, theme, stage: "ks3", index: INDEX, plan: { flow: [], slides: [] } } as never;

const SLIDES: Record<string, S> = {
  "rows (Moon)": {
    template: "hinge",
    heading: "Check: seeing the Moon",
    stem: "Why can we see the Moon at night?",
    options: [
      "It reflects light from the Sun back towards the Earth.",
      "It gives out its own light, like a star does.",
      "Light from towns and cities on Earth bounces off it.",
      "Its surface is very hot, so it glows in the dark.",
    ],
    correct: 1,
    explanation: "The Moon makes no light; we see sunlight bouncing off it.",
  },
  "grid (metals)": {
    template: "hinge",
    heading: "Which of these metals is magnetic?",
    stem: "",
    options: ["Iron", "Copper", "Aluminium", "All of them"],
    correct: 1,
  },
};

const look = (els: El[]): "grid" | "rows" | "none" => {
  const cards = els.filter((e) => e.name === "Option");
  if (cards.length < 2) return "none";
  return new Set(cards.map((c) => c.y)).size < cards.length ? "grid" : "rows";
};

describe("hinge in draft mode", () => {
  for (const [name, slide] of Object.entries(SLIDES)) {
    // The laid slide keeps its drafts' ids (`stableIds`, stage.ts), as the writer hands it over.
    const closedLaid = stableIds(
      materialise(slide, { ...(ctx as object), visual: () => ({ status: "pending" }) } as never)
        .slide as never,
      `s${INDEX + 1}`,
    ) as { elements: unknown; question?: { type: string } };
    const closed = closedLaid.elements as unknown as El[];
    const text = JSON.stringify(slide);
    const drafts: { els: El[]; question: unknown }[] = [];
    for (let at = 10; at <= text.length; at += 10) {
      const p = peekPartial(text.slice(0, at));
      const v = p?.value as S | undefined;
      if (!v || typeof v.template !== "string" || p?.open?.[0] === "template") continue;
      const { template, ...fields } = v;
      const laid = layDraft(
        { template, fields, ...(p?.open ? { open: p.open } : {}) },
        ctx,
        new Map(),
        "KS3-5",
      );
      if (laid)
        drafts.push({
          els: laid.elements as unknown as El[],
          question: (laid as { question?: unknown }).question,
        });
    }

    test(`${name}: the whole slide through the draft path is the closed slide, ids and boxes`, () => {
      const { template, ...fields } = slide;
      const whole = layDraft({ template: template as string, fields }, ctx, new Map(), "KS3-5");
      expect(flat(whole?.elements as unknown as El[]).map((e) => `${e.id} ${box(e)}`)).toEqual(
        flat(closed).map((e) => `${e.id} ${box(e)}`),
      );
      expect(closedLaid.question?.type).toBe("multiple-choice");
    });

    test(`${name}: nothing shown vanishes, every draft id is kept, no draft marks the answer`, () => {
      expect(drafts.length).toBeGreaterThan(5);
      const kept = new Set(flat(closed).map((e) => e.id));
      let seen = new Set<string>();
      for (const d of drafts) {
        const ids = new Set(flat(d.els).map((e) => e.id));
        for (const id of seen) expect({ id, shown: ids.has(id) }).toEqual({ id, shown: true });
        for (const id of ids) expect({ id, kept: kept.has(id) }).toEqual({ id, kept: true });
        expect(d.question).toBeUndefined();
        seen = ids;
      }
    });

    test(`${name}: the look steps only grid -> rows once options arrive, never back`, () => {
      const looks = drafts.map((d) => look(d.els)).filter((l) => l !== "none");
      const back = looks.findIndex((l, i) => i > 0 && l === "grid" && looks[i - 1] === "rows");
      expect(back).toBe(-1);
      expect<string>(looks.at(-1) ?? "none").toBe(look(closed));
    });
  }
});
