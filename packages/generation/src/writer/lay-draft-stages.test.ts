import { describe, expect, test } from "bun:test";
import { getTheme } from "@tj/slides/themes";
import { peekPartial } from "./draft";
import { layDraft } from "./lay-draft";
import { materialise, stableIdPrefix } from "./materialise";

/*
 * TEACH-75 part ac (C4), common acceptance row 7: a stages slide streamed prefix by prefix. The
 * whole slide through the draft path is the closed slide (ids and boxes), every id a draft shows
 * is kept by the closed slide, and an element never vanishes once shown: the strip never flips to
 * the item row's ordered look while its icons are still arriving. Until the first stage's icon is
 * declared the strip is held as icons (stages are written with icons); a writer that then declares
 * `icon: null` turns it to the ordered look once, and from there nothing vanishes.
 */
type S = Record<string, unknown>;
type El = { id: string; type: string; x: number; y: number; w: number; h: number; children?: El[] };
const flat = (els: El[]): El[] => els.flatMap((e) => [e, ...flat(e.children ?? [])]);
const box = (e: El) =>
  `${e.type} ${Math.round(e.x)},${Math.round(e.y)},${Math.round(e.w)},${Math.round(e.h)}`;

const brief = {
  id: "t",
  topic: "t",
  subject: "geography",
  yearGroup: "Year 8",
  year: 8,
  keyStage: "ks3",
  theme: "paper",
  readingLevel: "",
  language: "en-GB",
  durationMin: 60,
  exitTicketOnSlides: true,
} as S;
const INDEX = 3;
const ctx = {
  brief,
  theme: getTheme("paper"),
  stage: "ks3",
  index: INDEX,
  plan: { flow: [{ slide: INDEX + 1 }], slides: [] },
} as never;

const SLIDES: Record<string, S> = {
  icons: {
    template: "stages",
    heading: "A river from source to mouth",
    items: [
      { name: "Source", line: "Rain and springs feed small streams.", icon: "mountain-spring" },
      { name: "Waterfall", line: "Water wears soft rock under hard.", icon: "waterfall" },
      { name: "Meander", line: "On flat land it swings in bends.", icon: "meander" },
      { name: "Mouth", line: "It widens and meets the sea.", icon: "estuary" },
    ],
  },
  "no icons": {
    template: "stages",
    heading: "How a bill becomes law",
    items: [
      { name: "Drafted", line: "Ministers write the bill.", icon: null },
      { name: "Debated", line: "MPs debate its ideas.", icon: null },
      { name: "Voted", line: "The Commons votes on it.", icon: null },
    ],
  },
};

describe("stages in draft mode (TEACH-75 part ac)", () => {
  for (const [name, slide] of Object.entries(SLIDES)) {
    const closed = flat(
      materialise(slide, {
        ...(ctx as object),
        visual: () => ({ status: "pending" }),
      } as never).slide.elements as unknown as El[],
    );
    const text = JSON.stringify(slide);
    const drafts: El[][] = [];
    for (let at = 12; at <= text.length; at += 12) {
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
      // The look is decided by the first stage's icon: drafts before it are held as icons.
      const decided = name === "icons" || text.slice(0, at).includes('"icon"');
      if (laid && decided) drafts.push(flat(laid.elements as unknown as El[]));
    }

    test(`${name}: the whole slide through the draft path is the closed slide`, () => {
      const { template, ...fields } = slide;
      const whole = layDraft({ template: template as string, fields }, ctx, new Map(), "KS3-5");
      expect(flat(whole?.elements as unknown as El[]).map((e) => `${e.id} ${box(e)}`)).toEqual(
        closed.map((e) => `${e.id} ${box(e)}`),
      );
      expect(closed.every((e) => e.id.startsWith(stableIdPrefix(INDEX)))).toBe(true);
    });

    test(`${name}: every draft id is kept and none vanishes once shown`, () => {
      expect(drafts.length).toBeGreaterThan(5);
      const kept = new Set(closed.map((e) => e.id));
      const extra = drafts.flatMap((d) => d.map((e) => e.id).filter((id) => !kept.has(id)));
      expect([...new Set(extra)]).toEqual([]);
      const seen = new Set<string>();
      for (const d of drafts) {
        const ids = new Set(d.map((e) => e.id));
        const gone = [...seen].filter((id) => !ids.has(id));
        expect(gone).toEqual([]);
        for (const id of ids) seen.add(id);
      }
    });
  }
});
