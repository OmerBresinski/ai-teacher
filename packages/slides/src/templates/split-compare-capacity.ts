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
 * writer's `Fits:` line. Regenerate: `bun packages/slides/src/templates/split-compare-capacity.ts`
 * (both looks: split compare's fields, and side by side's narrower cards into
 * `side-by-side-capacity.json`).
 */
import { writeFileSync } from "node:fs";
import { atKeyStage, THEMES } from "../themes";
import { sample } from "./capacity";
import { type Ctx, type Figure, type Stage, templateScale } from "./index";
import {
  type SplitGroup,
  type SplitLook,
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
/**
 * Title room reserved while the words are measured, in characters (default: `BASE.title`). Ruling
 * 162 amended by Greg 18 Oct (item 31 A): KS2 reading text at the golds' 33-34px on quick check,
 * picture-with-points and split-compare. The smaller KS2 side text takes more of a narrow
 * three-side field, and measured after it the title fell (pictures 37 -> 22 chars, words only
 * hardMax 51 -> 37). Three-side picture and words-only cells therefore measure the words beside a
 * two-line title (28 chars), which keeps every title and every text at or above its room before
 * the change. The three-side quote cell keeps the stand-in: a 28-char title there would take the
 * quote's room.
 */
const TITLE_RESERVE: Partial<
  Record<SplitGroup, Partial<Record<2 | 3, Partial<Record<SplitZone, number>>>>>
> = {
  KS2: { 3: { picture: 28, text: 28 } },
};
/** The shortest stand-ins (a word or two): a re-measure when `BASE`'s overflow left a field 0. */
const SHORT = { title: 8, quote: 8 } as const;
const sidesOf = (n: number, zone: SplitZone, len: Partial<Record<Field, number>>): SplitSide[] =>
  Array.from({ length: n }, (_, i) => ({
    title: sample(len.title ?? BASE.title, i),
    text: sample(len.text ?? BASE.text, i + 7),
    ...(zone === "quote" ? { quote: sample(len.quote ?? BASE.quote, i + 13) } : {}),
    ...(zone === "picture" ? { picture: UPRIGHT } : {}),
  }));

/** Whether these sides fit (`comfy`: comfortably) on every theme and stage of the group. */
function allFit(group: SplitGroup, sides: SplitSide[], comfy: boolean, look: SplitLook): boolean {
  return THEMES.every((theme) =>
    SPLIT_GROUPS[group].every((stage) => {
      const c: Ctx = {
        t: atKeyStage(theme, stage),
        s: templateScale(theme, stage),
        over: [],
        els: [],
      };
      const f = splitFit(c, { template: look, heading: SPLIT_FIT_HEADING, sides }, look);
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
export function splitSides(
  group: SplitGroup,
  n: 2 | 3,
  zone: SplitZone,
  look: SplitLook = "split-compare",
): SplitSide[] {
  const t = splitTable(group, n, zone, look);
  return sidesOf(n, zone, {
    title: t.title.cap,
    text: t.text.cap,
    ...(t.quote ? { quote: t.quote.cap } : {}),
  });
}

export function measureSplitCell(
  group: SplitGroup,
  n: 2 | 3,
  zone: SplitZone,
  look: SplitLook = "split-compare",
  order: readonly Field[] = ORDER,
  reserve = look === "split-compare" ? (TITLE_RESERVE[group]?.[n]?.[zone] ?? 0) : 0,
) {
  // The title's reserved room: the words are measured beside a title this long, not the stand-in.
  const len: Partial<Record<Field, number>> = reserve ? { title: reserve } : {};
  const out: Partial<SplitMeasured> = {};
  const fields = order.filter((f) => f !== "quote" || zone === "quote");
  for (const f of fields) {
    const at = (comfy: boolean) => (chars: number) =>
      allFit(group, sidesOf(n, zone, { ...len, [f]: chars }), comfy, look);
    // A field that gives 0 beside the stand-ins is re-measured beside the shortest real ones
    // (TEACH-68 part b): KS1's three 20-character quotes were over their own limit and left the
    // words no room, though words fit beside shorter quotes.
    const short = (comfy: boolean) => (chars: number) =>
      allFit(group, sidesOf(n, zone, { ...SHORT, ...len, [f]: chars }), comfy, look);
    const cap = longest(at(true), LIMITS[f]) || longest(short(true), LIMITS[f]);
    const hardMax = Math.max(
      cap,
      longest(at(false), LIMITS[f]) || longest(short(false), LIMITS[f]),
    );
    out[f] = { cap, hardMax, words: cap ? sample(cap).split(" ").length : 0 };
    len[f] = cap;
  }
  return Object.fromEntries(
    (["title", "quote", "text"] as Field[]).filter((f) => out[f]).map((f) => [f, out[f]]),
  ) as SplitMeasured;
}

/** Side by side holds examples with pictures, or words while they arrive (no quotes). */
const ZONES: Record<SplitLook, SplitZone[]> = {
  "split-compare": ["picture", "quote", "text"],
  "side-by-side": ["picture", "text"],
};

if (import.meta.main)
  for (const look of ["split-compare", "side-by-side"] as SplitLook[]) {
    const table: Record<string, Record<number, Record<string, SplitMeasured>>> = {};
    for (const group of Object.keys(SPLIT_GROUPS) as SplitGroup[]) {
      table[group] = {};
      for (const n of [2, 3] as const) {
        (table[group] as Record<number, Record<string, SplitMeasured>>)[n] = {};
        for (const zone of ZONES[look])
          (
            (table[group] as Record<number, Record<string, SplitMeasured>>)[n] as Record<
              string,
              SplitMeasured
            >
          )[zone] = measureSplitCell(group, n, zone, look);
      }
    }
    writeFileSync(
      new URL(`./${look}-capacity.json`, import.meta.url),
      `${JSON.stringify(table, null, 2)}\n`,
    );
    console.log(JSON.stringify(table));
  }
