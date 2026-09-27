import type { FigureRef, Finding, LessonFacts } from "@tj/domain/documents";
import { FIGURE_TEMPLATES } from "@tj/slides";

/*
 * The figure check (ADR 0034 decision 6, TEACH-253). Code, no model: for a worked example or a
 * question whose figure's template can work out its unknown (`FigureTemplate.unknown`, TEACH-221),
 * it compares that value with the number the fact's answer states, and flags a pair that
 * disagrees beyond the rounding the stated number shows. It flags; it never rewrites the answer or
 * the figure, and never fails a stage. Built on `numeric-check.ts`: a content-free message, the
 * two numbers as `evidence`, Verify recording warnings, Evaluate turning them into errors on the
 * slides that cite the fact.
 *
 * Structural only, and silent when unsure: an answer with no number, a number written as part of
 * an expression ("5√3", "12/5"), values that do not have the template's shape, or a unknown the
 * values cannot give (a right triangle with all three lengths) is not checked.
 */

/** One fact whose stated answer disagrees with its figure. */
export type FigureAnswerMismatch = {
  factId: string;
  /** The number the answer states. */
  stated: number;
  /** The value the figure's template works out for its unknown. */
  computed: number;
};

/** A number, and what around it makes it part of an expression rather than a stated result. */
const NUMBER = /(?<![\d.])\d+(?:\.\d+)?/g;
/** A thousands separator ("1,200") is read as unsure too, not as the number 1. */
const EXPRESSION_AFTER = /^(?:\s*[√π/÷×*^·+\-−⁰¹²³⁴⁵⁶⁷⁸⁹]|,\d{3})/;
const EXPRESSION_BEFORE = /[√/÷×*^·+\-−]\s*$/;

/**
 * The number an answer states (TEACH-253): the one after the last `=` when there is one, otherwise
 * the first number; with the decimal places written, which give its rounding. "x = 5 cm", "5 cm"
 * and "3² + 4² = 25, so c = 5" all give 5; "40°" gives 40. `undefined` when there is no such
 * number, or it is part of an expression rather than a result.
 */
export function statedNumber(answer: string): { value: number; decimals: number } | undefined {
  const equals = Math.max(answer.lastIndexOf("="), answer.lastIndexOf("≈"));
  const from = equals === -1 ? 0 : equals + 1;
  const text = answer.slice(from);
  NUMBER.lastIndex = 0;
  const match = NUMBER.exec(text);
  if (!match) return undefined;
  const before = text.slice(0, match.index);
  const after = text.slice(match.index + match[0].length);
  if (EXPRESSION_BEFORE.test(before) || EXPRESSION_AFTER.test(after)) return undefined;
  const decimals = match[0].includes(".") ? (match[0].split(".")[1]?.length ?? 0) : 0;
  return { value: Number(match[0]), decimals };
}

/** The value the figure's template works out for its unknown, or `undefined` when it cannot. */
export function figureUnknownValue(figure: FigureRef): number | undefined {
  const template = FIGURE_TEMPLATES[figure.template];
  if (!template.unknown) return undefined;
  const parsed = template.shape.safeParse(figure.values);
  if (!parsed.success) return undefined;
  return template.unknown(parsed.data)?.value;
}

/** Whether `computed` rounds to the stated number at the places it is written to. */
function agrees(stated: { value: number; decimals: number }, computed: number): boolean {
  const half = 0.5 * 10 ** -stated.decimals;
  // A hair over the half-unit so that a value on the boundary (12.5 stated as 13) still agrees.
  return Math.abs(computed - stated.value) <= half + 1e-9;
}

/** Every worked example and question whose answer disagrees with its figure's unknown. */
export function figureAnswerMismatches(facts: LessonFacts): FigureAnswerMismatch[] {
  const out: FigureAnswerMismatch[] = [];
  for (const fact of [...facts.workedExamples, ...facts.questions]) {
    if (!fact.figure) continue;
    const computed = figureUnknownValue(fact.figure);
    if (computed === undefined) continue;
    const stated = statedNumber(fact.answer);
    if (!stated || agrees(stated, computed)) continue;
    out.push({ factId: fact.id, stated: stated.value, computed });
  }
  return out;
}

/** The lab check's name for a mismatch, for logs. */
export const FIGURE_CHECK = "figure-answer";

/** The message every figure finding carries; Evaluate recognises Verify's warnings by it. */
export const FIGURE_MESSAGE =
  "The answer in this fact does not match the value its figure gives for the unknown.";

/** The two numbers, as the finding's `evidence` (never logged, ADR 0015). */
export function figureEvidence(m: FigureAnswerMismatch): string {
  return `The answer states ${m.stated}; the figure gives ${Number(m.computed.toFixed(2))}.`;
}

/**
 * One warning per mismatch, on the fact, recorded by Verify under its own check name
 * (`fact-verify`) so Evaluate carries it to the list Repair reads, as `numericFindings` does.
 */
export function figureFindings(facts: LessonFacts): Finding[] {
  return figureAnswerMismatches(facts).map((m) => ({
    check: "fact-verify",
    severity: "warning",
    target: { factId: m.factId },
    message: FIGURE_MESSAGE,
    evidence: figureEvidence(m),
  }));
}
