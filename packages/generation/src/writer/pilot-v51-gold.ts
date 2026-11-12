import ITEMS_ROW_CAPACITY from "@tj/slides/templates/items-row-capacity.json" with { type: "json" };
import PANEL_LIST_CAPACITY from "@tj/slides/templates/panel-list-capacity.json" with {
  type: "json",
};
import { KEY_CAPS, KEY_FIT, PT_CAPS } from "@tj/slides/templates/picture-text";
import SPLIT_COMPARE_CAPACITY from "@tj/slides/templates/split-compare-capacity.json" with {
  type: "json",
};
import modelLine from "./bundles/pilot-v5.1-gold/wave-c-model-line.txt" with { type: "text" };
import stepModelLine from "./bundles/pilot-v5.1-gold/wave-c-step-model-line.txt" with {
  type: "text",
};
import { fitSlots, headingWords } from "./fit-fits";
import { fitTable } from "./fixes";
import { assembleWriterSystem, LAYOUT_WRITER_MENUS, WRITER_RULES } from "./layout-menu";
import type { WriterStage } from "./schema";
import { shownFor, wordsWithin } from "./shown-cap";
import { waveCMenu } from "./wave-c";

/*
 * Pilot pack v5.1-gold (11 Nov 2026, lab runs only, selected by id): the v5.1-gold templates
 * (scratchpad/tuning/v5.1-gold) wired to the numbers measured on the gold looks. Every word limit
 * the templates state is a `{{fits:<name>}}` slot filled here from code's tables: the fit layouts
 * from `fit-table-gold.gen.json` (`fitTable({ gold: true })`), the menu and wave C layouts from
 * their gold `*-capacity.json` (as the live pack's menu lines are), and the picture-and-text caps
 * from the gold template itself (`PT_CAPS`, `KEY_FIT`, `KEY_CAPS`). No number is typed here.
 *
 * The live pack (v5.0b) reads none of this: its fit table, menu lines and model lines are as
 * they were (pinned by `pilot-v51-gold.test.ts`).
 */
type J = Record<string, any>;
type Age = "early" | "primary" | "secondary";
const AGE: Record<WriterStage, Age> = { KS1: "early", KS2: "primary", "KS3-5": "secondary" };
const GOLD = { gold: true } as const;

/** Layouts this pack takes off the menu: their defs leave the schema and their slots the text. */
export const V51_RETIRED = ["explain", "big-visual", "picture-sequence"] as const;
/** Fits never sent: labelled points (callouts leave), and equation-hero's 4-term fit. */
export const V51_ROUTED_FITS = [
  "visual-text~points-1-key-fig",
  "visual-text~points-2-key-fig",
  "equation-hero~points-4",
] as const;

/** The routed fits at a stage: equation-hero beside a figure where the gold table holds no formula there. */
export function v51Routed(stage: WriterStage): string[] {
  const F = fitTable(GOLD)[stage] as J;
  const beside = Number(F?.formulaBesideFigure ?? 0) > 0;
  return [
    ...V51_ROUTED_FITS,
    ...(beside ? [] : ["equation-hero~points-2-fig", "equation-hero~points-3-fig"]),
  ];
}

/** Layouts off the menu at a stage (KS1 has no formulas, so no equation slide). */
export const v51RetiredAt = (stage: WriterStage): string[] => [
  ...V51_RETIRED,
  ...(stage === "KS1" ? ["equation-hero"] : []),
];

const words = (n: number) => (n === 1 ? "one word" : `up to ${n} words`);

/** The heading a layout with no heading number of its own takes: the tighter of the gold title and the measured heading. */
export const v51Heading = (stage: WriterStage): number =>
  Math.min(PT_CAPS[stage].title, headingWords(stage));

/** The Fits clause of each line in a carrier assembled from code's menu lines (`- <layout>: … Fits: …`). */
function menuClauses(stage: WriterStage): Record<string, string> {
  const layouts = Object.keys(LAYOUT_WRITER_MENUS);
  const carrier = `\n${layouts.map((l) => `{{menu:${l}}}`).join("\n")}\n{{menu:wave-c}}\n{{rule:answers}}`;
  const text = assembleWriterSystem(carrier, stage, { reasonsPicture: true });
  const out: Record<string, string> = {};
  const lines = [
    ...text.split("\n"),
    waveCMenu(stage, { reasonsPicture: true })["steps step-model"],
  ];
  for (const line of lines) {
    const m = /^- ([a-z-]+(?: [a-z-]+)?): /.exec(line ?? "");
    if (!m || !line) continue;
    const parts = line.split(" Fits: ");
    if (parts.length !== 2)
      throw new Error(`pack v5.1-gold (${stage}): ${m[1]} needs one Fits clause`);
    out[m[1] as string] = `Fits: ${parts[1]}`;
  }
  return out;
}

/** Replace `from` (a string or pattern) exactly once in a generated clause, or throw. */
function once(text: string, from: RegExp, to: string, what: string): string {
  const n = (text.match(new RegExp(from.source, `${from.flags.replace("g", "")}g`)) ?? []).length;
  if (n !== 1) throw new Error(`pack v5.1-gold: ${what} not found once (${n})`);
  return text.replace(from, to);
}

/** The fewest words a name holds in any measured items-row cell with no lead (this pack's lead is null). */
function itemsRowName(stage: WriterStage): number {
  const rows = ((ITEMS_ROW_CAPACITY as J)[AGE[stage]] as J[]).filter(
    (r) => !r.withLead && r.name?.cap > 0,
  );
  if (!rows.length) throw new Error(`pack v5.1-gold (${stage}): no items-row name cells`);
  return Math.max(1, Math.min(...rows.map((r) => wordsWithin(r.name.cap, stage))));
}
/** The fewest words a name holds in any measured panel-list cell at this age (with and without pictures). */
function panelListName(stage: WriterStage): number {
  const cells = Object.values((PANEL_LIST_CAPACITY as J)[AGE[stage]] as J) as J[];
  const caps: number[] = [];
  for (const c of cells) {
    if (c?.name?.cap) caps.push(c.name.cap);
    if (c?.withLead?.name?.cap) caps.push(c.withLead.name.cap);
    if (c?.pictures?.name?.cap) caps.push(c.pictures.name.cap);
  }
  if (!caps.length) throw new Error(`pack v5.1-gold (${stage}): no panel-list name cells`);
  return Math.max(1, Math.min(...caps.map((n) => wordsWithin(n, stage))));
}
/** A side title's words per side count: the fewest over the measured words-only and picture cells' caps. */
function sideTitles(stage: WriterStage): Record<string, number> {
  const g = (SPLIT_COMPARE_CAPACITY as J)[stage] as Record<string, J>;
  const out: Record<string, number> = {};
  for (const [n, cells] of Object.entries(g)) {
    const ws = ["text", "picture"].flatMap((k) =>
      cells[k]?.title?.cap > 0 ? [wordsWithin(Number(cells[k].title.cap), stage)] : [],
    );
    if (ws.length) out[n] = Math.min(...ws);
  }
  return out;
}

/**
 * Every slot the v5.1-gold templates name, filled for a stage. Fit layouts come from the gold
 * fit table; menu and wave C layouts from code's own generated Fits, with the gold limits the
 * live lines leave unstated added (per-layout heading, key card lead and card count, names,
 * side titles, the hinge question, the equation slide's formula).
 */
export function v51Slots(stage: WriterStage): Record<string, string> {
  const routed = v51Routed(stage);
  const fits = fitSlots(stage, routed, GOLD);
  const menu = menuClauses(stage);
  const F = fitTable(GOLD)[stage] as J;
  const pt = PT_CAPS[stage];
  const kf = KEY_FIT[stage];
  const head = v51Heading(stage);
  const ptHead = `heading ${words(pt.title)}`;
  const out: Record<string, string> = {
    heading: String(head),
    "plan-share": fits["plan-share"] as string,
    title: fits.title as string,
    hook: fits.hook as string,
    discussion: fits.discussion as string,
    steps: fits.steps as string,
    pair: fits.pair as string,
    "group-sort": fits["group-sort"] as string,
    sequence: fits.sequence as string,
    "odd-one-out": fits["odd-one-out"] as string,
    "visual-text": (fits["visual-text"] as string).replace(/^Fits: /, `Fits: ${ptHead}; `),
  };
  if (stage !== "KS1") {
    const eq = (F.layouts["equation-hero"]?.variants ?? []) as J[];
    const hd = eq.map((v) => Number(v.headingMax ?? 0)).filter((n) => n > 0);
    const eqHead = hd.length ? Math.min(...hd.map((n) => wordsWithin(n, stage))) : head;
    const beside = Number(F.formulaBesideFigure ?? 0);
    out["equation-hero"] = (fits["equation-hero"] as string).replace(
      /^Fits: /,
      `Fits: heading ${words(eqHead)}; the formula up to ${F.formula} characters${beside > 0 ? `, ${beside} beside a figure` : ""}; `,
    );
  }
  // Key card: the gold key-card look's measured room (KEY_FIT) for the lead and the meaning, and
  // how many cards fit; the per-field ceilings are the gold's (KEY_CAPS).
  const cards = kf.cards;
  out["key-card"] =
    `Fits: ${ptHead}; the lead ${words(kf.words["1"])}; ${cards === 1 ? "one card" : `up to ${cards} cards`}; ` +
    `each label ${words(KEY_CAPS.label)}; a term ${words(KEY_CAPS.term)}; a meaning ${words(kf.words["1"])}` +
    `${cards > 1 && kf.words["2"] ? `, or ${kf.words["2"]} with two cards` : ""}; up to ${KEY_CAPS.pairs} example pairs, ` +
    `${words(KEY_CAPS.side)} a side; a number up to ${KEY_CAPS.num} characters, its unit ${words(KEY_CAPS.unit)}.`;
  // items-row's lead is null in this pack, so its with-a-lead cells leave the Fits.
  const row = (menu["items-row"] as string).replace(
    /; with a lead of up to \d+ words.*(?=\.$)/,
    "",
  );
  out["items-row"] = once(
    row,
    /^Fits: /,
    `Fits: each name ${words(itemsRowName(stage))}; `,
    "items-row Fits",
  );
  out["panel-list"] = once(
    menu["panel-list"] as string,
    /^Fits: /,
    `Fits: each name ${words(panelListName(stage))}; `,
    "panel-list Fits",
  );
  const st = sideTitles(stage);
  const stText = Object.entries(st)
    .map(([n, w], i) => (i ? `${w} with ${n}` : `${words(w)} with ${n} sides`))
    .join(", ");
  out["split-compare"] = once(
    menu["split-compare"] as string,
    /^Fits: /,
    `Fits: heading ${words(head)}; each side's title ${stText}; `,
    "split-compare Fits",
  );
  // The hinge question: the gold hinge's stem room in the gold fit table, shown as the menu shows it.
  const stems = ((F.layouts.hinge?.variants ?? []) as J[])
    .map((v) => Number(v.stem ?? 0))
    .filter(Boolean);
  if (!stems.length) throw new Error(`pack v5.1-gold (${stage}): no hinge stem in the gold table`);
  const q = Math.max(1, shownFor(Math.min(...stems), stage, "hinge.question"));
  out.hinge = once(
    menu.hinge as string,
    /the question up to \d+ words/,
    `the question ${words(q)}`,
    "hinge question",
  );
  for (const k of ["question-set", "practice", "exit-ticket"])
    out[k] = once(menu[k] as string, /^Fits: /, `Fits: heading ${words(head)}; `, `${k} Fits`);
  // Worked: the writer no longer writes a panel; code adds the bar model, and the check is a row.
  out.worked = once(
    menu.worked as string,
    /up to (\d+) rows, or (\d+) with a panel/,
    "up to $1 rows, the check counted, or $2 where code adds a bar model",
    "worked rows",
  );
  out.stages = once(
    menu.stages as string,
    /^Fits: /,
    `Fits: heading ${words(head)}; `,
    "stages Fits",
  );
  out.reasons = menu.reasons as string;
  out["figure-slide"] = once(
    menu["figure-slide"] as string,
    /^Fits: /,
    `Fits: heading ${words(head)}; `,
    "figure-slide Fits",
  );
  out.myth = menu.myth as string;
  out["step-model"] = menu["steps step-model"] as string;
  for (const [k, v] of Object.entries(out))
    if (!v) throw new Error(`pack v5.1-gold (${stage}): slot ${k} has no text`);
  return out;
}

/** A v5.1-gold template with every slot filled; throws on a missing, repeated or unknown slot. */
export function v51System(template: string, stage: WriterStage): string {
  const slots = v51Slots(stage);
  let out = template;
  for (const [name, text] of Object.entries(slots)) {
    // step-model's Fits go in its own line, sent only with a Models list (`withV51ModelLines`).
    if (name === "step-model") continue;
    const slot = `{{fits:${name}}}`;
    const n = out.split(slot).length - 1;
    if (n > 1) throw new Error(`pack v5.1-gold (${stage}): ${slot} appears ${n} times`);
    // equation-hero has no line at KS1; every other slot must be in the template.
    if (n === 0) throw new Error(`pack v5.1-gold (${stage}): ${slot} is not in the template`);
    out = out.replace(slot, () => text);
  }
  // Where the gold table holds no formula beside a figure, the equation slide is offered bare only.
  if (v51Routed(stage).includes("equation-hero~points-2-fig")) {
    const beside =
      " A graph or diagram sits beside it only when the relationship is read from one.";
    if (out.includes("- equation-hero: ")) {
      if (out.split(beside).length !== 2)
        throw new Error(
          `pack v5.1-gold (${stage}): equation-hero's figure sentence not found once`,
        );
      out = out.replace(beside, "");
    }
  }
  const rule = "{{rule:answers}}";
  if (out.split(rule).length !== 2) throw new Error(`pack v5.1-gold (${stage}): ${rule} not once`);
  out = out.replace(rule, () => WRITER_RULES.answers);
  if (out.includes("{{")) throw new Error(`pack v5.1-gold (${stage}): an unfilled slot`);
  return out;
}

/** The library's model menu line as the live wave C packs send it (unchanged for them). */
const LIB_LINE_START = "- model: a ready-made teaching model from the Models list";
/**
 * v5.1-gold's two model blocks, pack-owned: the library's model line is replaced whole by the
 * pack's, and the step-model line (its Fits from code) goes after the steps line. A lesson with no
 * Models list is unchanged, so step-model is neither offered nor described.
 */
export function withV51ModelLines(system: string, stage: WriterStage): string {
  if (!system.includes("\nModels (id")) return system;
  const lines = system.split("\n");
  const at = lines.findIndex((l) => l.startsWith(LIB_LINE_START));
  if (at < 0 || lines.filter((l) => l.startsWith(LIB_LINE_START)).length !== 1)
    throw new Error("pack v5.1-gold: the library model line not found once");
  lines[at] = modelLine;
  const steps = lines.findIndex((l) => l.startsWith("- steps: "));
  if (steps < 0 || lines.filter((l) => l.startsWith("- steps: ")).length !== 1)
    throw new Error("pack v5.1-gold: no single steps line to put step-model's line after");
  const slot = "{{fits:step-model}}";
  if (stepModelLine.split(slot).length !== 2)
    throw new Error("pack v5.1-gold: step-model slot not once");
  lines.splice(
    steps + 1,
    0,
    stepModelLine.replace(slot, () => v51Slots(stage)["step-model"] as string),
  );
  return lines.join("\n");
}
