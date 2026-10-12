/**
 * Split compare capacity (TEACH-75 part w, ruling 215): each field's published cap (the longest
 * text that stays comfortable) and hard maximum (the longest that still fits at the type floors),
 * in characters, measured by the template itself on every theme and stage of the key-stage group,
 * never hand-written. Per group, side count (2, 3) and zone (pictures, quotes, words only):
 *
 * - the words first, beside a two-word title and (quote zone) a three- or four-word quote;
 * - then the quote with the words at their cap;
 * - then the title with the words and quote at their caps,
 *
 * so the words get the room and a slide with every field at its cap is comfortable. Every side holds the same length (the
 * binding case: the rows line up across the fields). Pictures are an upright photo of one subject,
 * the tightest realistic pair (it gives way only by shrinking). `words` is the cap in words, for the
 * writer's `Fits:` line. Regenerate: `bun packages/slides/src/templates/split-compare-capacity.ts`.
 */
import { writeFileSync } from "node:fs";
import { atKeyStage, THEMES } from "../themes";
import { sample } from "./capacity";
import { type Ctx, type Figure, type Stage, templateScale } from "./index";
import {
  type SplitGroup,
  type SplitSide,
  type SplitZone,
  splitFit,
  splitTable,
} from "./split-compare";

export type { SplitGroup };
export const SPLIT_GROUPS: Record<SplitGroup, Stage[]> = {
  KS1: ["ks1"],
  KS2: ["ks2"],
  "KS3-5": ["ks3", "ks4", "ks5"],
};
/** The heading every cell is measured under: one line on every theme at KS1. */
export const SPLIT_FIT_HEADING = "How the two compare";
/** The picture every picture cell is measured with: an upright photo of one subject. */
const UPRIGHT: Figure = {
  photo: "https://x.test/upright.jpg",
  aspect: 0.75,
  alt: "an upright subject",
  subjects: [{ name: "subject", x: 0.28, y: 0.16, w: 0.44, h: 0.68 }],
};
const LIMITS = { title: 80, quote: 320, text: 400 } as const;
type Field = keyof typeof LIMITS;
export type SplitMeasured = Record<Field, { cap: number; hardMax: number; words: number }>;

/** What a field holds while the fields measured before it are measured. */
const BASE = { title: 16, quote: 20, text: 1 } as const;
const ORDER: Field[] = ["text", "quote", "title"];
const sidesOf = (n: number, zone: SplitZone, len: Partial<Record<Field, number>>): SplitSide[] =>
  Array.from({ length: n }, (_, i) => ({
    title: sample(len.title ?? BASE.title, i),
    text: sample(len.text ?? BASE.text, i + 7),
    ...(zone === "quote" ? { quote: sample(len.quote ?? BASE.quote, i + 13) } : {}),
    ...(zone === "picture" ? { picture: UPRIGHT } : {}),
  }));

/** Whether these sides fit (`comfy`: comfortably) on every theme and stage of the group. */
function allFit(group: SplitGroup, sides: SplitSide[], comfy: boolean): boolean {
  return THEMES.every((theme) =>
    SPLIT_GROUPS[group].every((stage) => {
      const c: Ctx = {
        t: atKeyStage(theme, stage),
        s: templateScale(theme, stage),
        over: [],
        els: [],
      };
      const f = splitFit(c, { template: "split-compare", heading: SPLIT_FIT_HEADING, sides });
      return comfy ? f.comfy : f.fits;
    }),
  );
}

/** The longest length (in characters, cut at a word) of `field` that still passes. */
function longest(test: (chars: number) => boolean, max: number): number {
  let lo = 0;
  let hi = max;
  if (!test(1)) return 0;
  lo = 1;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (test(mid)) lo = mid;
    else hi = mid;
  }
  // Real words: the cap is the length of the text that sample() actually gives.
  return sample(lo).length;
}

/** The sides used for a check: every side at the given lengths. */
export function splitSides(group: SplitGroup, n: 2 | 3, zone: SplitZone): SplitSide[] {
  const t = splitTable(group, n, zone);
  return sidesOf(n, zone, {
    title: t.title.cap,
    text: t.text.cap,
    ...(t.quote ? { quote: t.quote.cap } : {}),
  });
}

export function measureSplitCell(group: SplitGroup, n: 2 | 3, zone: SplitZone) {
  const len: Partial<Record<Field, number>> = {};
  const out: Partial<SplitMeasured> = {};
  const fields = ORDER.filter((f) => f !== "quote" || zone === "quote");
  for (const f of fields) {
    const at = (comfy: boolean) => (chars: number) =>
      allFit(group, sidesOf(n, zone, { ...len, [f]: chars }), comfy);
    const cap = longest(at(true), LIMITS[f]);
    const hardMax = Math.max(cap, longest(at(false), LIMITS[f]));
    out[f] = { cap, hardMax, words: cap ? sample(cap).split(" ").length : 0 };
    len[f] = cap;
  }
  return Object.fromEntries(
    (["title", "quote", "text"] as Field[]).filter((f) => out[f]).map((f) => [f, out[f]]),
  ) as SplitMeasured;
}

if (import.meta.main) {
  const table: Record<string, Record<number, Record<string, SplitMeasured>>> = {};
  for (const group of Object.keys(SPLIT_GROUPS) as SplitGroup[]) {
    table[group] = {};
    for (const n of [2, 3] as const) {
      (table[group] as Record<number, Record<string, SplitMeasured>>)[n] = {};
      for (const zone of ["picture", "quote", "text"] as SplitZone[])
        (
          (table[group] as Record<number, Record<string, SplitMeasured>>)[n] as Record<
            string,
            SplitMeasured
          >
        )[zone] = measureSplitCell(group, n, zone);
    }
  }
  writeFileSync(
    new URL("./split-compare-capacity.json", import.meta.url),
    `${JSON.stringify(table, null, 2)}\n`,
  );
  console.log(JSON.stringify(table));
}
