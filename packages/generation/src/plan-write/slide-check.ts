import type { Finding, ImageBrief } from "@tj/domain/documents";
import type { PlanSlide } from "../prompts/plan-lesson";
import { FIXED_SLIDES } from "./check";
import { answerKeyFaults, type Written } from "./fit";
import { isSetForm } from "./menu";

/*
 * The stream's per-slide checks (spike/parallel-slides): what code decides about one slide the
 * moment it closes (its answer key, whether its picture slot can be filled), and the small
 * lesson-level pass kept for the rules that span slides (taught before tested, one hinge, the
 * objectives slide). The model calls live in stages/plan-write.ts; these are pure.
 */

/** Checks in flight at once across the lesson (verify, evaluate and their re-writes per slide). */
export const SLIDE_CHECK_CONCURRENCY = 4;

/** A queue that runs at most `limit` tasks at once, in the order they were added. */
export function limiter(limit: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  const release = () => {
    active -= 1;
    waiting.shift()?.();
  };
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= limit) await new Promise<void>((go) => waiting.push(go));
    active += 1;
    try {
      return await task();
    } finally {
      release();
    }
  };
}

const STOP = new Set(["the", "and", "for", "with", "that", "this", "are", "was", "its", "from"]);

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/(?<!\d)\.|\.(?!\d)/g, " ")
    .split(" ")
    .filter(Boolean);

/** Whether `text` states `answer`: the phrase itself, or every content word of it. */
export function states(text: string, answer: string): boolean {
  const t = words(text);
  const a = words(answer);
  if (a.length === 0) return true;
  if (` ${t.join(" ")} `.includes(` ${a.join(" ")} `)) return true;
  const have = new Set(t);
  const content = a.filter((w) => (w.length >= 3 || /\d/.test(w)) && !STOP.has(w));
  return content.length > 0 && content.every((w) => have.has(w));
}

export type AnswerKeyFault = { field: string; failure: string };

/**
 * The answer key checked in code: the answer the slide reveals must be the answer its question
 * field marks and the answer its notes state. Each fault names the field one re-write fixes.
 */
export function answerKeyMismatches(form: string, out: Written): AnswerKeyFault[] {
  const notes = typeof out.notes === "string" ? out.notes : "";
  const faults: AnswerKeyFault[] = answerKeyFaults(form, out).map((f) => ({
    field: "pairs",
    failure: `its answer key does not hold: ${f}`,
  }));
  if (form === "hinge") {
    const options = (Array.isArray(out.options) ? out.options : []) as {
      text?: string;
      correct?: boolean;
    }[];
    const right = options.filter((o) => o.correct === true);
    if (right.length !== 1) {
      faults.push({
        field: "options",
        failure: `${right.length} options are marked correct; exactly one option must be the one defensible answer`,
      });
    } else if (!states(notes, String(right[0]?.text ?? ""))) {
      faults.push({
        field: "notes",
        failure: `the notes do not state the answer the slide reveals ("${right[0]?.text}"); they give that answer first`,
      });
    }
  } else if (form === "true-false") {
    const said = /\b(true|false)\b/i.exec(notes)?.[1]?.toLowerCase();
    const is = out.correct === true ? "true" : "false";
    if (said !== is) {
      faults.push({
        field: "notes",
        failure: said
          ? `the notes say the statement is ${said}, but the slide reveals it is ${is}`
          : `the notes do not say whether the statement is true or false (the slide reveals ${is})`,
      });
    }
  } else if (form === "fill-gap") {
    const answers = (Array.isArray(out.answers) ? out.answers : []).map(String);
    const missing = answers.filter((a) => !states(notes, a));
    if (missing.length > 0) {
      faults.push({
        field: "notes",
        failure: `the notes do not state the answer the slide reveals (${missing.map((m) => `"${m}"`).join(", ")})`,
      });
    }
  }
  return faults;
}

/** Forms whose slot is a picture or a drawing that code fills after writing. */
export const PICTURE_FORMS = new Set(["photo", "diagram-slot", "figure"]);

/**
 * A picture slide without its picture: the same heading and body as an explain slide, so the text
 * takes the full width. Nothing is dropped; only the slot goes.
 */
export function noPictureOf(out: Written): Written {
  const { notes, heading, body } = out;
  return { notes: notes ?? "", heading: heading ?? "", body: body ?? [] };
}

/** One retry's brief: the subject's first three words, no must-show list. */
export function broadenedBrief(brief: ImageBrief): ImageBrief | undefined {
  const subject = brief.subject.split(/\s+/).filter(Boolean).slice(0, 3).join(" ");
  if (!subject) return undefined;
  if (subject === brief.subject && (brief.mustShow ?? []).length === 0) return undefined;
  return { ...brief, subject, mustShow: [] };
}

const CHECK_FORMS = new Set([
  "hinge",
  "true-false",
  "matching",
  "fill-gap",
  "sort",
  "open-response",
  "check-set",
  "exit-ticket",
]);
const isCheck = (form: string) => CHECK_FORMS.has(form);
const key = (s: string) => s.trim().toLowerCase();

/** One written slide as the lesson pass reads it. */
export type PassSlide = { number: number; row: PlanSlide; out: Written; slideId?: string };

/** Every string in a written slide, joined. */
const textOf = (v: unknown): string =>
  typeof v === "string"
    ? v
    : Array.isArray(v)
      ? v.map(textOf).join(" ")
      : v && typeof v === "object"
        ? Object.values(v).map(textOf).join(" ")
        : "";

/**
 * The lesson-level pass: the rules no single slide can see. Every objective is taught on a slide
 * before a slide tests it; every idea a slide tests is taught earlier (by the plan's keys); a term
 * a vocabulary slide defines is not tested before that slide; one hinge; the objectives slide
 * second. Each fault is a warning finding.
 */
export function crossSlideFindings(
  slides: readonly PassSlide[],
  opts: { objectives: number; secondSlideKind: string | undefined },
): Finding[] {
  const out: Finding[] = [];
  const at = (s: PassSlide) => (s.slideId ? { slideId: s.slideId } : {});
  const ordered = [...slides].sort((a, b) => a.number - b.number);
  if (opts.secondSlideKind !== "objectives") {
    out.push({
      check: "lesson-order",
      severity: "warning",
      target: {},
      message: "The objectives slide is not the second slide.",
    });
  }
  const hinges = ordered.filter((s) => s.row.form === "hinge").length;
  if (hinges !== 1) {
    out.push({
      check: "lesson-order",
      severity: "warning",
      target: {},
      message: `The lesson has ${hinges} hinge questions; it has one.`,
    });
  }
  const taughtKeys = new Set<string>();
  const taughtObjectives = new Set<number>();
  for (const s of ordered) {
    if (s.number <= FIXED_SLIDES) continue;
    const checking = isCheck(s.row.form);
    const retrieval = s.row.form === "starter-set" || s.row.role === "retrieve";
    if (checking && !retrieval) {
      const missing = s.row.tests.filter((t) => !taughtKeys.has(key(t)));
      const early = s.row.objectives.filter((o) => !taughtObjectives.has(o));
      if (missing.length > 0 || early.length > 0) {
        const what = [...early.map((o) => `objective ${o}`), ...missing.map((m) => `"${m}"`)].join(
          ", ",
        );
        out.push({
          check: "lesson-order",
          severity: "warning",
          target: at(s),
          message: `Slide ${s.number} tests ${what} before any slide teaches it.`,
        });
      }
    }
    if (!checking && !retrieval) {
      for (const t of s.row.teaches) taughtKeys.add(key(t));
      for (const o of s.row.objectives) taughtObjectives.add(o);
    }
  }
  for (let o = 1; o <= opts.objectives; o++) {
    if (!taughtObjectives.has(o)) {
      out.push({
        check: "lesson-order",
        severity: "warning",
        target: {},
        message: `Objective ${o} is taught on no slide.`,
      });
    }
  }
  // A term tested before the vocabulary slide that defines it.
  for (const v of ordered.filter((s) => s.row.form === "vocabulary")) {
    const entries = (Array.isArray(v.out.entries) ? v.out.entries : []) as { term?: string }[];
    for (const e of entries) {
      const term = String(e.term ?? "").trim();
      if (term.length < 3) continue;
      const before = ordered.find(
        (s) =>
          s.number < v.number &&
          s.number > FIXED_SLIDES &&
          (isCheck(s.row.form) || isSetForm(s.row.form)) &&
          s.row.form !== "starter-set" &&
          states(textOf({ ...s.out, notes: "" }), term),
      );
      if (before) {
        out.push({
          check: "lesson-order",
          severity: "warning",
          target: at(before),
          message: `Slide ${before.number} tests "${term}" before slide ${v.number} teaches it.`,
        });
      }
    }
  }
  return out;
}

/** The writer field an evaluate finding's quoted evidence sits in, when one holds it. */
export function fieldOfEvidence(out: Written, evidence: string | undefined): string | undefined {
  if (!evidence) return undefined;
  const needle = words(evidence).join(" ");
  if (!needle) return undefined;
  const fields = Object.keys(out).filter((k) => k !== "notes");
  const hit = [...fields, "notes"].find((k) =>
    ` ${words(textOf(out[k])).join(" ")} `.includes(` ${needle} `),
  );
  return hit;
}
