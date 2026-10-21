import { describe, expect, test } from "bun:test";
import { getTheme } from "@tj/slides/themes";
import { peekPartial } from "./draft";
import { layDraft, stableIds } from "./lay-draft";
import { materialise } from "./materialise";

/*
 * The worked example in draft mode (TEACH-17 part b; ADR 0039, `layDraft`), modelled on the hinge's
 * draft test. Writer worked slides are fed through the draft path prefix by prefix:
 * - an element, once shown, never vanishes while the slide is written;
 * - the whole slide through the draft path is the closed slide, geometry and ids;
 * - every id a draft shows is an id the closed slide keeps (the hand-over remounts nothing);
 * - the closed slide reveals one row per click.
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
  revealStep?: number;
  children?: El[];
};
const flat = (els: El[]): El[] => els.flatMap((e) => [e, ...flat(e.children ?? [])]);
const box = (e: El) =>
  `${e.type} ${Math.round(e.x)},${Math.round(e.y)},${Math.round(e.w)},${Math.round(e.h)}`;

const theme = getTheme("paper");
const brief = {
  id: "t",
  topic: "t",
  subject: "maths",
  yearGroup: "Year 8",
  year: 8,
  keyStage: "ks3",
  theme: "paper",
  readingLevel: "",
  language: "en-GB",
  durationMin: 60,
  exitTicketOnSlides: true,
} as S;
const INDEX = 4;
const ctx = { brief, theme, stage: "ks3", index: INDEX, plan: { flow: [], slides: [] } } as never;

const SLIDES: Record<string, S> = {
  "base (Y8)": {
    template: "worked",
    heading: "Solve 3x + 5 = 20",
    lines: [
      { eq: "3x + 5 = 20" },
      { move: "Subtract 5 from both sides", eq: "3x = 15" },
      { move: "Divide both sides by 3", eq: "x = 5", answer: true },
    ],
    check: "3 × *5* + 5 = 20",
  },
  "panel (Y8 algebra bar)": {
    template: "worked",
    heading: "Solve 3x + 5 = 20",
    lines: [
      { eq: "3x + 5 = 20" },
      { move: "Subtract 5 from both sides", eq: "3x = 15" },
      { move: "Divide both sides by 3", eq: "x = 5", answer: true },
    ],
    check: "3 × *5* + 5 = 20",
    panel: { model: "algebra-bar", a: 3, b: 5, c: 20 },
  },
  "stress (5 lines)": {
    template: "worked",
    heading: "Solve 4(x - 3) = 2x + 6",
    lines: [
      { eq: "4(x - 3) = 2x + 6" },
      { move: "Expand the bracket", eq: "4x - 12 = 2x + 6" },
      { move: "Subtract 2x from both sides", eq: "2x - 12 = 6" },
      { move: "Add 12 to both sides", eq: "2x = 18" },
      { move: "Divide both sides by 2", eq: "x = 9", answer: true },
    ],
    check: "4(*9* - 3) = 24 = 2 × *9* + 6",
  },
};

describe("worked example in draft mode", () => {
  for (const [name, slide] of Object.entries(SLIDES)) {
    // The laid slide keeps its drafts' ids (`stableIds`, stage.ts), as the writer hands it over.
    const closedLaid = stableIds(
      materialise(slide, { ...(ctx as object), visual: () => ({ status: "pending" }) } as never)
        .slide as never,
      `s${INDEX + 1}`,
    ) as { elements: unknown };
    const closed = closedLaid.elements as unknown as El[];
    const text = JSON.stringify(slide);
    const drafts: El[][] = [];
    for (let at = 8; at <= text.length; at += 8) {
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
      if (laid) drafts.push(laid.elements as unknown as El[]);
    }

    test(`${name}: the whole slide through the draft path is the closed slide, ids and boxes`, () => {
      const { template, ...fields } = slide;
      const whole = layDraft({ template: template as string, fields }, ctx, new Map(), "KS3-5");
      expect(flat(whole?.elements as unknown as El[]).map((e) => `${e.id} ${box(e)}`)).toEqual(
        flat(closed).map((e) => `${e.id} ${box(e)}`),
      );
    });

    test(`${name}: nothing shown vanishes and every draft id survives the hand-over`, () => {
      expect(drafts.length).toBeGreaterThan(10);
      const kept = new Set(flat(closed).map((e) => e.id));
      let seen = new Set<string>();
      for (const d of drafts) {
        const ids = new Set(flat(d).map((e) => e.id));
        for (const id of seen) expect({ id, shown: ids.has(id) }).toEqual({ id, shown: true });
        for (const id of ids) expect({ id, kept: kept.has(id) }).toEqual({ id, kept: true });
        seen = ids;
      }
    });

    test(`${name}: the closed slide reveals one row per click`, () => {
      const lines = (slide.lines as unknown[]).length + (slide.check ? 1 : 0);
      const badges = flat(closed).filter((e) => e.name === "Badge");
      expect(badges.map((b) => b.revealStep)).toEqual(
        Array.from({ length: lines }, (_, i) => i + 1),
      );
    });
  }
});
