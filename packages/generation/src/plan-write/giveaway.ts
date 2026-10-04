/**
 * lab/cand-fix gates (audit problems 1, 3, 4). All code, no model call:
 * - a question whose keyed answer's words are already in its own stem (`answerInStem`);
 * - a question re-asking the numbers an earlier slide showed (`shownCase`);
 * - a teach picture that holds a question's answer, about to be moved under it (`visualHolds`);
 * - a lesson key term that no slide shows before a question uses it (`termsOffSlide`);
 * - each key term's first on-screen slide, for the renderer's bold (`firstUses`, `boldTerm`).
 * The caller re-asks once per flag, re-gates, then falls back (stages/plan-write.ts).
 */
import type { RichDoc } from "@tj/domain/documents";
import { FIXED_SLIDES } from "./check";
import type { Written } from "./fit";
import type { PassSlide } from "./slide-check";

const textOf = (v: unknown): string =>
  typeof v === "string"
    ? v
    : Array.isArray(v)
      ? v.map(textOf).join(" ")
      : v && typeof v === "object"
        ? Object.values(v).map(textOf).join(" ")
        : "";

const STOP = new Set(
  "the and for with that this from into their what when where which each they them than then does have more most some your will only also make show give take about because there these those would could should after before other being were been many much very just like over under such while".split(
    " ",
  ),
);
const wordsOf = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .split(" ")
    .filter((w) => w.length >= 4 && !STOP.has(w));
const stem = (w: string) => w.replace(/(?:ies|es|s|ing|ed)$/, "").slice(0, 8);
/** Two stems meet when equal, or when one opens the other and is at least five letters long. */
const meet = (a: string, b: string) =>
  a === b || (Math.min(a.length, b.length) >= 5 && (a.startsWith(b) || b.startsWith(a)));
const numbersOf = (s: string) => [...new Set(s.match(/\d+(?:\.\d+)?/g) ?? [])];

/** The topic's own words, which a question may share with its answer. */
export const exemptStems = (topic: string): string[] => wordsOf(topic).map(stem);

/** The answer's content stems, the topic's left out. */
function answerStems(answer: string, exempt: readonly string[]): string[] {
  return [...new Set(wordsOf(answer).map(stem))].filter((s) => !exempt.some((e) => meet(e, s)));
}

/**
 * Whether `text` gives `answer` away: half or more of the answer's content words (the topic's
 * left out) are in it, or every number the answer has is in it. Returns the words found.
 */
export function holdsAnswer(text: string, answer: string, exempt: readonly string[]): string[] {
  // A unit after a number ("6 counters") is the question's own noun, not the answer (CAND-FIX run).
  const units = [...answer.toLowerCase().matchAll(/\d\s*([a-z]{4,})/g)].map((m) =>
    stem(m[1] ?? ""),
  );
  const want = answerStems(answer, exempt).filter((w) => !units.includes(w));
  const have = wordsOf(text).map(stem);
  const found = want.filter((w) => have.some((h) => meet(h, w)));
  if (want.length > 0 && found.length > 0 && found.length * 2 >= want.length) return found;
  const nums = numbersOf(answer);
  const shown = numbersOf(text);
  // Only a lone number: a calculation ("18 ÷ 3 × 2") is built from the question's numbers by design.
  const lone = /^\D*\d+(?:\.\d+)?\D*$/.test(answer) && !/[+×÷*/=−-]\s*\d/.test(answer);
  if (want.length === 0 && lone && nums.every((n) => shown.includes(n))) return nums;
  return [];
}

/** One keyed question on a slide: the field it lives in, its item index, its stem and answer. */
export type KeyedQuestion = { field: string; item?: number; stem: string; answer: string };

/** The keyed questions a written slide asks (sets, hinges, gap fills); others have no key shown. */
export function keyedQuestions(form: string, out: Written): KeyedQuestion[] {
  if (form === "check-set" || form === "starter-set") {
    const qs = Array.isArray(out.questions) ? out.questions : [];
    return qs.flatMap((q, item) =>
      q && typeof q === "object"
        ? [
            {
              field: "questions",
              item,
              stem: textOf((q as Record<string, unknown>).question),
              answer: textOf((q as Record<string, unknown>).answer),
            },
          ]
        : [],
    );
  }
  if (form === "hinge") {
    const opts = Array.isArray(out.options) ? (out.options as Record<string, unknown>[]) : [];
    const right = opts.find((o) => o && o.correct === true);
    return right ? [{ field: "stem", stem: textOf(out.stem), answer: textOf(right.text) }] : [];
  }
  if (form === "fill-gap") {
    return [
      {
        field: "sentence",
        stem: `${textOf(out.stem)} ${textOf(out.sentence)}`,
        answer: textOf(out.answers),
      },
    ];
  }
  return [];
}

/** All the answers a question slide reveals, for the picture check. */
export function answersOf(form: string, out: Written): string[] {
  const keyed = keyedQuestions(form, out).map((q) => q.answer);
  if (form === "open-response") keyed.push(textOf(out.modelAnswer));
  return keyed.filter((a) => a.trim() !== "");
}

/** What a slide shows on screen: every field but its notes, picture brief and diagram spec. */
export function onScreen(out: Written): string {
  const { notes: _n, imageBrief: _i, diagram: _d, ...shown } = out;
  return textOf(shown);
}

const asks = (s: PassSlide) =>
  s.number > FIXED_SLIDES &&
  s.row.role !== "retrieve" &&
  (s.row.role === "practise" ||
    [
      "hinge",
      "true-false",
      "matching",
      "fill-gap",
      "sort",
      "open-response",
      "check-set",
      "exit-ticket",
    ].includes(s.row.form));

export type GiveawayFlag = {
  number: number;
  field: string;
  item?: number;
  kind: "answer-in-stem" | "shown-case";
  detail: string;
};

/**
 * Questions answerable by reading: the stem holds the answer's words (starters included: "What
 * charge does a positive ion have?" → "Positive"), or a check's stem re-uses two or more numbers
 * that one earlier slide's on-screen text already worked with.
 */
export function giveaways(slides: readonly PassSlide[], topic: string): GiveawayFlag[] {
  const exempt = exemptStems(topic);
  const ordered = [...slides].sort((a, b) => a.number - b.number);
  const out: GiveawayFlag[] = [];
  for (const s of ordered) {
    if (s.number <= FIXED_SLIDES) continue;
    for (const q of keyedQuestions(s.row.form, s.out)) {
      // A choice question ("a tortoise or a rabbit?") names its answer among the others by design.
      const choice = /\bor\b/i.test(q.stem);
      const found = choice ? [] : holdsAnswer(q.stem, q.answer, exempt);
      if (found.length > 0) {
        out.push({
          number: s.number,
          field: q.field,
          ...(q.item !== undefined ? { item: q.item } : {}),
          kind: "answer-in-stem",
          detail: `"${q.stem}" holds its answer "${q.answer}" (${found.join(", ")})`,
        });
        continue;
      }
      if (!asks(s)) continue;
      const nums = numbersOf(q.stem);
      if (nums.length < 2) continue;
      const before = ordered.find(
        (e) =>
          e.number > FIXED_SLIDES &&
          e.number < s.number &&
          !asks(e) &&
          nums.every((n) => numbersOf(onScreen(e.out)).includes(n)),
      );
      if (before)
        out.push({
          number: s.number,
          field: q.field,
          ...(q.item !== undefined ? { item: q.item } : {}),
          kind: "shown-case",
          detail: `"${q.stem}" re-uses the numbers ${nums.join(", ")} that slide ${before.number} already worked with`,
        });
    }
  }
  return out;
}

/** Whether a picture's own text (a table's cells, a diagram's labels) holds any of the answers. */
export function visualHolds(
  visualText: string,
  answers: readonly string[],
  topic: string,
): string | undefined {
  const exempt = exemptStems(topic);
  for (const a of answers) {
    const found = holdsAnswer(visualText, a, exempt);
    if (found.length > 0) return `${a} (${found.join(", ")})`;
  }
  return undefined;
}

/* ------------------------------------------------------------------ key terms */

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The term as a whole word or phrase, any case, plural allowed. */
export const termPattern = (term: string) =>
  new RegExp(`(?<![A-Za-z])${escapeRe(term.trim())}(?:s|es)?(?![A-Za-z])`, "i");
export const hasTerm = (text: string, term: string) => termPattern(term).test(text);

/** The lesson's key terms, cleaned: trimmed, de-duplicated, at most five words each. */
export function cleanTerms(terms: readonly unknown[]): string[] {
  const seen = new Set<string>();
  return terms.flatMap((t) => {
    if (typeof t !== "string") return [];
    const term = t.trim().replace(/^["'“‘]|["'”’.]$/g, "");
    const k = term.toLowerCase();
    if (!term || seen.has(k) || term.split(/\s+/).length > 5) return [];
    seen.add(k);
    return [term];
  });
}

/** Each key term's first slide that shows it on screen (title and objectives left out). */
export function firstUses(
  slides: readonly PassSlide[],
  terms: readonly string[],
): Map<string, number> {
  const ordered = [...slides].sort((a, b) => a.number - b.number);
  const first = new Map<string, number>();
  for (const term of terms) {
    const s = ordered.find((x) => x.number > FIXED_SLIDES && hasTerm(onScreen(x.out), term));
    if (s) first.set(term, s.number);
  }
  return first;
}

export type TermFlag = {
  term: string;
  /** The question slide that uses the term first, when one does. */
  askedOn?: number;
  /** The teach slide to put the term on: the one whose notes carry it, else the last teach slide before. */
  target?: number;
  kind: "asked-first" | "recalled-first" | "notes-only" | "nowhere";
};

/**
 * Key terms no teaching slide shows before they are used: first on screen on a question slide,
 * or only ever in notes. The target is the earliest teach slide whose notes use the term, else the
 * last teach slide before the question that serves the same objective.
 */
export function termsOffSlide(
  slides: readonly PassSlide[],
  terms: readonly string[],
  /** Round 2b: text on screen that no written slide holds (the title slide), and drawn labels. */
  alsoShown = "",
): TermFlag[] {
  const ordered = [...slides].sort((a, b) => a.number - b.number);
  const teach = ordered.filter(
    (s) => s.number > FIXED_SLIDES && s.row.role === "teach" && Array.isArray(s.out.body),
  );
  const out: TermFlag[] = [];
  for (const term of terms) {
    const first = ordered.find((x) => x.number > FIXED_SLIDES && hasTerm(onScreen(x.out), term));
    const inNotes = teach.find((s) => hasTerm(textOf(s.out.notes), term));
    if (!first) {
      // On the title slide or in a drawing's labels: on screen, so not "nowhere" (round 2 false flags).
      const drawn = ordered.map((x) => textOf(x.out.diagram)).join(" ");
      if (hasTerm(`${alsoShown} ${drawn}`, term) && !inNotes) continue;
      out.push({
        term,
        kind: inNotes ? "notes-only" : "nowhere",
        ...(inNotes ? { target: inNotes.number } : {}),
      });
      continue;
    }
    // A retrieve slide is for earlier learning: one that shows this lesson's term is re-asked.
    if (first.row.role === "retrieve" || first.row.form === "starter-set") {
      out.push({ term, askedOn: first.number, kind: "recalled-first", target: first.number });
      continue;
    }
    if (!asks(first)) continue;
    const before = teach.filter((s) => s.number < first.number);
    const notesBefore = before.find((s) => hasTerm(textOf(s.out.notes), term));
    const sameObjective = [...before]
      .reverse()
      .find((s) => s.row.objectives.some((o) => first.row.objectives.includes(o)));
    const target = notesBefore ?? sameObjective ?? before[before.length - 1];
    out.push({
      term,
      askedOn: first.number,
      kind: "asked-first",
      ...(target ? { target: target.number } : {}),
    });
  }
  return out;
}

/**
 * A rich doc with the first whole-word use of `term` set bold (the lab's stand-in for the shared
 * renderer's key-term mark). Unchanged when the term is not there or already bold.
 */
export function boldTerm(doc: RichDoc, term: string): { doc: RichDoc; done: boolean } {
  let done = false;
  const re = termPattern(term);
  type Node = NonNullable<RichDoc["content"]>[number];
  const walk = (node: Node): Node => {
    if (done) return node;
    if (node.type === "text" && typeof node.text === "string") {
      const m = re.exec(node.text);
      if (!m || node.marks?.some((k) => k.type === "bold")) return node;
      done = true;
      const at = m.index;
      const parts = [
        node.text.slice(0, at),
        node.text.slice(at, at + m[0].length),
        node.text.slice(at + m[0].length),
      ];
      return {
        type: "__split",
        content: [
          ...(parts[0] ? [{ ...node, text: parts[0] }] : []),
          { ...node, text: parts[1], marks: [...(node.marks ?? []), { type: "bold" }] },
          ...(parts[2] ? [{ ...node, text: parts[2] }] : []),
        ],
      } as unknown as Node;
    }
    if (!node.content) return node;
    const content = node.content.flatMap((c) => {
      const w = walk(c as Node);
      return (w as { type: string }).type === "__split" ? ((w as Node).content ?? []) : [w];
    });
    return { ...node, content } as Node;
  };
  const content = (doc.content ?? []).map((n) => walk(n as Node));
  return { doc: { ...doc, content } as RichDoc, done };
}

/**
 * Round 2: whether a teach picture is about what a question slide asks: they share a content word
 * beyond the topic's own (round 1: a Ruhr timeline under a counterfactual, a stages table under a
 * defence-mechanism question).
 */
export function pictureFits(visualText: string, questionText: string, topic: string): boolean {
  const exempt = exemptStems(topic);
  const want = wordsOf(questionText)
    .map(stem)
    .filter((w) => !exempt.some((e) => meet(e, w)));
  const have = wordsOf(visualText).map(stem);
  return want.some((w) => have.some((h) => meet(h, w)));
}

/* ------------------------------------------------------------------ notes hygiene (round 3) */

const COUNT_WORD =
  "(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen)";
/** A sentence about the deck's own plan: slide counts, teach-slide counts, plan rows (round 2 rivers-new s4). */
const PLANNING = new RegExp(
  `\\b${COUNT_WORD}\\s+(?:more\\s+|remaining\\s+|teaching\\s+|teach\\s+)?slides?\\b|\\bslides? in total\\b|\\b(?:remaining|other) slides\\b|\\bteach slides?\\b|\\bplan rows?\\b|\\bthe plan\\b`,
  "i",
);

/** The notes without any sentence that talks about the deck's own plan; the rest word for word. */
export function withoutPlanning(notes: string): { notes: string; cut: string[] } {
  const parts = notes.split(/(?<=[.!?])\s+/);
  const cut = parts.filter((p) => PLANNING.test(p));
  return cut.length === 0
    ? { notes, cut }
    : { notes: parts.filter((p) => !PLANNING.test(p)).join(" "), cut };
}

/** The items a question slide numbers on screen (set questions, practise points). */
function numberedItems(form: string, role: string, out: Written): number {
  if (Array.isArray(out.questions)) return out.questions.length;
  if (role === "practise" && Array.isArray(out.points)) return out.points.length;
  return 0;
}

/**
 * Round 3: notes whose numbered answers do not match the slide's numbered items (a re-asked or
 * dropped item left "4." answers for 3 questions). Undefined when they agree or the notes number
 * nothing. Counts the highest answer number ("1.", "2)", "Q3", "Question 4").
 */
export function notesOutOfStep(
  form: string,
  role: string,
  out: Written,
): { items: number; answers: number } | undefined {
  const items = numberedItems(form, role, out);
  if (items === 0) return undefined;
  const notes = textOf(out.notes);
  const nums = [
    ...notes.matchAll(/(?:^|[\s(])(?:Q(?:uestion)?\s*)?([1-9])(?:[.):]|\s*[-–:])\s/gi),
  ].map((m) => Number(m[1]));
  if (nums.length === 0) return undefined;
  const answers = Math.max(...nums);
  return answers === items ? undefined : { items, answers };
}
