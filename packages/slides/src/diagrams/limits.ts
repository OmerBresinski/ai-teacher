/**
 * Round 8: the one table of diagram text and count limits. The drawer's schema (`schema.ts`,
 * `meaning.ts`), the drawer's contract lines (`limitLines`) and the writer's kind lines
 * (`lab/bakeoff/diagram-kinds.ts` -> prompts/shared/diagram-kinds.json `limits` ->
 * make_visuals.py) all read it, so the writer and the drawer can never be told different numbers.
 * The writer's line for a slot takes the smaller of this cap and the slot's measured fit, so what a
 * writer is told always draws.
 */
import type { KeyStage } from "../themes";

/** Characters per word when a character cap is said as words (the writer prompts never see characters). */
export const CHARS_PER_WORD = 7;

export const LIMITS = {
  /** A label on a labelled diagram: one part named, inside or on its shape. */
  labels: { max: 6, words: 3, chars: 24 },
  /** A table: rows and columns of cells; a header names each column. */
  table: { rows: 8, cols: 5, cellWords: 4, cellChars: 28, headerChars: 20 },
  /** A flow: unique boxes (nodes) joined by links; a link's words name the change. */
  flow: { nodes: 6, links: 8, nodeWords: 4, nodeChars: 32, linkWords: 2, linkChars: 14 },
  /** A cycle: steps that loop back to the first. */
  cycle: { min: 3, max: 5, stepWords: 4, stepChars: 32 },
  /** A chain of steps (a flow that is a straight path): the most boxes a key stage reads. */
  steps: { ks1: 5, ks2: 6, ks3: 8, ks4: 8, ks5: 8 } satisfies Record<KeyStage, number>,
  /** Equal groups of counters. */
  groups: { totalMax: 40, groupsMin: 2, groupsMax: 10 },
  /** Fraction shapes: shapes cut into equal parts. */
  fractions: { shapes: 4, partsMax: 12, nameChars: 12 },
  /** Particle panels. */
  particles: { panels: 3, captionChars: 16, noteChars: 28, nameChars: 18 },
  /** A timeline's events. */
  timeline: { min: 2, max: 7, dateChars: 14, textChars: 40, periodChars: 24 },
  /** A bar model's bars and parts. */
  bars: { bars: 3, parts: 12, labelChars: 12, unitChars: 6 },
} as const;

/** `chars` as a word count, never under one. */
export const wordsFor = (chars: number) => Math.max(1, Math.round(chars / CHARS_PER_WORD));

/**
 * The drawer contract's limits block, built from `LIMITS`: one line per kind the writer can ask
 * for, in words and counts. Appended to the drawer's system text (`services.ts diagramSystem`).
 */
export function limitLines(): string {
  const L = LIMITS;
  return [
    "Limits (the drawer refuses a spec past them):",
    `- labelled-diagram: at most ${L.labels.max} labels, each 1 to ${L.labels.words} words.`,
    `- table: at most ${L.table.rows} rows and ${L.table.cols} columns; a cell is up to ${L.table.cellWords} words, a header up to ${wordsFor(L.table.headerChars)} words.`,
    `- flow: ${2} to ${L.flow.nodes} boxes, each once, of up to ${L.flow.nodeWords} words or one equation; up to ${L.flow.links} links, each named in up to ${L.flow.linkWords} words.`,
    `- cycle: ${L.cycle.min} to ${L.cycle.max} steps of up to ${L.cycle.stepWords} words.`,
    `- equal-groups: up to ${L.groups.totalMax} counters in ${L.groups.groupsMin} to ${L.groups.groupsMax} groups.`,
    `- fraction-shapes: up to ${L.fractions.shapes} shapes, each cut into up to ${L.fractions.partsMax} equal parts, named in a word or a letter.`,
    `- particles: up to ${L.particles.panels} panels; a caption up to ${wordsFor(L.particles.captionChars)} words, a note up to ${wordsFor(L.particles.noteChars)} words.`,
    `- timeline: ${L.timeline.min} to ${L.timeline.max} events; an event's text up to ${wordsFor(L.timeline.textChars)} words.`,
    `- bar-model: up to ${L.bars.bars} bars of up to ${L.bars.parts} parts.`,
  ].join("\n");
}
