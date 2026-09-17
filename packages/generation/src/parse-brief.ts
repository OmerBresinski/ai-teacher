import { type CreatedAi, createBudget } from "@tj/ai";
import {
  BRIEF_DURATION_MAX,
  BRIEF_DURATION_MIN,
  BRIEF_LEVELS,
  type BriefLevel,
  findNamePatterns,
  SUBJECTS,
  YEAR_GROUPS,
  yearNumberOf,
} from "@tj/domain/documents";
import type { Logger } from "pino";
import { z } from "zod";
import { callStructured, MAX_OUTPUT_TOKENS } from "./call";
import { type ParseBriefFields, parseBriefPrompt } from "./prompts";
import type { PipelineContext } from "./types";

/*
 * Parse brief (ADR 0029 item 13; TEACH-16): the text a teacher typed into the website box becomes
 * brief fields for `POST /briefs/parse`. Rules first (`yearNumberOf`, the subject list, a minutes
 * pattern), then one `small` call for what is still blank, under a 2 s deadline that includes the
 * call's single retry. A rule hit is never overwritten by the model. Every string the model
 * returns goes through the output guard — the Identifier guard plus "is one of the offered
 * options", which a name can never be — and a miss drops the field. Any model failure (timeout,
 * moderation, an unconfigured client, a schema miss after the retry) returns the rules' result.
 * Pure apart from the injected `ai`; nothing is persisted and nothing here logs the text
 * (ADR 0015): counts, booleans and error classes only.
 */

export const PARSE_BRIEF_DEADLINE_MS = 2000;
/** One `small` call at low effort; a cap this size can never be the reason it fails. */
const PARSE_BRIEF_BUDGET = { capUsd: 0.05, capTokens: 20_000 };

export const RULE_FIELDS = ["yearGroup", "subject", "durationMin"] as const;
export type RuleField = (typeof RULE_FIELDS)[number];
/** What the model may fill: the rule fields plus `level`, which no rule reads. */
export const MODEL_FIELDS = ["yearGroup", "subject", "level", "durationMin"] as const;
export type ModelField = (typeof MODEL_FIELDS)[number];

export interface ParseBriefRules {
  /** The text with the matched fragments removed; the original text when nothing is left. */
  topic: string;
  yearGroup?: string | undefined;
  subject?: string | undefined;
  durationMin?: number | undefined;
  /** Which fields the rules filled, in `RULE_FIELDS` order. */
  hits: RuleField[];
}

export interface ParseBriefRequest {
  text: string;
  /** The year groups the form offers; defaults to England's labels. */
  yearGroups?: string[] | undefined;
}

export interface ParseBriefDeps {
  /** Absent or unconfigured → rules only, no call. */
  ai: CreatedAi | undefined;
  logger: Logger;
  /** The request's own signal, so a client that went away stops the call; optional. */
  signal?: AbortSignal | undefined;
  /** Identifiers for the model-call log line (ADR 0025 §16); the request id, never content. */
  context?: PipelineContext | undefined;
}

export interface ParseBriefResult {
  topic: string;
  yearGroup?: string | undefined;
  subject?: string | undefined;
  level?: BriefLevel | undefined;
  durationMin?: number | undefined;
  /** The fields the model filled and that survived the output guard. */
  inferred: ModelField[];
  /** How many rule hits. Log this; never the values. */
  rules: number;
  /** Model strings the output guard removed. */
  dropped: number;
  /** Whether a model answer was taken (false when skipped or when the call failed). */
  usedModel: boolean;
}

/**
 * What the model may answer. Not strict and null-tolerant on purpose: the prompt forbids extra
 * keys and nulls, but a stray `topic` or a `null` for an unknown field is dropped here rather than
 * paid for as a retry — the deadline leaves no room for a second attempt. `yearGroup` and
 * `subject` are checked against the offered lists after the call (the output guard), not here,
 * for the same reason.
 */
export const ParseBriefOutputSchema = z.object({
  yearGroup: z.string().max(40).nullish(),
  subject: z.string().max(60).nullish(),
  level: z.enum(BRIEF_LEVELS).nullish(),
  durationMin: z.number().int().min(BRIEF_DURATION_MIN).max(BRIEF_DURATION_MAX).nullish(),
});
export type ParseBriefOutput = z.infer<typeof ParseBriefOutputSchema>;

const YEAR_PATTERN = /\b(?:year|yr|y)\s*(\d{1,2})\b/i;
const RECEPTION_PATTERN = /\b(?:reception|eyfs|early years|nursery)\b/i;
/** "50 min", "50 mins", "50 minutes", "50 minute" — the singular is how "a 50 minute lesson" reads. */
const MINUTES_PATTERN = /\b(\d{1,3})\s*(?:min(?:ute)?s?)\b/i;
const SUBJECT_PATTERNS = SUBJECTS.map((subject) => ({
  subject,
  pattern: new RegExp(
    `\\b${subject
      .split(/\s+/)
      .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s+")}\\b`,
    "i",
  ),
}));
/** Separators a removed fragment leaves at either end of the topic ("history: causes" → "causes"). */
const EDGE_SEPARATORS = /^[\s,:;.\-–—|/]+|[\s,:;.\-–—|/]+$/g;

type Fragment = { index: number; length: number };

/** The offered option that equals `value` (case-insensitive, trimmed), or `undefined`. */
function optionOf(value: string, options: readonly string[]): string | undefined {
  const wanted = value.trim().toLowerCase();
  return options.find((option) => option.toLowerCase() === wanted);
}

function yearGroupOf(
  text: string,
  yearGroups: readonly string[] | undefined,
): { label: string; fragment: Fragment } | undefined {
  const year = YEAR_PATTERN.exec(text);
  const number = year ? yearNumberOf(year[0]) : undefined;
  const found = number !== undefined && year ? { label: `Year ${number}`, match: year } : undefined;
  const reception = found ? null : RECEPTION_PATTERN.exec(text);
  const candidate = found ?? (reception ? { label: "Reception", match: reception } : undefined);
  if (!candidate) return undefined;
  // When the form's list is known, the label must be on it: a label the form cannot show is
  // not a hit, and the text keeps the fragment for the model and the teacher.
  const label = yearGroups ? optionOf(candidate.label, yearGroups) : candidate.label;
  if (label === undefined) return undefined;
  return {
    label,
    fragment: { index: candidate.match.index, length: candidate.match[0].length },
  };
}

function subjectOf(text: string): { subject: string; fragment: Fragment } | undefined {
  let best: { subject: string; fragment: Fragment } | undefined;
  for (const { subject, pattern } of SUBJECT_PATTERNS) {
    const match = pattern.exec(text);
    if (match && (!best || match.index < best.fragment.index)) {
      best = { subject, fragment: { index: match.index, length: match[0].length } };
    }
  }
  return best;
}

function durationOf(text: string): { durationMin: number; fragment: Fragment } | undefined {
  const match = MINUTES_PATTERN.exec(text);
  if (!match) return undefined;
  const minutes = Number(match[1]);
  return {
    durationMin: Math.min(BRIEF_DURATION_MAX, Math.max(BRIEF_DURATION_MIN, minutes)),
    fragment: { index: match.index, length: match[0].length },
  };
}

function withoutFragments(text: string, fragments: Fragment[]): string {
  const ordered = [...fragments].sort((a, b) => b.index - a.index);
  let out = text;
  for (const { index, length } of ordered) out = out.slice(0, index) + out.slice(index + length);
  const topic = out.replace(/\s+/g, " ").replace(EDGE_SEPARATORS, "").trim();
  return topic.length > 0 ? topic : text.trim();
}

/**
 * The deterministic half: a year group ("Year 8", "Y8", "yr 8", Reception/EYFS), the first
 * subject from `SUBJECTS` as a whole word, and a minutes count clamped to the Brief's bounds. No
 * I/O, so it is unit-tested without a fake.
 */
export function parseBriefRules(text: string, yearGroups?: readonly string[]): ParseBriefRules {
  const year = yearGroupOf(text, yearGroups);
  const subject = subjectOf(text);
  const duration = durationOf(text);
  const fragments = [year?.fragment, subject?.fragment, duration?.fragment].filter(
    (f): f is Fragment => f !== undefined,
  );
  const hits: RuleField[] = [];
  if (year) hits.push("yearGroup");
  if (subject) hits.push("subject");
  if (duration) hits.push("durationMin");
  return {
    topic: withoutFragments(text, fragments),
    ...(year ? { yearGroup: year.label } : {}),
    ...(subject ? { subject: subject.subject } : {}),
    ...(duration ? { durationMin: duration.durationMin } : {}),
    hits,
  };
}

/** The model's fields laid over the rules': a rule hit is never overwritten, every string is guarded. */
export function mergeModelFields(
  rules: ParseBriefRules,
  output: ParseBriefOutput,
  yearGroups: readonly string[],
): { fields: ParseBriefFields; inferred: ModelField[]; dropped: number } {
  const known = new Set<RuleField>(rules.hits);
  const fields: ParseBriefFields = {};
  const inferred: ModelField[] = [];
  let dropped = 0;
  // A string survives when it carries no identifier pattern and is one of the offered options
  // (a person's name is neither a year group nor a subject).
  const guard = (value: string, options: readonly string[]): string | undefined =>
    findNamePatterns(value).length === 0 ? optionOf(value, options) : undefined;

  if (!known.has("yearGroup") && typeof output.yearGroup === "string") {
    const yearGroup = guard(output.yearGroup, yearGroups);
    if (yearGroup === undefined) dropped += 1;
    else {
      fields.yearGroup = yearGroup;
      inferred.push("yearGroup");
    }
  }
  if (!known.has("subject") && typeof output.subject === "string") {
    // "Other" is the prompt's word for a subject off the list; the form has no such value, so
    // the field stays blank for the teacher — not a guard drop.
    if (output.subject.trim().toLowerCase() !== "other") {
      const subject = guard(output.subject, SUBJECTS);
      if (subject === undefined) dropped += 1;
      else {
        fields.subject = subject;
        inferred.push("subject");
      }
    }
  }
  if (typeof output.level === "string") {
    fields.level = output.level;
    inferred.push("level");
  }
  if (!known.has("durationMin") && typeof output.durationMin === "number") {
    fields.durationMin = output.durationMin;
    inferred.push("durationMin");
  }
  return { fields, inferred, dropped };
}

/** The error's class for the log line; never its message, which may carry provider content. */
function errorClass(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

export async function parseBrief(
  input: ParseBriefRequest,
  deps: ParseBriefDeps,
): Promise<ParseBriefResult> {
  const yearGroups = input.yearGroups ?? [...YEAR_GROUPS];
  const rules = parseBriefRules(input.text, input.yearGroups);
  const { hits, ...found } = rules;
  const rulesOnly: ParseBriefResult = {
    ...found,
    inferred: [],
    rules: hits.length,
    dropped: 0,
    usedModel: false,
  };
  // `level` has no rule, so today the model is asked whenever a client is configured; the check
  // is what the design says ("for what is still blank") and becomes a real skip the day a rule
  // reads the level.
  const blank = MODEL_FIELDS.filter((field) => field === "level" || !hits.includes(field));
  if (blank.length === 0 || deps.ai === undefined || deps.ai.kind === "unconfigured") {
    return rulesOnly;
  }

  // One deadline for the whole call: as `timeoutMs` it bounds an attempt and logs a timeout; as
  // the signal it stops `callStructured`'s retry from doubling it.
  const deadline = AbortSignal.timeout(PARSE_BRIEF_DEADLINE_MS);
  const signal = deps.signal ? AbortSignal.any([deps.signal, deadline]) : deadline;
  const alreadyKnown: ParseBriefFields = {
    ...(rules.yearGroup !== undefined ? { yearGroup: rules.yearGroup } : {}),
    ...(rules.subject !== undefined ? { subject: rules.subject } : {}),
    ...(rules.durationMin !== undefined ? { durationMin: rules.durationMin } : {}),
  };
  let output: ParseBriefOutput;
  try {
    const call = await callStructured({
      deps: {
        ai: deps.ai,
        budget: createBudget(PARSE_BRIEF_BUDGET),
        signal,
        logger: deps.logger,
        context: deps.context ?? { lessonId: "", jobId: "" },
      },
      stage: "parse-brief",
      cls: "small",
      effort: "low",
      prompt: parseBriefPrompt,
      input: { text: input.text, yearGroups, subjects: [...SUBJECTS], alreadyKnown },
      schema: ParseBriefOutputSchema,
      maxOutputTokens: MAX_OUTPUT_TOKENS.parseBrief,
      timeoutMs: PARSE_BRIEF_DEADLINE_MS,
    });
    output = call.output;
  } catch (error) {
    deps.logger.warn(
      { stage: "parse-brief", error: errorClass(error) },
      "parse-brief model call failed; rules only",
    );
    return rulesOnly;
  }
  const merged = mergeModelFields(rules, output, yearGroups);
  return {
    ...rulesOnly,
    ...merged.fields,
    inferred: merged.inferred,
    dropped: merged.dropped,
    usedModel: true,
  };
}
