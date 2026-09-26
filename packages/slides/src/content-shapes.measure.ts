import type { Slide, SlideElement, TextElement, Theme } from "@tj/domain/documents";
import { CONTENT_BUDGETS, type ContentShape, type ShapeComposition } from "./content-shapes";
import { docFromBullets, docFromText } from "./factories";
import { fitSlide } from "./fit-slide";
import { SAFE, SPACE } from "./grid";
import { layoutSlide } from "./layouts";
import { applyLook, HEADING_DISPLAY } from "./look";
import { materialiseSlide } from "./materialise";
import { HEADING_NAME } from "./reflow";
import type { SlideSpecOf } from "./specs";
import { COMPARE_NAME, ITEM_NAME, LEAD_NAME, PANEL_NAME, STEP_NAME } from "./structure";
import { measureHeadless } from "./text-measure";
import { readingLeading, readingSize, resolveFontSize } from "./text-style";

/*
 * The probe behind `CONTENT_BUDGETS` (`content-shapes.ts`) and its test: a content spec of one
 * shape with a given number of words in each slot, rendered through the real pipeline, and the
 * largest counts that still come out as one slide at the body size in the composition measured.
 * Test support only; not exported from the package.
 */

/** Teaching prose (5.2 letters a word, a little over plain English): the filler every slot is cut from. */
const PROSE =
  "Plants take in carbon dioxide through small pores in their leaves and water from the soil through their roots while light energy absorbed by chlorophyll drives the reaction that makes glucose and releases oxygen into the surrounding air";
const WORDS = PROSE.split(" ");
const words = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => WORDS[(from + i) % WORDS.length]).join(" ");
const sentence = (n: number, from = 0) => {
  const w = words(n, from);
  return `${w.charAt(0).toUpperCase()}${w.slice(1)}.`;
};
const item = (n: number, from = 0) => {
  const w = words(n, from);
  return `${w.charAt(0).toUpperCase()}${w.slice(1)}`;
};

/** The key term the panel composition sets beside the words (the lesson's glossary). */
const TERM = "catalyst";
const GLOSSARY = [{ term: TERM, definition: "A substance that speeds up a reaction." }];

const meta = { promptVersion: "t", model: "m", at: "2026-09-26T00:00:00.000Z" };

export type Counts = { heading: number; lead: number; slot: number; side?: number };

/** The lead: one sentence naming the key term, so a panel composition has a term to set beside it. */
const leadText = (c: Counts) => `${item(Math.max(1, c.lead - 1), 0)} ${TERM}.`;

/** A spec of `shape` with `counts` words in each slot, every list at its most members. */
function specFor(shape: ContentShape, c: Counts): SlideSpecOf<"content"> {
  const heading = item(c.heading, 3);
  const lead = leadText(c);
  const base = { kind: "content" as const, factRefs: [], heading };
  const b = CONTENT_BUDGETS[shape];
  switch (shape) {
    case "explain":
      return { ...base, body: `${lead} ${sentence(c.slot, 7)}` };
    case "list": {
      const n = b.points?.count?.[1] ?? 4;
      return {
        ...base,
        body: lead,
        points: Array.from({ length: n }, (_, i) => item(c.slot, i * 5)),
      };
    }
    case "compare": {
      const n = b.sidePoints?.count?.[1] ?? 3;
      const side = (from: number) => ({
        label: item(c.side ?? 1, from),
        points: Array.from({ length: n }, (_, i) => item(c.slot, from + i * 4)),
      });
      return { ...base, body: lead, compare: { left: side(0), right: side(11) } };
    }
    case "sequence": {
      const n = b.steps?.count?.[1] ?? 4;
      return {
        ...base,
        body: lead,
        steps: Array.from({ length: n }, (_, i) => item(c.slot, i * 6)),
      };
    }
  }
}

const isText = (e: SlideElement): e is TextElement => e.type === "text";

/** A content slide laid out without a panel: the look's lead and card at the full measure. */
function fullMeasure(spec: SlideSpecOf<"content">, t: Theme): Slide {
  const laid = layoutSlide("content", t.id, "headed");
  const elements = laid.elements.map((e) => {
    if (!isText(e)) return e;
    if (e.style.preset === "heading") return { ...e, doc: docFromText(spec.heading) };
    if (e.style.preset !== "body") return e;
    const doc = spec.points
      ? {
          type: "doc" as const,
          content: [
            ...(docFromText(spec.body).content ?? []),
            ...(docFromBullets(spec.points).content ?? []),
          ],
        }
      : docFromText(spec.body);
    return { ...e, doc };
  });
  return fitSlide(applyLook({ id: "s", kind: "content", elements }, t), t).slide;
}

/** Render one shape in one composition; `undefined` when it would not be one slide at body size. */
export function render(
  shape: ContentShape,
  composition: ShapeComposition,
  c: Counts,
  t: Theme,
): Slide | undefined {
  const got = check(shape, composition, c, t);
  return typeof got === "string" ? undefined : got;
}

/** The rendered slide, or why it is not one slide at the body size in its composition. */
export function check(
  shape: ContentShape,
  composition: ShapeComposition,
  c: Counts,
  t: Theme,
  leadLines = 2,
): Slide | string {
  const spec = specFor(shape, c);
  const slide =
    shape === "explain" && composition === "full"
      ? fullMeasure(spec, t)
      : materialiseSlide(spec, t.id, meta, undefined, 0, {
          terms: [TERM],
          ...(composition === "panel" ? { glossary: GLOSSARY } : {}),
        });
  if (fitSlide(slide, t).overflow.length > 0) return "overflow";
  const els = slide.elements;
  const has = (name: string) => els.some((e) => e.name === name);
  // The composition it was measured for.
  if ((composition === "panel") !== has(PANEL_NAME)) return "composition";
  if (shape === "compare" && !has(COMPARE_NAME)) return "no compare cards";
  if (shape === "sequence" && !has(STEP_NAME)) return "no steps";
  if (shape === "list" && !has(ITEM_NAME)) return "no dot points";
  // One line of display heading.
  const heading = els.find((e) => e.name === HEADING_NAME) as TextElement | undefined;
  if (heading?.style.fontSize !== Math.round(t.sizes.heading * HEADING_DISPLAY))
    return "heading not one display line";
  // No step down: every running text at its preset's own size or larger.
  const body = readingSize(t);
  const small = resolveFontSize(t, "small");
  for (const e of els.filter(isText)) {
    if (e.name === PANEL_NAME || e.name?.startsWith("Side panel")) continue;
    const size = e.style.fontSize;
    if (size === undefined) continue;
    if (e.style.preset === "body" && size < body)
      return `body stepped down: ${e.name ?? "unnamed"} ${size}`;
    if (e.style.preset === "small" && size < small) return "small stepped down";
  }
  // The lead is one sentence of at most two lines.
  if (leadLinesOf(els, shape, composition, leadText(c), t) > leadLines + 0.05) {
    return "lead too many lines";
  }
  // A compare side's label on one line of its card.
  if (shape === "compare") {
    const cap = resolveFontSize(t, "caption") * t.lineHeights.caption;
    const labels = els.filter(
      (e): e is TextElement => isText(e) && e.style.preset === "caption" && e.name === undefined,
    );
    for (const l of labels) {
      if (l.h > cap * 1.05) return "label over one line";
    }
  }
  return slide;
}

/** How many lines the lead takes: its own element, or (one paragraph beside a key term) its words at the column's width. */
function leadLinesOf(
  els: SlideElement[],
  shape: ContentShape,
  composition: ShapeComposition,
  lead: string,
  t: Theme,
): number {
  const body = readingSize(t);
  const lh = body * readingLeading(t);
  const texts = els.filter(isText);
  const el =
    shape === "list"
      ? texts.find((e) => e.name === LEAD_NAME)
      : shape === "compare" || shape === "sequence"
        ? texts.find((e) => e.name === "Body")
        : composition === "full"
          ? texts.find((e) => e.style.preset === "body" && e.style.fontWeight === 600 && !e.name)
          : undefined;
  if (el) return el.h / ((el.style.fontSize ?? body) * (el.style.lineHeight ?? t.lineHeights.body));
  const width = Math.floor((SAFE.w - SPACE[5]) / 2);
  const h = measureHeadless(t)({
    doc: docFromText(lead),
    width,
    style: { preset: "body", fontSize: body, lineHeight: readingLeading(t) },
    preset: "body",
    inset: 0,
    chrome: 0,
  });
  return h / lh;
}

/** The largest `n` for which `ok(n)` holds, `ok` monotone; 0 when none. */
function largest(ok: (n: number) => boolean, hi = 64): number {
  let lo = 0;
  let top = hi;
  while (lo < top) {
    const mid = Math.ceil((lo + top) / 2);
    if (ok(mid)) lo = mid;
    else top = mid - 1;
  }
  return lo;
}

/**
 * The lines a lead may take: two across the full measure, three in a half column beside the
 * panel (the examples' "Limiting factors": fourteen words over three lines beside its graph).
 */
export const leadLinesFor = (composition: ShapeComposition) => (composition === "panel" ? 3 : 2);

/**
 * What a slot should hold at most, whatever the slide has room for: a lead of one or two
 * sentences, points and steps short enough to read at a glance (the look brief, 26 Sept 2026).
 */
export const TARGETS = { lead: [12, 18], list: 6, compare: 6, sequence: 8 } as const;

/**
 * What each slot holds on `t`, lead first. The heading (one display line) and a compare side's
 * label (one line of its card); then the lead, up to `leadLinesFor` lines and `TARGETS.lead[1]`
 * words; then the shape's own slot, every list at its most members, in what the lead leaves, up
 * to its target. Where the slot falls short of its target, the lead gives words back, down to
 * `TARGETS.lead[0]`, while that buys the slot more.
 */
export function measure(shape: ContentShape, composition: ShapeComposition, t: Theme): Counts {
  const lines = leadLinesFor(composition);
  const fits = (c: Counts) => typeof check(shape, composition, c, t, lines) !== "string";
  const heading = largest((n) => fits({ heading: n, lead: 3, slot: 2, side: 1 }), 16);
  const side =
    shape === "compare"
      ? largest((n) => fits({ heading, lead: 3, slot: 2, side: n }), 12)
      : undefined;
  const target = shape === "explain" ? Number.POSITIVE_INFINITY : TARGETS[shape];
  const room = largest((n) => fits({ heading, lead: n, slot: 2, side: 1 }), 48);
  const slotUnder = (lead: number) =>
    Math.min(
      target,
      largest((n) => fits({ heading, lead, slot: n, side: side ?? 1 })),
    );
  let lead = Math.min(room, TARGETS.lead[1]);
  let slot = slotUnder(lead);
  const trade = Number.isFinite(target) ? Math.min(lead, TARGETS.lead[0]) : lead;
  for (let l = lead - 1; slot < target && l >= trade; l--) {
    const more = slotUnder(l);
    if (more > slot) {
      lead = l;
      slot = more;
    }
  }
  return { heading, lead, slot, ...(side === undefined ? {} : { side }) };
}
