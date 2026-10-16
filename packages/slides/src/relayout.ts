/**
 * Adaptive layouts in the editor (TEACH-205 part b; UX rulings 215, 199, 102). A group that carries
 * a `LayoutRef` is re-laid by its template, never box by box: editing, adding or removing an item
 * changes the ref's input and runs `layoutTemplate` again. This module is the pure half the editor
 * reducers call (they take `relayout` as an argument, so the templates load only when a layout
 * group is edited) and the writer wraps its result with (`layoutGroup`).
 *
 * A template plugs in by being live in `layoutTemplate` and having an entry in `ADAPTIVE_SPECS`
 * (which input key holds its items, its min and max). Its ruling-215 limits come from
 * `TemplateResult.fields` when the template reports them (`{ path, cap, hardMax }` per field);
 * cards-grid, which predates `fields`, reads its published capacity table instead.
 */
import type {
  AdaptiveTemplateId,
  GroupElement,
  LayoutFrame,
  LayoutRef,
  Slide,
  SlideElement,
  Theme,
} from "@tj/domain/documents";
import { layoutTemplate, type Stage, type TemplateInput, type TemplateResult } from "./templates";
import { GRID_MAX, GRID_NAMES } from "./templates/cards-grid";
import CARDS_GRID_CAPACITY from "./templates/cards-grid-capacity.json" with { type: "json" };
// TEACH-230 part b (B2).
import {
  ANSWERS_NAMES,
  type AnswerGroup,
  type AnswersPage,
  answerGroupsOf,
  endAnswerSlides,
  layoutAnswersGuard,
  layoutAnswersPage,
} from "./templates/end-answers";
import { EXIT_MAX } from "./templates/exit-ticket";
import { HINGE_MAX, HINGE_MIN, hingePaths } from "./templates/hinge";
import { blankRowItem, PLACEHOLDER_ICON, ROW_MAX, ROW_MIN, ROW_NAMES } from "./templates/items-row";
import { PANEL_MAX, PANEL_MIN, panelListPaths } from "./templates/panel-list";
import { PRACTICE_MAX, PRACTICE_MIN, workPaths } from "./templates/practice";
// TEACH-75 part ad (C5).
import { REASONS_MAX, REASONS_MIN, reasonsPaths } from "./templates/reasons";
import { SOURCE_MAX, SOURCE_MIN, sourcePaths } from "./templates/source";
import { SPLIT_MAX, SPLIT_MIN, splitPaths } from "./templates/split-compare";
// TEACH-75 part ac (C4).
import { blankStage, STAGES_MAX, STAGES_MIN, stagesPaths } from "./templates/stages";
// TEACH-17 part b (C1).
import { WORKED_MIN, workedMax, workedPaths } from "./templates/worked";
import { resolveTextStyle } from "./text-style";
import { ageProfileOf } from "./theme-v2";

/** How one adaptive template's items behave in the editor. */
export type AdaptiveSpec = {
  /** The input key that holds the item list. */
  items: string;
  /** Fewest items: remove is refused below it. */
  min: number;
  /** Most items at a stage: add is refused at it. */
  max: (stage: Stage) => number;
  /** A fresh item for add, in teacher words the teacher then overwrites. */
  blank: () => unknown;
  /** Whether the layout has its own continuation (split onto a second slide). */
  continuation: boolean;
  /** The noun a refusal names ("cards", "items"). */
  noun: string;
  /**
   * Which input path each laid element shows, in draw order (undefined: not editable through the
   * ref). Without it only the heading and lead are bound; cards-grid is bound by its card names.
   */
  paths?: (els: SlideElement[]) => (string | undefined)[];
  /**
   * The neutral icon a blank item carries (items-row: `PLACEHOLDER_ICON`), so adding an item to an
   * icon row keeps every icon. An item still on it is re-resolved from its name when the name is
   * committed (`iconFor`), and keeps the placeholder until the name matches a concept.
   */
  placeholderIcon?: string;
  /** The library concept a name matches, if any (items-row: the icon library's `matchIcon`). */
  iconFor?: (name: string) => string | null | undefined;
};

/** items-row: the heading, the lead, and each item's name and line (a line follows its name). */
function itemsRowPaths(els: SlideElement[]): (string | undefined)[] {
  let item = -1;
  return els.map((el) => {
    if (el.name === "Heading") return "heading";
    if (el.name === ROW_NAMES.lead) return "lead";
    if (el.name === ROW_NAMES.name) return `items.${++item}.name`;
    if (el.name === ROW_NAMES.text) return item < 0 ? undefined : `items.${item}.text`;
    return undefined;
  });
}

/**
 * The adaptive templates. The three pilot layouts are listed so they plug in when their recipes
 * land in `layoutTemplate` (until then `relayout` refuses them: the template is not live).
 */
export const ADAPTIVE_SPECS: Record<AdaptiveTemplateId, AdaptiveSpec> = {
  "cards-grid": {
    items: "grid",
    min: 2,
    max: () => GRID_MAX,
    blank: () => ({ label: "New card", text: "Add a sentence here." }),
    continuation: true,
    noun: "cards",
  },
  "items-row": {
    items: "items",
    min: ROW_MIN,
    // The row's own range (four at every age): five or six items never fit, so add stops at four.
    max: (stage) => ROW_MAX[ageProfileOf(stage)],
    blank: blankRowItem,
    placeholderIcon: PLACEHOLDER_ICON,
    continuation: true,
    noun: "items",
    paths: itemsRowPaths,
  },
  "panel-list": {
    items: "rows",
    min: PANEL_MIN,
    // Six rows never fit at KS1-2 (every field's hard maximum is 0 there), so add stops at five.
    max: (stage) => (ageProfileOf(stage) === "secondary" ? PANEL_MAX : PANEL_MAX - 1),
    blank: () => ({ name: "New row", text: "Add a sentence here." }),
    continuation: true,
    noun: "rows",
    paths: panelListPaths,
  },
  "split-compare": {
    items: "sides",
    min: SPLIT_MIN,
    max: () => SPLIT_MAX,
    blank: () => ({ title: "New side", text: "Add a sentence here." }),
    // A compare splits like the others (each side keeps its words and picture): Split is offered
    // wherever the over chip is.
    continuation: true,
    noun: "sides",
    paths: splitPaths,
  },
  // TEACH-230 part b (B2): tasks and exit questions are plain strings under `questions`.
  practice: {
    items: "questions",
    min: PRACTICE_MIN,
    max: () => PRACTICE_MAX,
    blank: () => "Add a task here.",
    // More than six tasks carry onto a second practice slide (`splitPractice`).
    continuation: true,
    noun: "tasks",
    paths: workPaths,
  },
  "exit-ticket": {
    items: "questions",
    min: 1,
    max: () => EXIT_MAX,
    blank: () => "Add a question here.",
    // At most three questions (ruling 108): an exit ticket never continues.
    continuation: false,
    noun: "questions",
    paths: workPaths,
  },
  hinge: {
    items: "options",
    min: HINGE_MIN,
    // KS1 takes 2-3 options (gold caps); 4 from KS2.
    max: (stage) => (ageProfileOf(stage) === "early" ? HINGE_MAX - 1 : HINGE_MAX),
    blank: () => "New answer",
    // A question is never split (rulings 91, 102): over is flagged, the teacher cuts.
    continuation: false,
    noun: "options",
    paths: hingePaths,
  }, // TEACH-75 part ac (C4): 3-6 stages (5 at early); a 7th is over and Split makes two slides.
  stages: {
    items: "stages",
    min: STAGES_MIN,
    max: (stage) => STAGES_MAX[ageProfileOf(stage)],
    blank: blankStage,
    placeholderIcon: PLACEHOLDER_ICON,
    continuation: true,
    noun: "stages",
    paths: stagesPaths,
  },
  // TEACH-17 part b (C1): one working line per row; the check is its own field, not a line.
  worked: {
    items: "lines",
    min: WORKED_MIN,
    // A slide holds 6 rows at KS3-5 and 5 at KS1-2, the check among them (worked-capacity.json).
    max: (stage) => workedMax(stage) - 1,
    blank: () => ({ move: "New step", eq: "x = 1" }),
    // Past the rows a slide holds, the working continues on a second slide (`splitWorked`).
    continuation: true,
    noun: "lines",
    paths: workedPaths,
  },
  // TEACH-75 part ab (C2): a source's notes, 2-4 at every age; an over-long extract splits at a
  // sentence or stanza (`splitSource`).
  source: {
    items: "notes",
    min: SOURCE_MIN,
    max: () => SOURCE_MAX,
    blank: () => ({ anchor: "", label: "New note", text: "Add a short note." }),
    continuation: true,
    noun: "notes",
    paths: sourcePaths,
  },
  // TEACH-75 part ad (C5): reasons under `reasons`, 2-3 at KS1 and 2-4 from KS2. A question is
  // never split: over is flagged and the teacher merges or cuts.
  reasons: {
    items: "reasons",
    min: REASONS_MIN,
    max: (stage) => REASONS_MAX[ageProfileOf(stage)],
    blank: () => ({ head: "New reason", line: "Add a sentence here." }),
    continuation: false,
    noun: "reasons",
    paths: reasonsPaths,
  },
};

/** The lesson age bands that are not key stage names, as the writer lays them out. */
const BAND_STAGE: Readonly<Record<string, Stage>> = { eyfs: "ks1", post16: "ks5" };
const STAGES: readonly string[] = ["ks1", "ks2", "ks3", "ks4", "ks5"];
const asStage = (v: unknown): Stage | undefined =>
  typeof v !== "string"
    ? undefined
    : STAGES.includes(v)
      ? (v as Stage)
      : Object.hasOwn(BAND_STAGE, v)
        ? BAND_STAGE[v]
        : undefined;

/**
 * The stage a lesson's layouts are laid out at: the theme's bound stage (`atKeyStage`), else the
 * lesson's band. Read here rather than through `keyStageOf`, so the lazy layout panel keeps no
 * extra theme exports alive in the chunks every lesson page loads.
 */
export function stageOf(theme: Theme, ageBand: string | null | undefined): Stage {
  return asStage((theme as { keyStage?: unknown }).keyStage) ?? asStage(ageBand) ?? "ks3";
}

/** A slide's content without its id or any element's id and geometry, keys sorted. */
function contentOf(slide: Slide, sizes = true): string {
  const drop = new Set([
    "id",
    "x",
    "y",
    "w",
    "h",
    ...(sizes ? [] : ["fontSize", "lineHeight", "radius"]),
  ]);
  const norm = (v: unknown, top = false): unknown =>
    Array.isArray(v)
      ? v.map((x) => norm(x))
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              // Empty notes are no notes: a loaded lesson gives every slide `notes: ""`.
              .filter((k) =>
                top
                  ? k !== "id" && !(k === "notes" && !(v as { notes?: unknown }).notes)
                  : !drop.has(k),
              )
              .sort()
              .map((k) => [k, norm((v as Record<string, unknown>)[k])]),
          )
        : v;
  return JSON.stringify(norm(JSON.parse(JSON.stringify(slide)), true));
}

/**
 * The stored Answers slides' page split, read back as the builder's pages: each band (a kicker,
 * then one badge per answer) takes the next answers of `groups` in order. Null when the slides do
 * not hold exactly the groups' answers in that order.
 */
function storedPages(old: readonly Slide[], groups: readonly AnswerGroup[]): AnswersPage[] | null {
  const pages: AnswerGroup[][] = [];
  let gi = 0;
  let ii = 0;
  for (const slide of old.filter((s) => s.answersRole === "answers")) {
    const bands: number[] = [];
    for (const e of slide.elements) {
      if (e.name === ANSWERS_NAMES.kicker) bands.push(0);
      else if (e.name === "surface:badge" && bands.length)
        bands[bands.length - 1] = (bands[bands.length - 1] as number) + 1;
    }
    const page: AnswerGroup[] = [];
    for (const n of bands) {
      const g = groups[gi];
      const items = g?.items.slice(ii, ii + n) ?? [];
      if (!g || n === 0 || items.length !== n) return null;
      page.push({ ...g, items });
      ii += n;
      if (ii === g.items.length) [gi, ii] = [gi + 1, 0];
    }
    pages.push(page);
  }
  if (gi !== groups.length || ii !== 0) return null;
  return pages.map((p, k) => ({ groups: p, page: k + 1, of: pages.length }));
}

/**
 * Answers slides built before their sizes were the drawn sizes (TEACH-191 part d) never match a
 * rebuild exactly. They still count as untouched when every slide is exactly what the builder
 * makes for the same answers in the same page split, sizes, radii and places aside: every
 * element, word, format, colour and reveal step is compared, so any edit keeps them all.
 */
function untouchedAnswers(
  old: readonly Slide[],
  groups: readonly AnswerGroup[],
  theme: Theme,
  stage: Stage,
): boolean {
  const pages = storedPages(old, groups);
  if (!pages) return false;
  const rebuilt = [
    layoutAnswersGuard(theme, stage).slide,
    ...pages.map((p) => layoutAnswersPage(p, theme, stage).slide),
  ];
  return (
    rebuilt.length === old.length &&
    rebuilt.every((s, i) => contentOf(s, false) === contentOf(old[i] as Slide, false))
  );
}

/**
 * The deck's guard and Answers slides built again for a theme switch (TEACH-191 part c), or null
 * when they stay exactly as they are.
 *
 * Their row heights are each answer's wrapped height measured in the faces of the theme they were
 * built in, so drawn in a theme with wider faces a wrapped answer runs into the next row. One rule:
 * when every guard and Answers slide is exactly what the deck builder makes from the lesson's
 * questions in the old theme (`prev`, `prevTheme`; elements, words, formatting and reveal steps
 * compared, positions and ids ignored), nothing of the teacher's is on them, so they are built
 * again in the new theme where the first one stood, and the page count may grow or shrink. Any
 * difference (an edited word, a format, an added or removed element or slide) means the teacher
 * has worked on them: they are left exactly as they are. A deck with no Answers slides gets none.
 */
export function relayEndAnswers(
  prev: readonly Slide[],
  prevTheme: Theme,
  prevStage: Stage,
  slides: readonly Slide[],
  theme: Theme,
  stage: Stage,
): Slide[] | null {
  const old = prev.filter((s) => s.answersRole);
  const at = slides.findIndex((s) => s.answersRole);
  if (!old.length || at < 0) return null;
  const groups = answerGroupsOf(prev.filter((s) => !s.answersRole));
  const opts = { skipWithKey: false } as const;
  const expected = endAnswerSlides(groups, prevTheme, prevStage, opts);
  const same =
    expected.length === old.length &&
    expected.every((s, i) => contentOf(s) === contentOf(old[i] as Slide));
  if (!same && !untouchedAnswers(old, groups, prevTheme, prevStage)) return null;
  const made = endAnswerSlides(groups, theme, stage, opts).map((s, i) => {
    const was = old[i];
    return was && was.answersRole === s.answersRole ? { ...s, id: was.id } : s;
  });
  const lesson = slides.filter((s) => !s.answersRole);
  const before = slides.slice(0, at).filter((s) => !s.answersRole);
  return [...before, ...made, ...lesson.slice(before.length)];
}

/* ------------------------------------------------------------------ */
/* Input paths                                                         */
/* ------------------------------------------------------------------ */

import { SLIDE_H, SLIDE_W } from "@tj/domain/documents";
import { TRIM } from "./grid";
import { getAtPath, setAtPath } from "./layout-paths";

export { fitInto, getAtPath, minFitScale, minLayoutSize, setAtPath } from "./layout-paths";

/** The ref's item list (empty when the input has none). */
export function itemsOf(ref: LayoutRef): unknown[] {
  const v = ref.input[ADAPTIVE_SPECS[ref.template].items];
  return Array.isArray(v) ? v : [];
}

const withItems = (ref: LayoutRef, items: unknown[]): LayoutRef => ({
  ...ref,
  input: { ...ref.input, [ADAPTIVE_SPECS[ref.template].items]: items },
});

export type ItemChange = { ok: true; ref: LayoutRef } | { ok: false; reason: string };

/**
 * New words at `path`. A name committed on an item that still carries the template's placeholder
 * icon re-resolves the icon from the name (`iconFor`); no match keeps the placeholder.
 */
export function editItem(ref: LayoutRef, path: string, text: string): LayoutRef {
  const next = setAtPath(ref, path, text);
  const spec = ADAPTIVE_SPECS[ref.template];
  const m = new RegExp(`^${spec.items}\\.(\\d+)\\.(name|title|label)$`).exec(path);
  if (!m || !spec.placeholderIcon) return next;
  const iconPath = `${spec.items}.${m[1]}.icon`;
  if (getAtPath(ref, iconPath) !== spec.placeholderIcon) return next;
  const concept = spec.iconFor?.(text.trim());
  return concept ? setAtPath(next, iconPath, concept) : next;
}

/** Insert a blank item at `at` (clamped); refused at the template's max for the stage. */
export function addItem(ref: LayoutRef, at: number, stage: Stage): ItemChange {
  const spec = ADAPTIVE_SPECS[ref.template];
  const items = itemsOf(ref);
  const max = spec.max(stage);
  if (items.length >= max)
    return { ok: false, reason: `This layout holds at most ${max} ${spec.noun}.` };
  const i = Math.max(0, Math.min(items.length, Math.round(at)));
  return { ok: true, ref: withItems(ref, [...items.slice(0, i), spec.blank(), ...items.slice(i)]) };
}

/** Remove the item at `index`; refused at the template's min. */
export function removeItem(ref: LayoutRef, index: number): ItemChange {
  const spec = ADAPTIVE_SPECS[ref.template];
  const items = itemsOf(ref);
  if (index < 0 || index >= items.length) return { ok: false, reason: "That item is not here." };
  if (items.length <= spec.min)
    return { ok: false, reason: `This layout needs at least ${spec.min} ${spec.noun}.` };
  return {
    ok: true,
    ref: withItems(
      ref,
      items.filter((_, n) => n !== index),
    ),
  };
}

/**
 * Ruling 215's split: the layout's own continuation. Offered wherever words are over (Greg, 14 Oct
 * 2026: the chip showed no Split on a three-item row), so any layout with two or more items splits,
 * even when a half then holds fewer than the template's min: each half has the room the long words
 * need, and every template lays out a single item. Remove still stops at the min.
 */
export function canSplit(ref: LayoutRef): boolean {
  return ADAPTIVE_SPECS[ref.template].continuation && itemsOf(ref).length >= 2;
}

const CONTINUED = " (continued)";

/**
 * The leading items stay (the larger half), the trailing ones move; every word is kept. The moved
 * half's heading is the first's with " (continued)" after it (UX ruling 91's continuation).
 */
export function splitItems(ref: LayoutRef): { head: LayoutRef; tail: LayoutRef } {
  const items = itemsOf(ref);
  const keep = Math.ceil(items.length / 2);
  const { frame: _frame, ...bare } = ref;
  const heading = String(ref.input.heading ?? "").trim();
  const base = heading.endsWith(CONTINUED) ? heading.slice(0, -CONTINUED.length) : heading;
  const tail = withItems(bare, items.slice(keep));
  return {
    head: withItems(ref, items.slice(0, keep)),
    tail: heading ? { ...tail, input: { ...tail.input, heading: `${base}${CONTINUED}` } } : tail,
  };
}

/* ------------------------------------------------------------------ */
/* Fields (ruling 215)                                                 */
/* ------------------------------------------------------------------ */

/**
 * One field's state: `ok` within its published cap; `tight` past the cap but still laid out (the
 * layout shrank, the field shows "chars/cap"); `over` past the hard maximum (the layout could not
 * hold it: the field is marked and split or shorten is offered). Words are never clipped.
 */
export type LayoutField = {
  path: string;
  chars: number;
  cap: number;
  hardMax?: number;
  state: "ok" | "tight" | "over";
};

type CapacityCell = { cards: number; heading: boolean; chars: number; label: number };
const GRID_GROUP = (stage: Stage) => (stage === "ks1" ? "KS1" : stage === "ks2" ? "KS2" : "KS3-5");

/** cards-grid: caps from its published capacity table, `over` from the layout's own report. */
function cardsGridFields(ref: LayoutRef, result: TemplateResult, stage: Stage): LayoutField[] {
  const table = (CARDS_GRID_CAPACITY as Record<string, CapacityCell[]>)[GRID_GROUP(stage)] ?? [];
  const items = itemsOf(ref) as { label?: string; text?: string }[];
  const heading = String(ref.input.heading ?? "").trim() !== "";
  const cell = table.find(
    (c) => c.cards === Math.min(items.length, GRID_MAX) && c.heading === heading,
  );
  if (!cell) return [];
  const out: LayoutField[] = [];
  items.forEach((item, n) => {
    const overCard = result.over.some((o) => o.startsWith(`card ${n + 1} `));
    const field = (path: string, text: string, cap: number, over: boolean) => {
      const chars = text.trim().length;
      out.push({ path, chars, cap, state: over ? "over" : chars > cap ? "tight" : "ok" });
    };
    field(`grid.${n}.label`, item.label ?? "", cell.label, false);
    field(`grid.${n}.text`, item.text ?? "", cell.chars, overCard);
  });
  return out;
}

/** The ruling-215 state of every field the template publishes limits for (none: no fields). */
export function fieldStates(ref: LayoutRef, result: TemplateResult, stage: Stage): LayoutField[] {
  if (ref.template === "cards-grid") return cardsGridFields(ref, result, stage);
  const reported = result.fields;
  if (!reported?.length) return [];
  return reported.flatMap((f) => {
    const path = f.path;
    if (!path) return [];
    // A layout that is never comfortable at this count (items-row at 5-6) publishes a cap of 0:
    // its limit is the hard maximum. With neither, no limit is known: no counter, never "n/0".
    const cap = f.cap > 0 ? f.cap : (f.hardMax ?? 0);
    if (cap <= 0) return [];
    const value = getAtPath(ref, path);
    const chars = typeof value === "string" ? value.trim().length : 0;
    // The layout's own measure at the drawn size outranks the table: a field it reports over (an
    // items row whose real words wrap a line more than the table's sample did) is over, even under
    // its hard maximum (chat-edit router run r24: the Heart line ran 16 pt past the frame).
    const measuredOver = result.over.includes(f.field ?? path) || result.over.includes(path);
    const state: LayoutField["state"] =
      measuredOver || (f.hardMax > 0 && chars > f.hardMax) ? "over" : chars > cap ? "tight" : "ok";
    return [{ path, chars, cap, hardMax: f.hardMax, state }];
  });
}

/* ------------------------------------------------------------------ */
/* Relayout                                                            */
/* ------------------------------------------------------------------ */

/** Which input path each named text element shows, in draw order (cards-grid by its card boxes). */
function pathsOf(template: AdaptiveTemplateId, els: SlideElement[]) {
  const own = ADAPTIVE_SPECS[template].paths;
  if (own) return own(els);
  const out: (string | undefined)[] = [];
  let card = -1;
  for (const el of els) {
    if (el.name === "Heading") out.push("heading");
    else if (el.name === "Lead") out.push("lead");
    else if (template === "cards-grid" && el.name === GRID_NAMES.card) {
      card++;
      out.push(undefined);
    } else if (template === "cards-grid" && el.name === GRID_NAMES.label)
      out.push(`grid.${card}.label`);
    else if (template === "cards-grid" && el.name === GRID_NAMES.body)
      out.push(`grid.${card}.text`);
    else out.push(undefined);
  }
  return out;
}

export type Relaid = {
  /** The template's elements, in slide space. */
  elements: SlideElement[];
  /** Their bounds on the slide. */
  frame: LayoutFrame;
  result: TemplateResult;
  fields: LayoutField[];
  /** Element id → the input path it shows (text elements the teacher can edit through the ref). */
  paths: Record<string, string>;
};

export class NotAdaptiveError extends Error {}

/** Points of room the frame keeps round the laid boxes, inside the slide. */
export const FRAME_MARGIN = 8;

const boundsOf = (els: SlideElement[]): LayoutFrame => {
  if (!els.length) return { x: 0, y: 0, w: 0, h: 0 };
  const x = Math.min(...els.map((e) => e.x));
  const y = Math.min(...els.map((e) => e.y));
  const r = Math.max(...els.map((e) => e.x + e.w));
  const b = Math.max(...els.map((e) => e.y + e.h));
  // Never past the slide's edges or its trim at the foot: the group is clipped to its frame, so
  // words a layout cannot hold are hidden at the edge (and marked over), never drawn off the slide.
  // A margin round the boxes keeps the clip off glyphs that overhang their measured box (a last
  // word drawn a few points wider than measured) and the selection off the outer discs.
  const x0 = Math.max(0, x - FRAME_MARGIN);
  const y0 = Math.max(0, y - FRAME_MARGIN);
  const r0 = Math.min(SLIDE_W, r + FRAME_MARGIN);
  const b0 = Math.max(y0, Math.min(SLIDE_H - TRIM, b + FRAME_MARGIN));
  return { x: x0, y: y0, w: r0 - x0, h: b0 - y0 };
};

/**
 * Run the ref's template on its input. With `idPrefix`, elements get stable ids (`<prefix>:<path>`
 * for a text bound to an input path, `<prefix>:<n>` otherwise), so a selection survives a re-lay.
 * Throws `NotAdaptiveError` for a template `layoutTemplate` does not lay out yet.
 */
/**
 * Words a layout cannot hold run past the frame, which clips. Cut there, a line was sliced through
 * its middle ("and back again" half drawn, UX ruling 215: over-limit text is never shown clipped).
 * A text box that runs past the frame's foot is held to the whole lines that fit inside it, so the
 * clip falls between lines; the words stay in the box, and the panel says the end is hidden.
 */
function wholeLines(els: SlideElement[], frame: LayoutFrame, theme: Theme): SlideElement[] {
  const foot = frame.y + frame.h;
  return els.map((el) => {
    if (el.type !== "text" || el.y + el.h <= foot + 0.5) return el;
    const r = resolveTextStyle(el.style, theme, el.style?.preset ?? "body");
    const line = r.fontSize * r.lineHeight;
    const room = foot - el.y - 2 * r.padding;
    const lines = Math.max(0, Math.floor((room + 0.5) / line));
    return {
      ...el,
      h: lines * line + 2 * r.padding,
      style: { ...el.style, autoHeight: false, autoFit: false, valign: "top" },
    };
  });
}

export function relayout(ref: LayoutRef, theme: Theme, stage: Stage, idPrefix?: string): Relaid {
  const input = { ...ref.input, template: ref.template } as TemplateInput;
  if (typeof input.heading !== "string") input.heading = "";
  const result = layoutTemplate(input, theme, stage);
  if (!result.slide.kind) throw new NotAdaptiveError(`"${ref.template}" is not laid out yet`);
  const raw = result.slide.elements;
  const bound = pathsOf(ref.template, raw);
  const paths: Record<string, string> = {};
  // A box with no field path (a disc, a line) is named by its element name and how many before it
  // share that name, not by its place in the list: a draft that gains an item keeps every earlier
  // box's id, so the streamed slide's hand-over remounts nothing (TEACH-110 part s). The `~` keeps
  // it from reading as a field path (`boundPath`).
  const seen = new Map<string, number>();
  const elements = raw.map((el, n) => {
    const path = bound[n];
    const name = (el.name ?? el.type).replace(/[^\w-]/g, "_");
    const k = seen.get(name) ?? 0;
    if (!path) seen.set(name, k + 1);
    const id = idPrefix ? `${idPrefix}:${path ?? `~${name}-${k}`}` : el.id;
    if (path) paths[id] = path;
    return id === el.id ? el : { ...el, id };
  });
  const frame = boundsOf(elements);
  return {
    elements: wholeLines(elements, frame, theme),
    frame,
    result,
    fields: fieldStates(ref, result, stage),
    paths,
  };
}

/** The writer's wrapper: the template's elements in one group that keeps its ref (and frame). */
export function layoutGroup(
  ref: LayoutRef,
  theme: Theme,
  stage: Stage,
  id: string,
  name = "Layout",
): GroupElement & { layout: LayoutRef } {
  const { elements, frame } = relayout(ref, theme, stage, id);
  return {
    id,
    type: "group",
    name,
    ...frame,
    children: elements.map((e) => ({ ...e, x: e.x - frame.x, y: e.y - frame.y })),
    layout: { ...ref, frame },
  };
}
