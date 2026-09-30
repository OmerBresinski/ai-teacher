import type { Finding, ImageBrief } from "@tj/domain/documents";
import { CONTENT_NO_PICTURE_VARIANT, withoutPicture } from "@tj/slides";
import type { PlanSlide } from "../prompts/plan-lesson";
import { FIXED_SLIDES } from "./check";
import { answerKeyFaults, renderWritten, type Written } from "./fit";
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

/** Most neighbouring small slides one check call reads together. */
export const CHECK_GROUP_MAX = 3;

/** A slide whose written text (notes and picture brief aside) is at most this many characters is small. */
export const SMALL_CHECK_CHARS = 500;

/** Forms whose slide carries answers a check must hold, facts or not. */
const ANSWER_FORMS = new Set([
  "hinge",
  "true-false",
  "matching",
  "fill-gap",
  "sort",
  "open-response",
  "check-set",
  "exit-ticket",
  "starter-set",
  "worked-example",
]);

/** A written slide's own words: every field but the notes and the picture brief. */
function shownText(out: Written): string {
  const { notes: _n, imageBrief: _i, ...shown } = out;
  return textOf(shown);
}

/**
 * Whether a slide needs no check call: it states no fact and holds no answer (a discussion prompt
 * with no number or claim in it; the title and objectives are drawn in code and never reach here).
 * `hasFacts` is whether `factsOfWritten` found any.
 */
export function skipsCheck(form: string, out: Written, hasFacts: boolean): boolean {
  if (hasFacts || ANSWER_FORMS.has(form)) return false;
  return !/\d/.test(shownText(out));
}

/** Whether a slide is small enough to share one check call with its neighbours. */
export function isSmallForCheck(out: Written): boolean {
  return shownText(out).length <= SMALL_CHECK_CHARS;
}

/**
 * The stream's check queue: slides are added as they close, and each call checks one slide or a
 * run of neighbouring small slides that have all closed (at most `maxGroup`). A small slide waits
 * for its next neighbour to close (or the stream to end) so the two can share a call; a large slide
 * goes alone at once. At most `limit` calls run at a time. `end` releases every slide still waiting;
 * `done` settles when every call has.
 */
export function checkBatcher(opts: {
  limit: number;
  maxGroup: number;
  /** The last slide the stream can close; a small slide at the end does not wait past it. */
  last: number;
  run: (group: number[]) => Promise<void>;
}) {
  const closed = new Map<number, boolean>();
  const sent = new Set<number>();
  const running: Promise<void>[] = [];
  const queue = limiter(opts.limit);
  let ended = false;
  const send = (group: number[]) => {
    for (const n of group) sent.add(n);
    running.push(queue(() => opts.run(group)));
  };
  const pump = () => {
    const open = [...closed.keys()].filter((n) => !sent.has(n)).sort((a, b) => a - b);
    for (const n of open) {
      if (sent.has(n)) continue;
      if (!closed.get(n)) {
        send([n]);
        continue;
      }
      const group = [n];
      let waiting = false;
      for (let m = n + 1; group.length < opts.maxGroup; m++) {
        if (m > opts.last) break;
        if (!closed.has(m)) {
          waiting = !ended;
          break;
        }
        if (sent.has(m) || !closed.get(m)) break;
        group.push(m);
      }
      if (!waiting) send(group);
    }
  };
  return {
    add(n: number, small: boolean) {
      if (closed.has(n)) return;
      closed.set(n, small);
      pump();
    },
    end() {
      ended = true;
      pump();
    },
    done: () => Promise.all(running).then(() => undefined),
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

/**
 * The palette row a picture slide is re-planned as when its picture cannot be supplied. It draws
 * what `@tj/slides` `withoutPicture` names for the slide (content, `headed`, no slot); the test pins
 * the two together.
 */
export const NO_PICTURE_ROW = { form: "explain", layout: "default" } as const;

/** The slides package's no-picture form of a written picture slide, as kind and variant. */
export function noPictureTarget(form: string, layout: string, out: Written) {
  const r = renderWritten(form, layout, out);
  const w = withoutPicture(r.spec, r.variant, r.structure);
  return { kind: w.spec.kind, variant: w.variant ?? CONTENT_NO_PICTURE_VARIANT };
}

/**
 * One retry's brief (round A6): the same subject and must-show list, searched in the other library.
 * A generic subject ("Roman milestone", "potassium permanganate in water") searches Pexels only
 * and a stock library rarely holds it; Commons does. The old retry cut the subject to three words
 * and dropped the must-show list, so the gate passed any on-subject stock photo (off-topic
 * pictures); the gate now stays whole, and no photo beats a wrong one.
 */
export function broadenedBrief(brief: ImageBrief): ImageBrief | undefined {
  if (!brief.subject.trim()) return undefined;
  return { ...brief, specific: !(brief.specific ?? false) };
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
