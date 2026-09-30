import type { DesignSlot } from "../prompts/design-cycle";

/*
 * Designer r6: every answer a pupil is asked for is taught on a slide first (std-judge, arm F: content
 * tested before it was taught, or taught only in the notes; wrong starter keys). A check, closing or
 * opening answer is supported when the text of an earlier teaching slide carries it: by reference
 * when the question and the slides name key ideas or facts (`refs`), else by word overlap on the
 * answer's key terms. An opening may also lean on the prior knowledge the brief states. Notes never
 * count: what is tested has to be on a slide.
 */

/** Forms that ask pupils for an answer; the rest teach, show or ask for talk. */
const ASKING_FORMS = new Set([
  "hinge",
  "true-false",
  "matching",
  "fill-gap",
  "sort",
  "open-response",
  "discussion",
]);

/** Everything a slot prints on its slide, notes left out. Empty for a form that asks. */
export function taughtText(slot: DesignSlot): string {
  if (ASKING_FORMS.has(slot.form)) return "";
  const { form: _form, notes: _notes, ...shown } = slot as DesignSlot & { notes?: string };
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(shown);
  return out.join(" ");
}

/**
 * Key-idea or fact ids a slot names (`keyIdeaRefs`, `factRefs`), when the design wrote any;
 * undefined otherwise, and the check falls back to word overlap.
 */
export function refsOfSlot(slot: DesignSlot): string[] | undefined {
  const s = slot as { keyIdeaRefs?: unknown; factRefs?: unknown };
  const refs = [s.keyIdeaRefs, s.factRefs]
    .flatMap((r) => (Array.isArray(r) ? r : []))
    .filter((r): r is string => typeof r === "string");
  return refs.length > 0 ? refs : undefined;
}

/** A question a slot asks: the text pupils see, and the answer key. Undefined for a teaching slot. */
export function askedOf(slot: DesignSlot): { question: string; answer: string } | undefined {
  switch (slot.form) {
    case "hinge":
      return {
        question: slot.stem,
        answer: slot.options.find((o) => o.correct)?.text ?? "",
      };
    case "true-false":
      // A true statement is the taught claim; a false one is corrected by its reason.
      return {
        question: "",
        answer: slot.correct ? slot.statement : `${slot.statement} ${slot.explanation}`,
      };
    case "matching":
      return {
        question: slot.stem,
        answer: slot.pairs.map((p) => `${p.left} ${p.right}`).join(" "),
      };
    case "fill-gap":
      return { question: `${slot.stem} ${slot.sentence}`, answer: slot.answers.join(" ") };
    case "sort":
      return { question: slot.stem, answer: slot.steps.join(" ") };
    case "open-response":
      return { question: slot.stem, answer: slot.modelAnswer };
    default:
      return undefined;
  }
}

const STOP = new Set(
  (
    "the a an and or but of to in on at by for with from into onto as is are was were be been being it its this that these those " +
    "they them their there then than which who whom whose what when where why how not no yes do does did done can could will would " +
    "should may might must has have had so if also more most less least very just only each every all any some such own same other " +
    "both between because about over under after before during while you your we our he she his her him i me my true false answer " +
    "correct option options statement one two three four"
  ).split(" "),
);

/**
 * A word reduced to a rough stem: plural and verb endings off, then its first 6 letters, so
 * "rivers" meets "river" and "evaporated" meets "evaporation". Lenient on purpose: a missed
 * match costs a re-fill, a false one only a check that stands.
 */
function stem(word: string): string {
  const w = word
    .replace(/[’']s$/, "")
    .replace(/ies$/, "y")
    .replace(/(ing|ed|es|s)$/, "");
  return w.slice(0, 6);
}

/** Content words of a text: lower case, no stop words, no bare numbers (worked out, not taught). */
export function keyTerms(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z][a-z'’-]*[a-z]|[a-z]/g) ?? [];
  return [...new Set(words.filter((w) => w.length >= 3 && !STOP.has(w)).map(stem))];
}

export type Asked = {
  /** 1-based slide the question is on. */
  slide: number;
  where: "check" | "opening" | "closing";
  question: string;
  answer: string;
  /** Key-idea or fact ids the question tests, when the design names them. */
  refs?: readonly string[] | undefined;
};

export type Taught = {
  /** 1-based slide. */
  slide: number;
  text: string;
  /** Key-idea or fact ids the slide teaches, when the design names them. */
  refs?: readonly string[] | undefined;
};

export type Support = {
  slide: number;
  where: Asked["where"];
  ok: boolean;
  /** How it was judged: by reference, by overlap, or nothing to judge (a numeric answer). */
  by: "refs" | "overlap" | "nothing-to-check";
  /** The answer's key terms no earlier slide carries (overlap only). */
  missing: string[];
};

/** Share of an answer's new key terms an earlier slide must carry for it to count as taught. */
export const SUPPORT_SHARE = 0.5;

/**
 * Whether each question's answer is taught on a slide before it (or, for an opening, in the prior
 * knowledge the brief states). By `refs` when the question and at least one earlier slide carry
 * them; otherwise the answer's key terms not already in the question must be at least
 * `SUPPORT_SHARE` present in earlier slide text. An answer with no such terms (a number, a verdict)
 * has nothing to check and passes.
 */
export function answerSupport(
  asked: readonly Asked[],
  taught: readonly Taught[],
  opts: { priorKnowledge?: string | undefined } = {},
): Support[] {
  return asked.map((q) => {
    const before = taught.filter((t) => t.slide < q.slide);
    const withRefs = before.flatMap((t) => t.refs ?? []);
    if (q.refs && q.refs.length > 0 && withRefs.length > 0) {
      const have = new Set(withRefs);
      const missing = q.refs.filter((r) => !have.has(r));
      return { slide: q.slide, where: q.where, ok: missing.length === 0, by: "refs", missing };
    }
    const given = new Set(keyTerms(q.question));
    const terms = keyTerms(q.answer).filter((t) => !given.has(t));
    if (terms.length === 0)
      return { slide: q.slide, where: q.where, ok: true, by: "nothing-to-check", missing: [] };
    const source = [
      ...before.map((t) => t.text),
      ...(q.where === "opening" && opts.priorKnowledge ? [opts.priorKnowledge] : []),
    ].join(" ");
    const have = new Set(keyTerms(source));
    const missing = terms.filter((t) => !have.has(t));
    const ok = (terms.length - missing.length) / terms.length >= SUPPORT_SHARE;
    return { slide: q.slide, where: q.where, ok, by: "overlap", missing };
  });
}

/** The re-fill's reason for a check whose answer no earlier slide teaches. Never "move it". */
export function unsupportedReason(s: Support, taughtSlides: readonly number[]): string {
  const span =
    taughtSlides.length > 0 ? `slides ${taughtSlides.join(", ")}` : "the slides before it";
  const what =
    s.missing.length > 0 ? ` (${s.missing.slice(0, 6).join(", ")} are on no earlier slide)` : "";
  return `its answer is not taught on an earlier slide${what}; ask about what ${span} teach`;
}
