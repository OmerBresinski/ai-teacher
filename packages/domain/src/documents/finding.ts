import { z } from "zod";

/*
 * Finding (ADR 0025 §10–§12). One result of Evaluate: a schema check from `checkLesson` or a
 * model check from the Evaluate stage. `error` findings drive Repair; what remains after it, plus
 * `warning`s, are the residuals the editor shows as the lint badge. Messages are teacher-readable.
 */

export type FindingSeverity = "error" | "warning";

export type FindingTarget = {
  slideId?: string;
  elementId?: string;
  blockId?: string;
  factId?: string;
};

/** What Repair should do about a finding, when the check knows. */
export type RepairHint = {
  kind: "regenerate-slide" | "regenerate-block" | "set-answer" | "add-objective-coverage";
};

export type Finding = {
  /** The check name, e.g. `question-answer`; model checks use their own names. */
  check: string;
  severity: FindingSeverity;
  target: FindingTarget;
  message: string;
  fix?: RepairHint;
};

export const FindingSeveritySchema = z.enum(["error", "warning"]);

export const FindingTargetSchema = z.strictObject({
  slideId: z.string().optional(),
  elementId: z.string().optional(),
  blockId: z.string().optional(),
  factId: z.string().optional(),
});

export const RepairHintSchema = z.strictObject({
  kind: z.enum(["regenerate-slide", "regenerate-block", "set-answer", "add-objective-coverage"]),
});

export const FindingSchema = z.strictObject({
  check: z.string(),
  severity: FindingSeveritySchema,
  target: FindingTargetSchema,
  message: z.string(),
  fix: RepairHintSchema.optional(),
});
