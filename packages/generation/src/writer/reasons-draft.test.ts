import { describe, expect, test } from "bun:test";
import { getTheme } from "@tj/slides/themes";
import { peekPartial } from "./draft";
import { layDraft } from "./lay-draft";
import { materialise } from "./materialise";

/*
 * TEACH-75 part ad: a reasons slide streamed through the draft path. The whole slide through the
 * draft path is the closed slide (ids and boxes), every id a draft shows survives the hand-over
 * (nothing vanishes), and the icons never drop out while they are still arriving.
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
const brief = {
  id: "t",
  topic: "t",
  subject: "history",
  yearGroup: "Year 5",
  year: 5,
  keyStage: "ks2",
  theme: "paper",
  readingLevel: "",
  language: "en-GB",
  durationMin: 60,
  exitTicketOnSlides: true,
} as S;
const ctx = {
  brief,
  theme: getTheme("paper"),
  stage: "ks2",
  index: 4,
  plan: { flow: [], slides: [] },
} as never;

const SLIDES: Record<string, S> = {
  fan: {
    template: "reasons",
    heading: "Why do we sweat?",
    lead: "Your skin makes sweat on hot days.",
    items: [
      { head: "Moving makes us hot", line: "Running and playing warm us up.", icon: "exercise" },
      {
        head: "Our body must stay at 37 °C",
        line: "Our insides work best at this heat.",
        icon: "thermometer",
      },
      {
        head: "Sweat cools us as it dries",
        line: "Drying sweat carries heat away.",
        icon: "sweat-drop",
      },
    ],
  },
  chain: {
    template: "reasons",
    kind: "chain",
    heading: "How did a small fire burn down London?",
    items: [
      {
        head: "A bakery catches fire",
        line: "Sparks from the oven light the house.",
        icon: "bakery",
      },
      { head: "The wind blows it on", line: "The fire jumps to the next houses.", icon: "wind" },
      { head: "Most of London burns", line: "It burns for four days.", icon: "flame" },
    ],
  },
};

describe("reasons in draft mode (TEACH-75 part ad)", () => {
  for (const [name, slide] of Object.entries(SLIDES)) {
    const closed = flat(
      materialise(slide, { ...(ctx as object), visual: () => ({ status: "pending" }) } as never)
        .slide.elements as unknown as El[],
    );
    const text = JSON.stringify(slide);
    const drafts: El[][] = [];
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
      if (laid) drafts.push(flat(laid.elements as unknown as El[]));
    }

    test(`${name}: the whole slide through the draft path is the closed slide, ids and boxes`, () => {
      const { template, ...fields } = slide;
      const whole = layDraft({ template: template as string, fields }, ctx, new Map(), "KS2");
      const a = flat(whole?.elements as unknown as El[]).map((e) => `${e.id} ${box(e)}`);
      expect(a).toEqual(closed.map((e) => `${e.id} ${box(e)}`));
      expect(closed[0]?.type).toBe("group");
    });

    test(`${name}: every id a draft shows is an id the closed slide keeps (nothing vanishes)`, () => {
      expect(drafts.length).toBeGreaterThan(10);
      const keep = new Set(closed.map((e) => e.id));
      const last = drafts.slice(-5);
      for (const d of last) for (const e of d) expect(keep.has(e.id)).toBe(true);
      // Once a reason's head shows, it stays in every later draft.
      let seen = new Set<string>();
      for (const d of drafts) {
        const ids = new Set(d.map((e) => e.id));
        for (const id of seen) expect(ids.has(id)).toBe(true);
        seen = new Set(d.filter((e) => e.name === "Reason head").map((e) => e.id));
      }
    });

    test(`${name}: icons never drop out once the first one is written`, () => {
      let had = 0;
      for (const d of drafts) {
        const icons = d.filter((e) => e.name === "Reason icon").length;
        expect(icons).toBeGreaterThanOrEqual(had);
        had = icons;
      }
      expect(had).toBe(3);
    });
  }
});
