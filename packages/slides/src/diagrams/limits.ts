/**
 * Round 8: the one table of diagram text and count limits the drawer's schema (`schema.ts`,
 * `meaning.ts`) accepts. These caps are slot-free: they bound a spec, and they do NOT promise it
 * draws. Round 9 (regression audit cause 3): a flow of 6 boxes of 32 characters parses but does not
 * fit beside text (348 x 284), so what a writer and the drawer are told comes from `SLOT_LIMITS`
 * below: per key-stage group, per slot (the diagram box a layout gives) and per kind, measured by
 * laying the slide out with the renderer (`lab/bakeoff/slot-limits.ts` -> slot-limits.gen.ts).
 */
import { z } from "zod";
import { FONT_STACKS } from "../fonts";
import type { KeyStage } from "../themes";
import { SLOT_TABLE } from "./slot-limits.gen";
import { TYPE_FLOOR } from "./style";
import { type Ctx, textWidth, wrap } from "./svg";

/** Characters per word when a character cap is said as words (the writer prompts never see characters). */
export const CHARS_PER_WORD = 7;

/**
 * A label measured, not counted (round 8: "Maintenance rehearsal", "Below activation energy" are
 * subject terms a character cap refused). It stands when the renderer's own wrap (`svg.ts wrap`)
 * sets it on at most `lines` lines no wider than `width` points, at the type floor, in every
 * theme's body face. `width` is the room the renderer gives it in the narrowest zone it draws in.
 */
export type Measured = { width: number; lines: number; weight: number };

/** The half zone's width (DIAGRAM_ZONES.half), which particle panels share. */
const HALF_W = 422;
/** The gap between particle panels with no arrows between them (`templates.ts drawParticles`). */
const PANEL_GAP = Math.max(HALF_W * 0.05, 14);
/** One particle panel's width when `k` panels share the half zone. */
export const panelWidth = (k: number) =>
  Math.floor((HALF_W - (k - 1) * PANEL_GAP) / Math.max(1, k));
/** A particle panel's heading: two lines of its panel (`templates.ts`: fitLines(cap, colW, 2, fs, 700)). */
export const captionRule = (k: number): Measured => ({
  width: panelWidth(k),
  lines: 2,
  weight: 700,
});
/** Words on a flow's arrow: two lines (`flow.ts`: wrap(label, room, 2)). */
const LINK: Measured = { width: 140, lines: 2, weight: 400 };

const STACKS = [...new Set(Object.values(FONT_STACKS))];
/** Whether `text` sets within `m` in every body face, measured as the renderer measures it. */
export function fitsMeasured(text: string, m: Measured): boolean {
  const t = text.trim();
  if (!t) return false;
  return STACKS.every((stack) => {
    const x = { stack, fs: TYPE_FLOOR } as unknown as Ctx;
    const lines = wrap(t, x, m.width, m.lines, TYPE_FLOOR, m.weight);
    return (
      !lines.at(-1)?.endsWith("…") &&
      lines.every((l) => textWidth(l, x, TYPE_FLOOR, m.weight) <= m.width + 0.5)
    );
  });
}
/** A measured rule said as characters, for text the prompts read (an average glyph is 0.62 em). */
const charsOf = (m: Measured) => Math.floor((m.lines * m.width) / (0.62 * TYPE_FLOOR));

export const LIMITS = {
  /** A label on a labelled diagram: one part named, inside or on its shape. */
  labels: { max: 6, words: 3, chars: 24 },
  /** A table: rows and columns of cells; a header names each column. */
  table: { rows: 8, cols: 5, cellWords: 4, cellChars: 28, headerChars: 20 },
  /** A flow: unique boxes (nodes) joined by links; a link's words name the change. */
  flow: {
    nodes: 6,
    links: 8,
    nodeWords: 4,
    nodeChars: 32,
    linkWords: 2,
    /** Measured (`link`); `linkChars` is that rule said as characters. */
    link: LINK,
    linkChars: charsOf(LINK),
  },
  /** A cycle: steps that loop back to the first. */
  cycle: { min: 3, max: 5, stepWords: 4, stepChars: 32 },
  /** A chain of steps (a flow that is a straight path): the most boxes a key stage reads. */
  steps: { ks1: 5, ks2: 6, ks3: 8, ks4: 8, ks5: 8 } satisfies Record<KeyStage, number>,
  /** Equal groups of counters. */
  groups: { totalMax: 40, groupsMin: 2, groupsMax: 10 },
  /** Fraction shapes: shapes cut into equal parts. */
  fractions: { shapes: 4, partsMax: 12, nameChars: 12 },
  /** Particle panels. */
  particles: {
    panels: 3,
    /** Measured at the narrowest case, three panels (`captionRule(k)` for k panels). */
    caption: captionRule(3),
    captionChars: charsOf(captionRule(3)),
    noteChars: 28,
    nameChars: 18,
    /** The two colours' key under diffusion and dissolving panels. */
    keyChars: 18,
  },
  /** A timeline's events. */
  timeline: { min: 2, max: 7, dateChars: 14, textChars: 40, periodChars: 24 },
  /** A bar model's bars and parts. */
  bars: { bars: 3, parts: 12, labelChars: 12, unitChars: 6 },
} as const;

/**
 * A label held to a measured rule: trimmed, not empty, and set by the renderer within `m`. The
 * description states it as characters for the model; the parse measures it.
 */
export function measuredLabel(m: Measured) {
  return z
    .string()
    .trim()
    .min(1)
    .refine((t) => fitsMeasured(t, m), {
      message: `too wide: it must wrap onto ${m.lines} lines of ${m.width} points (about ${charsOf(m)} characters)`,
    })
    .describe(`up to ${m.lines} short lines, about ${charsOf(m)} characters in all`);
}

/** `chars` as a word count, never under one. */
export const wordsFor = (chars: number) => Math.max(1, Math.round(chars / CHARS_PER_WORD));

/**
 * The limits as the prompts state them: one phrase per rule, read by the drawer's limits block
 * (`limitLines`) and the writer's menu (`@tj/generation` `writer/contract.ts`), so the two can never
 * disagree (a label was "1 to 3 words" to the drawer and "24 characters" to the writer).
 */
export const LIMIT_TEXT = {
  /** One label on a labelled diagram. */
  label: `1 to ${LIMITS.labels.words} words, at most ${LIMITS.labels.chars} characters`,
  /** A particles panel set's words. */
  particles: `a caption up to ${LIMITS.particles.captionChars} characters, at most ${LIMITS.particles.panels} notes of up to ${LIMITS.particles.noteChars} characters, a key up to ${LIMITS.particles.keyChars} characters`,
} as const;

/**
 * The drawer contract's limits block, built from `LIMITS`: one line per kind the writer can ask
 * for, in words and counts. Appended to the drawer's system text (`services.ts diagramSystem`).
 */
export function limitLines(): string {
  const L = LIMITS;
  return [
    "Limits (the drawer refuses a spec past them):",
    `- labelled-diagram: at most ${L.labels.max} labels, each ${LIMIT_TEXT.label}.`,
    `- table: at most ${L.table.rows} rows and ${L.table.cols} columns; a cell is up to ${L.table.cellWords} words, a header up to ${wordsFor(L.table.headerChars)} words.`,
    `- flow: ${2} to ${L.flow.nodes} boxes, each once, of up to ${L.flow.nodeWords} words or one equation; up to ${L.flow.links} links, each named in up to ${L.flow.linkWords} words.`,
    `- cycle: ${L.cycle.min} to ${L.cycle.max} steps of up to ${L.cycle.stepWords} words.`,
    `- equal-groups: up to ${L.groups.totalMax} counters in ${L.groups.groupsMin} to ${L.groups.groupsMax} groups.`,
    `- fraction-shapes: up to ${L.fractions.shapes} shapes, each cut into up to ${L.fractions.partsMax} equal parts, named in a word or a letter.`,
    `- particles: up to ${L.particles.panels} panels; ${LIMIT_TEXT.particles}.`,
    `- timeline: ${L.timeline.min} to ${L.timeline.max} events; an event's text up to ${wordsFor(L.timeline.textChars)} words.`,
    `- bar-model: up to ${L.bars.bars} bars of up to ${L.bars.parts} parts.`,
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* Round 9: limits per slot, measured from what draws there            */
/* ------------------------------------------------------------------ */

/** The writer's key-stage groups (one prompt per group). */
export type StageGroup = "KS1" | "KS2" | "KS3-5";
/** A diagram slot: beside text (`side`) or across the slide (`full`). No layout gives a half slot. */
export type DiagramSlot = "side" | "full";
export type SlotLimit = { items: number; chars?: number; noun: string };
/** Generated by lab/bakeoff/slot-limits.ts; a test holds it to the renderer. */
export const SLOT_LIMITS = SLOT_TABLE as unknown as {
  slots: Record<StageGroup, Record<DiagramSlot, { w: number; h: number; layouts: string[] }>>;
  limits: Record<StageGroup, Record<DiagramSlot, Record<string, SlotLimit>>>;
};

export const stageGroup = (stage: string): StageGroup =>
  /ks1/i.test(stage) ? "KS1" : /ks2/i.test(stage) ? "KS2" : "KS3-5";

/** The slot a writer layout gives its diagram: across the slide for a big visual, else beside text. */
export const slotOf = (template: string): DiagramSlot =>
  ["big-visual", "big-diagram", "big-picture"].includes(template) ? "full" : "side";

/** The box of `slot` at `stage` (slide points, the layout's own Diagram element). */
export const slotBox = (stage: string, slot: DiagramSlot) => {
  const b = SLOT_LIMITS.slots[stageGroup(stage)][slot];
  return { w: b.w, h: b.h };
};

/** A kind's measured limit in `slot` at `stage`; undefined for a kind the table does not size. */
export const slotLimit = (kind: string, stage: string, slot: DiagramSlot): SlotLimit | undefined =>
  SLOT_LIMITS.limits[stageGroup(stage)][slot][kind];

/**
 * The drawer's limits line for one request: the asked kind in its own slot, in counts and
 * characters ("Limits for this slot: up to 3 boxes, each label up to 22 characters."). Empty for a
 * kind the table does not size.
 */
export function slotLimitLine(kind: string, stage: string, slot: DiagramSlot): string {
  const l = slotLimit(kind, stage, slot);
  if (!l) return "";
  if (!l.items) return `Limits for this slot: a ${kind} does not fit here.`;
  const chars = l.chars ? `, each label up to ${l.chars} characters` : "";
  return `Limits for this slot: up to ${l.items} ${l.noun}${chars}. The diagram holds the parts the request names.`;
}
