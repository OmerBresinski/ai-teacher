import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import FIX from "./fixtures/pilot-draft-slides.json" with { type: "json" };
import { replayRun } from "./replay-fixture";

/*
 * Live writing over a whole lesson, old and pilot slides mixed (TEACH-110 part w). The acceptance
 * run saw the open slide drop to a handful of elements for up to 2.6 s: a pilot slide's group was
 * numbered from 0 (`d-s3-layout` on s4), so the next slide's draft wore the open slide's prefix,
 * and the closed pilot slide was renamed again (`d-s4-Layout-0`), so nothing it drafted survived
 * the hand-over and the editor found no bound items. Every draft carries its own slide's prefix,
 * nothing a draft shows vanishes from the next one, and the last draft is the closed slide.
 */

type El = {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  doc?: unknown;
  children?: El[];
};
const flat = (els: El[]): El[] => els.flatMap((e) => [e, ...flat(e.children ?? [])]);
const words = (e: El) => JSON.stringify(e.doc ?? "").includes('"text":"');
const box = (e: El) =>
  `${e.id} ${e.type} ${Math.round(e.x)},${Math.round(e.y)},${Math.round(e.w)},${Math.round(e.h)}`;

const pieces = (seed: number, max: number) => (text: string) => {
  const out: string[] = [];
  let x = seed;
  for (let at = 0; at < text.length; ) {
    x = (x * 1103515245 + 12345) % 2 ** 31;
    const n = 1 + (x % max);
    out.push(text.slice(at, at + n));
    at += n;
  }
  return out;
};

const PILOT = FIX as Record<string, { slide: Record<string, unknown> }>;
/** Writer slides (deck slide = index + 3) swapped for pilot layouts; the slides before them are old. */
const SWAPS: Record<number, string> = { 2: "items-row", 4: "split-compare-3", 6: "panel-list" };
const mixed = (text: string) => {
  const out = JSON.parse(text) as { slides: Record<string, unknown>[] };
  for (const [at, name] of Object.entries(SWAPS)) {
    const slide = PILOT[name]?.slide;
    if (slide) out.slides[Number(at)] = slide;
  }
  // One item too long for its box: the editor offers Split slide on the generated slide.
  const row = out.slides[2] as { items: { text: string }[] };
  const one = row.items[1];
  if (one) one.text = `${one.text} `.repeat(5).trim();
  return JSON.stringify(out);
};

describe("a whole lesson's drafts, old and pilot slides mixed (TEACH-110 part w)", async () => {
  const drafts = new Map<number, El[][]>();
  const closed = new Map<number, El[]>();
  const order: number[] = [];
  await replayRun("y5-maths-fractions-of-amounts", {
    stream: pieces(4000, 9),
    text: mixed,
    visual: () => ({ status: "pending" }),
    hooks: {
      draft: { ms: 0 },
      onDraftSlide: (i, s) => {
        order.push(i);
        drafts.set(i, [...(drafts.get(i) ?? []), s.elements as unknown as El[]]);
      },
      onSlide: (i, s) => {
        if (!closed.has(i)) closed.set(i, s.elements as unknown as El[]);
      },
    },
  });
  const pilotAt = Object.keys(SWAPS).map((k) => Number(k) + 2);

  test("the pilot slides and the old slides before them were drafted", () => {
    for (const i of pilotAt) {
      expect((drafts.get(i) ?? []).length).toBeGreaterThan(3);
      expect((drafts.get(i - 1) ?? []).length).toBeGreaterThan(3);
      expect(closed.get(i)?.[0]?.type).toBe("group");
    }
  });

  test("every draft carries its own slide's prefix, never another slide's", () => {
    expect(order.length).toBeGreaterThan(20);
    for (const [i, list] of drafts)
      for (const d of list) for (const e of flat(d)) expect(e.id).toStartWith(`d-s${i + 1}-`);
  });

  test("the closed slides carry the same prefix, and a pilot slide keeps its bound group", () => {
    for (const [i, els] of closed)
      if (drafts.has(i)) for (const e of flat(els)) expect(e.id).toStartWith(`d-s${i + 1}-`);
    for (const i of pilotAt) {
      const g = closed.get(i)?.[0] as El;
      expect(g.id).toBe(`d-s${i + 1}-layout`);
      expect(g.children?.every((c) => c.id.startsWith(`d-s${i + 1}-layout:`))).toBe(true);
      expect(g.children?.some((c) => /:[a-z]/.test(c.id.slice(g.id.length)))).toBe(true);
    }
  });

  test("no element with words vanishes from one draft to the next, nor at the hand-over", () => {
    for (const [i, list] of drafts) {
      const seq = [...list, closed.get(i) ?? []];
      for (let k = 1; k < seq.length; k++) {
        const now = new Set(flat(seq[k] as El[]).map((e) => e.id));
        const gone = flat(seq[k - 1] as El[])
          .filter(words)
          .filter((e) => !now.has(e.id))
          .map((e) => `s${i + 1} draft ${k}: ${e.id}`);
        expect(gone).toEqual([]);
      }
    }
  });

  test("a pilot slide's last draft is its closed slide, ids and boxes", () => {
    for (const i of pilotAt) {
      const last = drafts.get(i)?.at(-1) ?? [];
      expect(flat(last).map(box)).toEqual(flat(closed.get(i) ?? []).map(box));
    }
  });

  /*
   * The editor's test (`generated-pilot.test.tsx`) opens this generated items-row slide as it was
   * closed and saved: it must offer add, delete and split. `UPDATE_FIXTURES=1` rewrites it.
   */
  test("the editor's generated pilot slide is this run's closed items-row slide", async () => {
    const file = join(
      import.meta.dir,
      "../../../editor/src/lesson/transform/fixtures/generated-items-row.json",
    );
    const now = JSON.parse(JSON.stringify({ elements: closed.get(4) }));
    if (process.env.UPDATE_FIXTURES) await Bun.write(file, `${JSON.stringify(now, null, 1)}\n`);
    expect(now).toEqual(await Bun.file(file).json());
  });
});
