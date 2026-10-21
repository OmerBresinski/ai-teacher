import { describe, expect, test } from "bun:test";
import { getTheme } from "@tj/slides/themes";
import { peekPartial } from "./draft";
import { layDraft, stableIds } from "./lay-draft";
import { materialise } from "./materialise";

/*
 * The source in draft mode (TEACH-75 part ab; ADR 0039, `layDraft`): a writer source slide fed
 * through the draft path prefix by prefix. Once shown, an element never vanishes while the slide
 * is written, and every id a draft shows is an id the closed slide keeps (stable hand-over).
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
  prose: {
    template: "source",
    heading: "",
    form: "prose",
    from: "Elizabeth I, speech to her army at Tilbury, 1588",
    extract:
      "I know I have the body of a weak and feeble woman; but I have the heart and stomach of a king, and of a king of England too, and think foul scorn that Parma or Spain, or any prince of Europe, should dare to invade the borders of my realm.",
    notes: [
      { anchor: "heart and stomach of a king", label: "her claim", text: "as brave as any king" },
      {
        anchor: "dare to invade the borders of my realm",
        label: "her warning",
        text: "Spain must not invade",
      },
    ],
  },
  verse: {
    template: "source",
    heading: "",
    form: "verse",
    from: "from Dulce et Decorum Est, Wilfred Owen (1920)",
    extract:
      "Bent double, like old beggars under sacks,\nKnock-kneed, coughing like hags, we cursed through sludge,\nTill on the haunting flares we turned our backs\nAnd towards our distant rest began to trudge.",
    notes: [
      { anchor: "like old beggars", label: "simile", text: "young men made old" },
      { anchor: "trudge", label: "slow verb", text: "heavy, dragging steps" },
    ],
  },
};

describe("source in draft mode", () => {
  for (const [name, slide] of Object.entries(SLIDES)) {
    const closed = (
      stableIds(
        materialise(slide, { ...(ctx as object), visual: () => ({ status: "pending" }) } as never)
          .slide as never,
        `s${INDEX + 1}`,
      ) as { elements: unknown }
    ).elements as El[];
    const text = JSON.stringify(slide);
    const drafts: El[][] = [];
    for (let at = 10; at <= text.length; at += 7) {
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

    test(`${name}: the whole slide through the draft path is the closed slide`, () => {
      const { template, ...fields } = slide;
      const whole = layDraft({ template: template as string, fields }, ctx, new Map(), "KS3-5");
      expect(flat(whole?.elements as unknown as El[]).map((e) => `${e.id} ${box(e)}`)).toEqual(
        flat(closed).map((e) => `${e.id} ${box(e)}`),
      );
      expect(closed.filter((e) => e.name === "Note label")).toHaveLength(2);
    });

    test(`${name}: nothing shown vanishes and every draft id survives the hand-over`, () => {
      expect(drafts.length).toBeGreaterThan(5);
      const kept = new Set(flat(closed).map((e) => e.id));
      let seen = new Set<string>();
      for (const d of drafts) {
        const ids = new Set(flat(d).map((e) => e.id));
        for (const id of seen) expect({ id, shown: ids.has(id) }).toEqual({ id, shown: true });
        for (const id of ids) expect({ id, kept: kept.has(id) }).toEqual({ id, kept: true });
        seen = ids;
      }
    });
  }
});
