import {
  deriveAgeBand,
  type Lesson,
  normaliseText,
  type RichDoc,
  richDocToPlainText,
  type Slide,
  type SlideElement,
  walkElements,
  yearNumberOf,
} from "@tj/domain/documents";
import { type AnswerItem, answerGroupsOf } from "../templates/end-answers";

/*
 * The lesson digest (worksheets plan v2 §1, ticket T5): what every new worksheet is written from.
 * Read from the lesson's own slides when the sheet is asked for, so a teacher's slide edits carry
 * over (D1). Pure; no model call.
 *
 * It reads the words a slide shows (each text element's doc), found by the element names the slide
 * templates own (`DIGEST_NAMES`, pinned to the template constants in `digest-names.test.ts`), not
 * by template id, so a slide moved onto another template that keeps the same roles still reads.
 */

/** The template element names the digest reads, by the role they play. */
export const DIGEST_NAMES = {
  /** A slide's title line: most templates' `Heading`, the title slide's `Title`. */
  heading: ["Heading", "Title"],
  /** The reasons template's question stands where a heading would (`REASON_NAMES.question`). */
  headingFallback: ["Question"],
  /** Name and meaning pairs, one entry per template that draws them. */
  pairs: [
    { name: "Row name", meaning: "Row line" }, // panel-list
    { name: "Item name", meaning: "Item line" }, // items-row, and stages drawn as a row
    { name: "Stage name", meaning: "Stage line" }, // stages
    { name: "Reason head", meaning: "Reason text" }, // reasons
    { name: "Key term", meaning: "Key meaning" }, // picture-text key cards
    { name: "Card label", meaning: "Card body" }, // cards-grid
  ],
  /** Worked example rows (`WORKED_NAMES`) and a method example's steps. */
  eqLeft: "Eq left",
  eqSign: "Eq sign",
  eqRight: "Eq right",
  move: "Move",
  step: "Item",
  /** A multiple-choice card (`HINGE_NAMES.card`) and its words (`HINGE_NAMES.text`). */
  option: "Option",
  optionText: "Option text",
  /** Practice and exit-ticket task lines (`WA_NAMES.task`, `QUICK_NAMES.question`). */
  tasks: ["Task", "Question"],
  /** Small labels that carry no lesson content. */
  labels: ["Kicker", "Key label", "Check label", "Marker", "Number"],
} as const;

/** The headings `notesText` writes in a slide's notes (`writer/notes.ts`). */
export const NOTES_HEADINGS = ["Running", "Answers", "Misconceptions", "Background"] as const;

export type DigestNamedItem = { name: string; meaning: string };

export type DigestTaught = {
  slide: number;
  heading: string;
  text: string;
  namedItems?: DigestNamedItem[];
  worked?: string[];
};

export type DigestAskedKind = "mc" | "practice" | "exit";

export type DigestAsked = {
  slide: number;
  kind: DigestAskedKind;
  question: string;
  answer: string;
  working?: string;
  options?: string[];
};

export type DigestTerm = { term: string; meaning: string; slide: number };

export type LessonDigest = {
  lesson: {
    title: string;
    subject: string;
    yearGroup: string;
    /** "KS1" … "KS5", "EYFS", or "" when the year group names none. */
    keyStage: string;
    readingLevel: string;
    historicalPeriod?: string;
    level: "easier" | "standard" | "harder";
    language: string;
  };
  objectives: string[];
  taught: DigestTaught[];
  asked: DigestAsked[];
  misconceptions?: string[];
  terms: DigestTerm[];
};

const KEY_STAGES: Record<string, string> = {
  eyfs: "EYFS",
  ks1: "KS1",
  ks2: "KS2",
  ks3: "KS3",
  ks4: "KS4",
  post16: "KS5",
};

const MAX_OBJECTIVES = 4;
const ASKED_KINDS = new Set(["multiple-choice", "open-response", "exit-ticket"]);
const SKIPPED_KINDS = new Set(["title", "objectives"]);

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

function textOf(element: SlideElement): string {
  if (!("doc" in element) || !element.doc) return "";
  return oneLine(richDocToPlainText(element.doc as RichDoc));
}

/** The slide's text elements, groups walked, in drawing order. */
function textElements(slide: Slide): SlideElement[] {
  const out: SlideElement[] = [];
  walkElements(slide.elements, (e) => {
    if (e.type === "text") out.push(e);
  });
  return out;
}

const named = (els: readonly SlideElement[], names: readonly string[]) =>
  els.filter((e) => e.name !== undefined && names.includes(e.name));

function headingOf(slide: Slide): { text: string; element?: SlideElement } {
  const els = textElements(slide);
  const el =
    named(els, DIGEST_NAMES.heading).find((e) => textOf(e)) ??
    named(els, DIGEST_NAMES.headingFallback).find((e) => textOf(e));
  return { text: el ? textOf(el) : "", element: el };
}

/**
 * The bound input path's row key ("rows.2" for `<group>:rows.2.name`), so a name and its meaning
 * pair by row even when one is blank; undefined for an element outside a layout group.
 */
function rowKey(id: string): string | undefined {
  const m = /:([A-Za-z]+\.\d+)\.[A-Za-z]+$/.exec(id);
  return m?.[1];
}

/** Name and meaning pairs, by bound row when the ids carry one, else by order. */
function namedItemsOf(slide: Slide, used: Set<SlideElement>): DigestNamedItem[] {
  const els = textElements(slide);
  const out: DigestNamedItem[] = [];
  for (const pair of DIGEST_NAMES.pairs) {
    const names = els.filter((e) => e.name === pair.name);
    const meanings = els.filter((e) => e.name === pair.meaning);
    names.forEach((n, i) => {
      const key = rowKey(n.id);
      const m =
        (key && meanings.find((x) => rowKey(x.id) === key)) || (key ? undefined : meanings[i]);
      used.add(n);
      if (m) used.add(m);
      const name = textOf(n);
      const meaning = m ? textOf(m) : "";
      if (name && meaning) out.push({ name, meaning });
    });
    for (const m of meanings) used.add(m);
  }
  return out;
}

/** A worked example's rows ("Move: left = right") or a method example's steps, in order. */
function workedOf(slide: Slide, used: Set<SlideElement>): string[] {
  const els = textElements(slide);
  const rows: string[][] = [];
  for (const e of els) {
    if (e.name === DIGEST_NAMES.eqLeft) rows.push([textOf(e)]);
    else if (e.name === DIGEST_NAMES.eqSign || e.name === DIGEST_NAMES.eqRight) {
      if (rows.length === 0) rows.push([]);
      rows[rows.length - 1]?.push(textOf(e));
    } else continue;
    used.add(e);
  }
  const moves = els.filter((e) => e.name === DIGEST_NAMES.move);
  for (const m of moves) used.add(m);
  if (rows.length > 0) {
    return rows
      .map((r, i) => {
        const line = oneLine(r.join(" "));
        const move = moves[i] ? textOf(moves[i] as SlideElement).replace(/[.:]\s*$/, "") : "";
        return line && move ? `${move}: ${line}` : line;
      })
      .filter(Boolean);
  }
  if (slide.kind !== "worked-example") return [];
  const steps = els.filter((e) => e.name === DIGEST_NAMES.step);
  for (const s of steps) used.add(s);
  return steps.map(textOf).filter(Boolean);
}

function taughtOf(slide: Slide, n: number): DigestTaught | undefined {
  const heading = headingOf(slide);
  const used = new Set<SlideElement>(heading.element ? [heading.element] : []);
  const namedItems = namedItemsOf(slide, used);
  const worked = workedOf(slide, used);
  const lines = textElements(slide)
    .filter(
      (e) => !used.has(e) && !(DIGEST_NAMES.labels as readonly string[]).includes(e.name ?? ""),
    )
    .map(textOf)
    .filter(Boolean);
  const text = lines.join("\n");
  if (!heading.text && !text && namedItems.length === 0 && worked.length === 0) return undefined;
  return {
    slide: n,
    heading: heading.text,
    text,
    ...(namedItems.length ? { namedItems } : {}),
    ...(worked.length ? { worked } : {}),
  };
}

/**
 * A multiple-choice slide's options in order, each card's words paired with it: v5 cards are
 * `Option` shapes whose words sit in the `Option text` element of the same index
 * (`d-sN-Option-i` ↔ `d-sN-Option_text-i`); an older `option` element carries its own doc.
 */
function multipleChoiceOf(slide: Slide, n: number): DigestAsked | undefined {
  const q = slide.question;
  if (q?.type !== "multiple-choice") return undefined;
  const all: SlideElement[] = [];
  walkElements(slide.elements, (e) => all.push(e));
  const texts = all.filter((e) => e.type === "text" && e.name === DIGEST_NAMES.optionText);
  const options = q.options.map((o, i) => {
    const card = all.find((e) => e.id === o.id);
    if (card?.type === "option") return textOf(card);
    const twin = card?.id.replace(/Option-(\d+)$/, "Option_text-$1");
    const el = (twin && texts.find((e) => e.id === twin)) || texts[i];
    return el ? textOf(el) : "";
  });
  if (options.some((o) => !o)) return undefined;
  const correct = q.options.flatMap((o, i) => (o.correct ? [options[i] as string] : []));
  const question = headingOf(slide).text;
  if (!question || correct.length !== 1) return undefined;
  return { slide: n, kind: "mc", question, answer: correct[0] as string, options };
}

function answerText(item: AnswerItem): string {
  if ("tf" in item) return [item.tf ? "True" : "False", item.why].filter(Boolean).join(". ");
  return "a" in item ? item.a : item.s;
}

/**
 * A practice or exit slide's tasks with their answers: the answers by the Answers slides' own rule
 * (`answerGroupsOf`: numbered lines, `working[i]`, a blank or "…" answer skips the slide), each
 * paired with the task line of its number.
 */
function openItemsOf(slide: Slide, n: number): DigestAsked[] {
  const group = answerGroupsOf([slide])[0];
  if (!group) return [];
  const tasks = named(textElements(slide), DIGEST_NAMES.tasks).map(textOf).filter(Boolean);
  const kind: DigestAskedKind = group.kind === "exit" ? "exit" : "practice";
  return group.items.flatMap((item, i) => {
    const question = tasks[item.n - 1] ?? tasks[i];
    const answer = oneLine(answerText(item));
    if (!question || !answer) return [];
    const working = "work" in item && item.work ? oneLine(item.work) : undefined;
    return [{ slide: n, kind, question, answer, ...(working ? { working } : {}) }];
  });
}

/** The prose under the notes' "Misconceptions" heading, a paragraph per entry. */
export function misconceptionsOf(notes: string | undefined): string[] {
  if (!notes?.trim()) return [];
  const out: string[] = [];
  let inside = false;
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(oneLine(para.join(" ")));
    para = [];
  };
  for (const raw of notes.split("\n")) {
    const line = raw.trim();
    if ((NOTES_HEADINGS as readonly string[]).includes(line)) {
      flush();
      inside = line === "Misconceptions";
    } else if (!inside) continue;
    else if (!line) flush();
    else para.push(line);
  }
  flush();
  return out.filter(Boolean);
}

/** The objectives the slide shows, in order. */
function slideObjectives(slide: Slide): string[] {
  return named(textElements(slide), ["Item"]).map(textOf).filter(Boolean);
}

/**
 * Objectives: the lesson's facts, unless the teacher edited the objectives slide (or there are no
 * facts), then the slide's own words. At most four.
 */
function objectivesOf(lesson: Lesson): string[] {
  const slide = lesson.slides.find((s) => s.kind === "objectives" && !s.answersRole);
  const fromFacts = (lesson.facts?.objectives ?? []).map((o) => oneLine(o.text)).filter(Boolean);
  const fromSlide = slide ? slideObjectives(slide) : [];
  const pick =
    slide?.teacherEdited && fromSlide.length ? fromSlide : fromFacts.length ? fromFacts : fromSlide;
  return pick.slice(0, MAX_OBJECTIVES);
}

function lessonOf(lesson: Lesson): LessonDigest["lesson"] {
  const yearGroup = lesson.yearGroup?.trim() ?? "";
  const band = lesson.ageBand ?? deriveAgeBand(yearGroup);
  return {
    title: lesson.title,
    subject: lesson.subject?.trim() ?? "",
    yearGroup,
    keyStage: band ? (KEY_STAGES[band] ?? "") : "",
    readingLevel: lesson.readingLevel?.trim() || yearGroup,
    ...(lesson.historicalPeriod ? { historicalPeriod: lesson.historicalPeriod } : {}),
    level: lesson.brief?.level ?? "standard",
    language: lesson.language?.trim() || "en-GB",
  };
}

/** The lesson as its slides now stand, for the worksheet writer (plan v2 §1c). */
export function lessonDigest(lesson: Lesson): LessonDigest {
  const taught: DigestTaught[] = [];
  const asked: DigestAsked[] = [];
  const misconceptions: string[] = [];
  lesson.slides.forEach((slide, i) => {
    const n = i + 1;
    if (slide.answersRole) return;
    for (const m of misconceptionsOf(slide.notes))
      if (!misconceptions.includes(m)) misconceptions.push(m);
    if (SKIPPED_KINDS.has(slide.kind)) return;
    if (ASKED_KINDS.has(slide.kind) && slide.question) {
      const mc = multipleChoiceOf(slide, n);
      if (mc) asked.push(mc);
      else asked.push(...openItemsOf(slide, n));
      return;
    }
    const t = taughtOf(slide, n);
    if (t) taught.push(t);
  });
  const terms: DigestTerm[] = [];
  const seen = new Set<string>();
  for (const t of taught) {
    for (const item of t.namedItems ?? []) {
      const key = normaliseText(item.name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      terms.push({ term: item.name, meaning: item.meaning, slide: t.slide });
    }
  }
  return {
    lesson: lessonOf(lesson),
    objectives: objectivesOf(lesson),
    taught,
    asked,
    ...(misconceptions.length ? { misconceptions } : {}),
    terms,
  };
}

/** The launch sheet types (plan v2 §2) and Exam practice, the Years 10-11 Practice variant. */
export type DigestSheetType =
  | "practice"
  | "quick-quiz"
  | "key-words"
  | "exit-ticket"
  | "exam-style";

export type SheetAvailability = { type: DigestSheetType; available: boolean; reason?: string };

/** The fewest candidate terms a Key words sheet needs (§2c). */
export const KEY_WORDS_MIN_TERMS = 4;
/** The fewest exit-ticket items an Exit ticket sheet needs (§2d). */
export const EXIT_TICKET_MIN_ITEMS = 2;

export const UNAVAILABLE_REASONS = {
  "key-words": "This lesson doesn't have enough key words for a sheet",
  "exit-ticket": "This lesson has no exit ticket to put on a sheet.",
  taught: "This lesson doesn't have enough teaching on its slides for a sheet.",
} as const;

/** Lead verbs of a task done aloud, not on paper: dropped from Years 1-2 sheets (plan v2 §3b). */
export const SPOKEN_LEAD_VERBS = ["say", "tell", "point", "talk", "discuss", "show"] as const;

/** True when the task's first word is a spoken-task verb ("Tell your partner…", "Show me…"). */
export function isSpokenTask(text: string): boolean {
  const first = /^[^A-Za-z]*([A-Za-z]+)/.exec(text)?.[1]?.toLowerCase();
  return first !== undefined && (SPOKEN_LEAD_VERBS as readonly string[]).includes(first);
}

/** Years 1-2 (and anything younger the year group names): the spoken-task filter applies. */
export function isEarlyYears(yearGroup: string): boolean {
  const year = yearNumberOf(yearGroup);
  if (year !== undefined) return year <= 2;
  return /reception|eyfs|nursery/i.test(yearGroup);
}

/**
 * The exit-ticket items a sheet can carry: the exit slide's tasks with answers, minus spoken
 * tasks for Years 1-2. Drawing stays: it is written work (§2d).
 */
export function sheetExitItems(digest: LessonDigest): DigestAsked[] {
  const early = isEarlyYears(digest.lesson.yearGroup);
  return digest.asked.filter((a) => a.kind === "exit" && !(early && isSpokenTask(a.question)));
}

/**
 * Which sheet types this lesson can support, each with the reason it is greyed. Exam practice is
 * listed for Years 10-11 only; the pickers leave it out elsewhere.
 */
export function availableTypes(digest: LessonDigest): SheetAvailability[] {
  const taught = digest.taught.some((t) => t.text || t.namedItems?.length || t.worked?.length);
  const year = yearNumberOf(digest.lesson.yearGroup);
  // Counted after the Years 1-2 spoken-task filter, so a greyed reason matches what the sheet gets.
  const exits = sheetExitItems(digest).length;
  const entry = (type: DigestSheetType, ok: boolean, reason: string): SheetAvailability =>
    ok ? { type, available: true } : { type, available: false, reason };
  const out = [
    entry("practice", taught, UNAVAILABLE_REASONS.taught),
    entry("quick-quiz", taught, UNAVAILABLE_REASONS.taught),
    entry(
      "key-words",
      digest.terms.length >= KEY_WORDS_MIN_TERMS,
      UNAVAILABLE_REASONS["key-words"],
    ),
    entry("exit-ticket", exits >= EXIT_TICKET_MIN_ITEMS, UNAVAILABLE_REASONS["exit-ticket"]),
  ];
  if (year === 10 || year === 11) out.push(entry("exam-style", taught, UNAVAILABLE_REASONS.taught));
  return out;
}
