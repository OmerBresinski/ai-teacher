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
  SlideElement,
  Theme,
} from "@tj/domain/documents";
import { layoutTemplate, type Stage, type TemplateInput, type TemplateResult } from "./templates";
import { GRID_MAX, GRID_NAMES } from "./templates/cards-grid";
import CARDS_GRID_CAPACITY from "./templates/cards-grid-capacity.json" with { type: "json" };

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
};

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
    min: 2,
    max: (stage) => (stage === "ks1" ? 4 : 6),
    blank: () => ({ title: "New item", text: "Add a sentence here." }),
    continuation: true,
    noun: "items",
  },
  "panel-list": {
    items: "rows",
    min: 2,
    max: () => 6,
    blank: () => ({ title: "New row", text: "Add a sentence here." }),
    continuation: true,
    noun: "rows",
  },
  "split-compare": {
    items: "sides",
    min: 2,
    max: () => 3,
    blank: () => ({ label: "New side", text: "Add a sentence here." }),
    continuation: false,
    noun: "sides",
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

/* ------------------------------------------------------------------ */
/* Input paths                                                         */
/* ------------------------------------------------------------------ */

import { getAtPath } from "@tj/domain/documents";

export { getAtPath, setAtPath } from "@tj/domain/documents";

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
 * Ruling 215's split: the layout's own continuation. Both halves keep at least the template's min,
 * so a layout with fewer than twice its min items cannot split (Shorten is the only action).
 */
export function canSplit(ref: LayoutRef): boolean {
  const spec = ADAPTIVE_SPECS[ref.template];
  return spec.continuation && itemsOf(ref).length >= spec.min * 2;
}

/** The leading items stay (the larger half), the trailing ones move; every word is kept. */
export function splitItems(ref: LayoutRef): { head: LayoutRef; tail: LayoutRef } {
  const items = itemsOf(ref);
  const keep = Math.ceil(items.length / 2);
  const { frame: _frame, ...bare } = ref;
  return {
    head: withItems(ref, items.slice(0, keep)),
    tail: withItems(bare, items.slice(keep)),
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

type ReportedField = { path?: string; key?: string; cap?: number; hardMax?: number };

/** The ruling-215 state of every field the template publishes limits for (none: no fields). */
export function fieldStates(ref: LayoutRef, result: TemplateResult, stage: Stage): LayoutField[] {
  if (ref.template === "cards-grid") return cardsGridFields(ref, result, stage);
  const reported = (result as TemplateResult & { fields?: ReportedField[] }).fields;
  if (!Array.isArray(reported)) return [];
  return reported.flatMap((f) => {
    const path = f.path ?? f.key;
    if (!path || typeof f.cap !== "number") return [];
    const value = getAtPath(ref, path);
    const chars = typeof value === "string" ? value.trim().length : 0;
    const state: LayoutField["state"] =
      f.hardMax !== undefined && chars > f.hardMax ? "over" : chars > f.cap ? "tight" : "ok";
    return [{ path, chars, cap: f.cap, hardMax: f.hardMax, state }];
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

const boundsOf = (els: SlideElement[]): LayoutFrame => {
  if (!els.length) return { x: 0, y: 0, w: 0, h: 0 };
  const x = Math.min(...els.map((e) => e.x));
  const y = Math.min(...els.map((e) => e.y));
  const r = Math.max(...els.map((e) => e.x + e.w));
  const b = Math.max(...els.map((e) => e.y + e.h));
  return { x, y, w: r - x, h: b - y };
};

/**
 * Run the ref's template on its input. With `idPrefix`, elements get stable ids (`<prefix>:<path>`
 * for a text bound to an input path, `<prefix>:<n>` otherwise), so a selection survives a re-lay.
 * Throws `NotAdaptiveError` for a template `layoutTemplate` does not lay out yet.
 */
export function relayout(ref: LayoutRef, theme: Theme, stage: Stage, idPrefix?: string): Relaid {
  const input = { ...ref.input, template: ref.template } as TemplateInput;
  if (typeof input.heading !== "string") input.heading = "";
  const result = layoutTemplate(input, theme, stage);
  if (!result.slide.kind) throw new NotAdaptiveError(`"${ref.template}" is not laid out yet`);
  const raw = result.slide.elements;
  const bound = pathsOf(ref.template, raw);
  const paths: Record<string, string> = {};
  const elements = raw.map((el, n) => {
    const path = bound[n];
    const id = idPrefix ? `${idPrefix}:${path ?? n}` : el.id;
    if (path) paths[id] = path;
    return id === el.id ? el : { ...el, id };
  });
  return {
    elements,
    frame: boundsOf(elements),
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
