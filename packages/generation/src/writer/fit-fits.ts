import { fitsLine as activityFitsLine, type WriterActivity } from "./activities";
import c1 from "./bundles/pilot-v4.5/base-KS1.schema.json" with { type: "json" };
import c2 from "./bundles/pilot-v4.5/base-KS2.schema.json" with { type: "json" };
import c3 from "./bundles/pilot-v4.5/base-KS3.schema.json" with { type: "json" };
import type { WriterStage } from "./schema";
import { MIN_SHOWN_WORDS, offerable, PLAN_SHARE, shownWords } from "./shown-cap";
import { defCaps, fitsLines } from "./slot-fill";

/*
 * The fit layouts' Fits, generated (loop 1 prompt part, 17 Oct 2026; build/LOG-loop1-prompt.md).
 * A pack template names each fit layout's Fits by slot (`{{fits:<layout>}}`), the heading's words
 * by `{{fits:heading}}` and each activity's by `{{fits:<activity>}}`; no word or character count
 * is typed into a template. The numbers come from the caps code checks a slide against (the v4.5
 * request, whose per-fit `maxLength`s are the measured fit table's, pinned by fit-fits.test.ts),
 * shown at `SHOWN_SHARE` through `shown-cap.ts`. A fit whose shown body cap is under
 * `MIN_SHOWN_WORDS`, or a cliff below the previous count, is not offered: its line leaves the
 * Fits and its def leaves the schema the writer is sent (`droppedFits`).
 */
type J = Record<string, any>;

/** The caps code checks, per stage (pilot-v4.5's per-fit defs: `layout~key`). */
const CAPS: Record<WriterStage, J> = { KS1: c1, KS2: c2, "KS3-5": c3 };

/** The layouts a pilot base schema splits per fit, each worded in the template by slot. */
export const FIT_LAYOUTS = [
  "title",
  "hook",
  "visual-text",
  "big-visual",
  "picture-sequence",
  "steps",
  "equation-hero",
  "discussion",
  "explain",
] as const;
/** The activities whose card-label room the template names by slot (`activities.ts` fitsLine). */
export const FIT_ACTIVITIES = ["pair", "group-sort", "sequence", "odd-one-out"] as const;

/**
 * Fields the floor does not apply to, since words are not their unit: a heading or key label (the
 * measured words, as layout-menu.ts keeps headings and side titles), a picture-sequence caption
 * (it only names its stage), and equation-hero's points (one calculation line each). Their numbers
 * are still generated and shown at the same share. Settled by the decision desk, 17 Oct 2026
 * (LOG-loop1-prompt.md, LOG-loop1-live.md).
 */
function floored(layout: string, path: string): boolean {
  if (path === "heading" || path === "formula" || path.endsWith("[].label")) return false;
  if (path.endsWith("[].caption")) return false;
  if (layout === "equation-hero" && path === "points[]") return false;
  return true;
}

/** `points-2-key-fig` -> count 2 and family `points-key-fig`; `fig` -> no count. */
function countOf(key: string): { family: string; count?: number } {
  const m = /^([a-z]+)-(\d+)(.*)$/.exec(key);
  // A fit with no items (`points-0-fig`, a lead alone) is a shape of its own, never a count.
  return m && m[2] !== "0" ? { family: `${m[1]}${m[3]}`, count: Number(m[2]) } : { family: key };
}

/** One layout's fits (`layout~key` defs) in the order the caps schema gives them. */
function fitDefs(stage: WriterStage, layout: string): [string, J][] {
  const defs = CAPS[stage].$defs as Record<string, J>;
  const out = Object.entries(defs).filter(([k]) => k.startsWith(`${layout}~`));
  if (!out.length) throw new Error(`fit fits: no ${layout} fits at ${stage}`);
  return out;
}

/** The fewest words a fit's floored fields are shown (Infinity when it has none). */
function bodyWords(stage: WriterStage, layout: string, def: J): number {
  const caps = defCaps(def)
    .filter(([p, n]) => n > 0 && floored(layout, p))
    .map(([, n]) => shownWords(n, stage));
  return caps.length ? Math.min(...caps) : Number.POSITIVE_INFINITY;
}

/** The fit keys offered per layout at a stage: the floor, then no cliff within a family. */
export function fitOffer(stage: WriterStage): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const layout of FIT_LAYOUTS) {
    const fits = fitDefs(stage, layout).map(([k, def]) => {
      const key = k.slice(layout.length + 1);
      return { key, ...countOf(key), words: bodyWords(stage, layout, def) };
    });
    const keep = new Set<string>();
    for (const family of new Set(fits.map((f) => f.family))) {
      const fam = fits.filter((f) => f.family === family);
      if (fam.some((f) => f.count === undefined)) {
        for (const f of fam) if (f.words >= MIN_SHOWN_WORDS) keep.add(f.key);
        continue;
      }
      const pairs = fam
        .map((f): [number, number] => [f.count as number, f.words])
        .sort((a, b) => a[0] - b[0]);
      for (const [n] of offerable(pairs)) keep.add(fam.find((f) => f.count === n)?.key as string);
    }
    const kept = fits.map((f) => f.key).filter((k) => keep.has(k));
    if (!kept.length) throw new Error(`fit fits: ${layout} offers nothing at ${stage}`);
    out[layout] = kept;
  }
  return out;
}

/** The `layout~key` defs a pack drops from the schema it sends, so the writer cannot pick them. */
export function droppedFits(stage: WriterStage): string[] {
  const offer = fitOffer(stage);
  return FIT_LAYOUTS.flatMap((layout) =>
    fitDefs(stage, layout)
      .map(([k]) => k)
      .filter((k) => !offer[layout]?.includes(k.slice(layout.length + 1))),
  );
}

/**
 * A slide heading's words at a stage: the measured heading cap the v4.5 request checks (KS1 5,
 * KS2 10, KS3-5 10 at 17 Oct). Headings are labels, so the measured words, not the 75% share; the
 * menu layouts' headings rise to it too (decision desk, 17 Oct 2026).
 */
export function headingWords(stage: WriterStage): number {
  return Number(fitSlots(stage).heading);
}

/**
 * Each slot's generated text at a stage: `heading` (words), each fit layout's and activity's
 * `Fits: ….`, and `plan-share` (the flow step's headroom, `PLAN_SHARE`).
 */
export function fitSlots(stage: WriterStage): Record<string, string> {
  const offer = fitOffer(stage);
  const $defs: J = {};
  for (const layout of FIT_LAYOUTS)
    for (const [k, def] of fitDefs(stage, layout))
      if (offer[layout]?.includes(k.slice(layout.length + 1))) $defs[k] = def;
  const { heading } = fitsLines({ $defs }, stage, { namedLabels: true });
  if (!heading) throw new Error(`fit fits: no heading cap at ${stage}`);
  const out: Record<string, string> = { heading: String(heading) };
  for (const layout of FIT_LAYOUTS) {
    // One layout at a time, so a line never points at another's ("Fits: as steps.").
    const own = Object.fromEntries(
      Object.entries($defs).filter(([k]) => k.startsWith(`${layout}~`)),
    );
    const line = fitsLines({ $defs: own }, stage, { namedLabels: true }).lines[layout];
    if (!line) throw new Error(`fit fits: ${layout} has no line`);
    out[layout] = line;
  }
  for (const id of FIT_ACTIVITIES)
    out[id] = `Fits: ${activityFitsLine(id as WriterActivity, stage)}.`;
  // The flow step's headroom (loop 1b): a share of the shown Fits, never a typed number.
  out["plan-share"] = `${Math.round(PLAN_SHARE * 100)}%`;
  return out;
}

/**
 * A template's `{{fits:<name>}}` slots filled for a stage. Throws on a missing, repeated or
 * unknown slot, so no Fits can ship hand-typed or unfilled.
 */
export function withFits(template: string, stage: WriterStage): string {
  let out = template;
  for (const [name, text] of Object.entries(fitSlots(stage))) {
    const slot = `{{fits:${name}}}`;
    if (out.split(slot).length !== 2)
      throw new Error(`writer system: ${slot} must appear exactly once`);
    out = out.replace(slot, () => text);
  }
  if (out.includes("{{")) throw new Error("writer system: an unknown {{...}} slot");
  return out;
}
