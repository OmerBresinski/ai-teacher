/**
 * Reasons capacity (TEACH-75 part ad, ruling 215): the published character limits, measured by the
 * renderer. For each age (early KS1, primary KS2, secondary KS3), look (fan or chain) and count,
 * each field gets a `hardMax` (the longest text that still fits at the floors on every theme; past
 * it the field is named in `over`) and a `cap` (the writer's limit: the gold's NOTES value, never
 * past what the renderer keeps comfortable). A count the layout never takes (four reasons at KS1, a
 * four-link chain at KS1) is all 0, and every field there is over. A four-link chain is measured
 * with lines of at most `CHAIN_SHORT_LINE` characters (the only four-link chain allowed).
 * Measured like panel-list's table: each list field is the smaller of every reason long and one
 * reason long beside short siblings, the rest at their short sample.
 * The same cells with a question picture (TEACH-247 part ba) go to `reasons-picture-capacity.json`:
 * the picture takes the panel's foot, so the question (and lead) has less room.
 * Regenerate: `bun packages/slides/src/templates/reasons-capacity.ts`.
 */
import { writeFileSync } from "node:fs";
import type { Theme } from "@tj/domain/documents";
import { THEMES } from "../themes";
import type { Stage, TemplateInput } from "./index";
import { panelSample as sample } from "./panel-list-capacity";
import type { AgeKey } from "./panel-list-deps";
import {
  type Cap,
  CHAIN_SHORT_LINE,
  capsKey,
  REASONS_MAX,
  type ReasonItem,
  type ReasonsCaps,
  reasonsFits,
} from "./reasons";

export const REASONS_AGES: Record<AgeKey, Stage> = {
  early: "ks1",
  primary: "ks2",
  secondary: "ks3",
};

/** The gold's caps (`northstars-v13/reasons/NOTES.md`): the writer's limits, before measuring. */
export const GOLD_CAPS: Record<
  AgeKey,
  { question: number; lead: number; head: number; line: number; line4: number; chainLine: number }
> = {
  early: { question: 40, lead: 60, head: 22, line: 45, line4: 0, chainLine: 30 },
  primary: { question: 40, lead: 60, head: 34, line: 60, line4: 60, chainLine: 65 },
  secondary: { question: 48, lead: 60, head: 34, line: 95, line4: 65, chainLine: 70 },
};

const SHORT: ReasonItem[] = [
  { head: "Invasions", line: "Rome was sacked.", icon: "helmet" },
  { head: "Too big", line: "The army was spread thin.", icon: "shield" },
  { head: "No money", line: "Taxes ran out.", icon: "coin" },
  { head: "Weak leaders", line: "Rivals fought.", icon: "crown" },
];
const QUESTION = "Why did Rome fall?";
const LEAD = "Rome ruled the west for centuries.";
/** A stand-in landscape photo for the picture cells (its shape is all the layout reads). */
const PICTURE = { photo: "/capacity/reasons.jpg", aspect: 1.5, alt: "" };
let withPicture = false;

const inputOf = (
  items: ReasonItem[],
  chain: boolean,
  heading = QUESTION,
  lead = LEAD,
): TemplateInput => ({
  template: "reasons",
  heading,
  lead,
  chain,
  reasons: items,
  ...(withPicture ? { figure: PICTURE } : {}),
});

function longest(ok: (chars: number) => boolean, max = 240): number {
  if (!ok(1)) return 0;
  let lo = 1;
  let hi = max;
  if (ok(hi)) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** The measured limits of one field: `comfy` and `hardMax` in characters of the sample. */
function measure(
  themes: readonly Theme[],
  stage: Stage,
  make: (chars: number) => TemplateInput,
  seed: number,
  max = 240,
): { comfy: number; hardMax: number } {
  const len = (ch: number) => (ch ? sample(ch, seed).length : 0);
  return {
    comfy: len(longest((ch) => reasonsFits(make(ch), themes, stage).comfortable, max)),
    hardMax: len(longest((ch) => reasonsFits(make(ch), themes, stage).fits, max)),
  };
}
const capOf = (gold: number, m: { comfy: number; hardMax: number }): Cap =>
  gold <= 0 || m.hardMax <= 0
    ? { cap: 0, hardMax: 0 }
    : { cap: Math.min(gold, m.comfy || m.hardMax), hardMax: m.hardMax };

export function measureReasonsCaps(
  age: AgeKey,
  chain: boolean,
  n: number,
  themes: readonly Theme[] = THEMES,
  picture = false,
): ReasonsCaps {
  withPicture = picture;
  const stage = REASONS_AGES[age];
  const g = GOLD_CAPS[age];
  const allowed = chain ? n === 3 || (n === 4 && age !== "early") : n <= REASONS_MAX[age];
  const zero = { cap: 0, hardMax: 0 };
  if (!allowed) return { question: zero, lead: zero, head: zero, line: zero };
  const base = SHORT.slice(0, n);
  const lineMax = chain && n === 4 ? CHAIN_SHORT_LINE : 240;
  const list = (field: "head" | "line") => {
    const all = (ch: number) =>
      inputOf(
        base.map((r, i) => ({ ...r, [field]: sample(ch, i * 3) })),
        chain,
      );
    const one = (ch: number) =>
      inputOf(
        base.map((r, i) => (i ? r : { ...r, [field]: sample(ch, 0) })),
        chain,
      );
    const max = field === "line" ? lineMax : 240;
    const a = measure(themes, stage, all, 0, max);
    const b = measure(themes, stage, one, 0, max);
    return { comfy: Math.min(a.comfy, b.comfy), hardMax: Math.min(a.hardMax, b.hardMax) };
  };
  const lineGold = chain ? (n === 4 ? CHAIN_SHORT_LINE : g.chainLine) : n >= 4 ? g.line4 : g.line;
  return {
    question: capOf(
      g.question,
      measure(themes, stage, (ch) => inputOf(base, chain, `${sample(ch, 7)}?`), 7),
    ),
    lead: capOf(
      g.lead,
      measure(themes, stage, (ch) => inputOf(base, chain, QUESTION, sample(ch, 11)), 11),
    ),
    head: capOf(g.head, list("head")),
    line: capOf(lineGold, list("line")),
  };
}

if (import.meta.main)
  for (const [picture, file] of [
    [false, "./reasons-capacity.json"],
    [true, "./reasons-picture-capacity.json"],
  ] as const) {
    const out: Record<string, Record<string, ReasonsCaps>> = {};
    for (const age of ["early", "primary", "secondary"] as const) {
      out[age] = {};
      for (const [chain, n] of [
        [false, 2],
        [false, 3],
        [false, 4],
        [true, 3],
        [true, 4],
      ] as const) {
        const caps = measureReasonsCaps(age, chain, n, THEMES, picture);
        (out[age] as Record<string, ReasonsCaps>)[capsKey(chain, n)] = caps;
        console.log(picture ? "picture" : "", age, capsKey(chain, n), JSON.stringify(caps));
      }
    }
    writeFileSync(new URL(file, import.meta.url), `${JSON.stringify(out, null, 2)}\n`);
  }
