import {
  type FactId,
  type LessonFacts,
  type RichDoc,
  richDocToPlainText,
  type Slide,
  walkElements,
} from "@tj/domain/documents";

/*
 * The exit ticket on the slides (ruling 141, opt-in) asks fresh questions, built in code with no
 * model call. Round O printed the worksheet recipe's fact questions, which the deck had already
 * asked word for word, and judges marked coherence down every time. So the closing items:
 *  - prefer lesson facts no in-lesson question used (starter, checks, hinge, practice);
 *  - reuse a fact only in another form and other words (a misconception becomes "explain why they
 *    are wrong", an objective's key ideas become "explain how", an asked question's short answer
 *    becomes "write a question with this answer");
 *  - cover every objective, one item each where the set has room;
 *  - drop anything too like an in-lesson question (`similarity` at or over `SIMILARITY_MAX`).
 */

export type FreshExitItem = {
  question: string;
  answer: string;
  /** Shorter answers to try, in order, when the full one does not fit the slide. */
  shorter: string[];
  /** Shorter wordings of the question, likewise. */
  shorterQuestions?: string[];
  objectiveRefs: FactId[];
  form: "fact-question" | "explain-objective" | "explain-misconception" | "answer-to-question";
  source: FactId;
  /** The highest similarity to any in-lesson question. */
  similarity: number;
};

/*
 * Similarity is the larger of two Jaccard scores: content-word sets (stop words dropped, plurals
 * folded) and character trigrams of the normalised text. Word sets catch reordered repeats;
 * trigrams catch light rewording ("melts" v "melting"). 0.5 means half of the two questions'
 * combined words are shared. A verbatim repeat scores 1, a stem wrapped in a short frame ("Explain
 * your answer: <stem>") 0.6 to 0.85, and distinct questions on the same topic about 0.1 to 0.35
 * (measured on the eight Round J lessons, Round P), so 0.5 sits between them.
 */
export const SIMILARITY_MAX = 0.5;

const STOP = new Set(
  (
    "a an the and or but of to in on at by for with from into as is are was were be been being it its " +
    "this that these those there their they them he she his her you your we our i what which who whom " +
    "why how when where does do did can could would should will may might one not no so than then " +
    "about each all any some more most less very just only also has have had if"
  ).split(" "),
);

const normalise = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const fold = (w: string) =>
  w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;

const words = (s: string) =>
  new Set(
    normalise(s)
      .split(" ")
      .map((w) => w.replace(/'s$|'/g, ""))
      .filter((w) => w && !STOP.has(w))
      .map(fold),
  );

const trigrams = (s: string) => {
  const t = ` ${normalise(s)} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= t.length; i++) out.add(t.slice(i, i + 3));
  return out;
};

const jaccard = (a: Set<string>, b: Set<string>) => {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared += 1;
  return shared / (a.size + b.size - shared);
};

/** How alike two questions are, 0 to 1. */
export const similarity = (a: string, b: string) =>
  Math.max(jaccard(words(a), words(b)), jaccard(trigrams(a), trigrams(b)));

const maxSimilarity = (q: string, asked: readonly string[]) =>
  asked.reduce((m, a) => Math.max(m, similarity(q, a)), 0);

/** Slide kinds that teach or frame rather than ask. A content slide asks when it is tagged. */
const NOT_ASKING = new Set(["title", "objectives", "plenary"]);
const LABELS = new Set(["Heading", "Kind tag", "Row badge", "Row reveal"]);

/**
 * The questions the lesson asks before its close: every text on the starter, check, hinge,
 * question and worked-example slides and on tagged practice slides, one per element, without
 * headings, tags or revealed answers.
 */
export function inLessonQuestions(slides: readonly Slide[]): string[] {
  const out: string[] = [];
  for (const slide of slides) {
    if (NOT_ASKING.has(slide.kind)) continue;
    let tagged = false;
    walkElements(slide.elements, (e) => {
      if (e.name === "Kind tag") tagged = true;
    });
    if (slide.kind === "content" && !tagged) continue;
    walkElements(slide.elements, (e) => {
      if (e.type !== "text" || (e.name && LABELS.has(e.name)) || !("doc" in e) || !e.doc) return;
      const text = richDocToPlainText(e.doc as RichDoc).trim();
      if (words(text).size >= 2) out.push(text);
    });
  }
  return out;
}

/** The fact ids the lesson's asking slides were planned from (its outline's factRefs). */
function askedFactIds(facts: LessonFacts): Set<FactId> {
  const out = new Set<FactId>();
  for (const entry of facts.outline) {
    if (entry.kind === "title" || entry.kind === "objectives") continue;
    if (entry.kind === "content" || entry.kind === "worked-example") continue;
    for (const ref of entry.factRefs) out.add(ref);
  }
  return out;
}

const sentence = (s: string) => {
  const t = s.trim().replace(/\s+/g, " ");
  return t ? t[0]?.toUpperCase() + t.slice(1) : t;
};
const lowerFirst = (s: string) => (s ? (s[0]?.toLowerCase() ?? "") + s.slice(1) : s);
const stop = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);
const firstClause = (s: string) => s.split(/[;:]|,\s(?:so|but|while|and)\s|\s—\s/)[0]?.trim() ?? s;

/** "X. In fact, Y." / "Wrong idea: X. Correct idea: Y." / belief + correction. */
function misconceptionParts(m: {
  belief: string;
  correction: string;
}): { wrong: string; right: string } | undefined {
  const b = m.belief.trim();
  const labelled = /^wrong idea:\s*(.+?)\s*correct idea:\s*(.+)$/is.exec(b);
  if (labelled?.[1] && labelled[2]) return { wrong: labelled[1].trim(), right: labelled[2].trim() };
  const inFact = /^(.+?[.!?])\s*in fact,?\s*(.+)$/is.exec(b);
  if (inFact?.[1] && inFact[2]) return { wrong: inFact[1].trim(), right: inFact[2].trim() };
  if (m.correction.trim()) return { wrong: b, right: m.correction.trim() };
  // "Wrong sentence. Right sentence(s)." with no label: the first sentence is the belief.
  const split = /^(.+?[.!?])\s+(\p{Lu}.+)$/su.exec(b);
  if (split?.[1] && split[2]) return { wrong: split[1].trim(), right: split[2].trim() };
  return undefined;
}

const EXPLAIN_VERBS = /^(explain|describe|assess|evaluate|compare|justify)\b/i;
const isPractice = (statement: string) => /^your turn\b/i.test(statement.trim());

/** Every candidate item, before the similarity check and selection. */
function candidates(facts: LessonFacts): Omit<FreshExitItem, "similarity">[] {
  const out: Omit<FreshExitItem, "similarity">[] = [];
  const asked = askedFactIds(facts);

  // Fact questions no asking slide was planned from: fresh as they stand.
  for (const q of facts.questions) {
    if (asked.has(q.id) || !q.stem.trim() || !q.answer.trim()) continue;
    out.push({
      question: q.stem.trim(),
      answer: q.answer.trim(),
      shorter: [],
      objectiveRefs: q.objectiveRefs ?? [],
      form: "fact-question",
      source: q.id,
    });
  }

  // An objective asked as "explain how", answered by its key ideas.
  for (const o of facts.objectives) {
    const ideas = (facts.keyIdeas ?? []).filter(
      (k) => k.objectiveRefs.includes(o.id) && !isPractice(k.statement) && k.statement.trim(),
    );
    if (ideas.length === 0) continue;
    const ask = (g: string) =>
      EXPLAIN_VERBS.test(g) ? `${g}.` : `Explain how to ${lowerFirst(g)}.`;
    const goal = o.text.trim().replace(/[.!?]+$/, "");
    const core =
      goal.split(/,\s*including\b|\s(?:using|with|through|by|including)\s/)[0]?.trim() ?? goal;
    const question = ask(goal);
    const answers = ideas.map((_, i) =>
      stop(
        sentence(
          ideas
            .slice(0, ideas.length - i)
            .map((k, j) => (j === 0 ? k.statement.trim() : lowerFirst(k.statement.trim())))
            .join("; "),
        ),
      ),
    );
    out.push({
      question,
      answer: answers[0] ?? "",
      shorter: answers.slice(1),
      shorterQuestions: core !== goal && core.split(/\s+/).length >= 4 ? [ask(core)] : [],
      objectiveRefs: [o.id],
      form: "explain-objective",
      source: o.id,
    });
  }

  // A misconception put in a classmate's mouth: explain why they are wrong.
  for (const m of facts.misconceptions) {
    const parts = misconceptionParts(m);
    if (!parts) continue;
    const right = stop(sentence(parts.right));
    const short = stop(sentence(firstClause(parts.right)));
    out.push({
      question: `A classmate says: “${stop(sentence(parts.wrong)).replace(/\.$/, "")}.” Explain why they are wrong.`,
      answer: right,
      shorter: short !== right ? [short] : [],
      objectiveRefs: m.objectiveRefs ?? [],
      form: "explain-misconception",
      source: m.id,
    });
  }

  // An asked question with a short answer, turned round: pupils write a question for that answer.
  for (const q of facts.questions) {
    const a = q.answer.trim();
    if (!asked.has(q.id) || !a || a.split(/\s+/).length > 5) continue;
    out.push({
      question: `Write a new question from today's lesson whose answer is “${a.replace(/[.]$/, "")}”.`,
      answer: `For example: ${q.stem.trim()}`,
      shorter: [],
      objectiveRefs: q.objectiveRefs ?? [],
      form: "answer-to-question",
      source: q.id,
    });
  }
  return out;
}

const COVER_ORDER: FreshExitItem["form"][] = [
  "fact-question",
  "explain-objective",
  "explain-misconception",
  "answer-to-question",
];
const FILL_ORDER: FreshExitItem["form"][] = [
  "explain-misconception",
  "fact-question",
  "answer-to-question",
  "explain-objective",
];
const rank = (order: FreshExitItem["form"][]) => (a: FreshExitItem, b: FreshExitItem) =>
  order.indexOf(a.form) - order.indexOf(b.form) || a.similarity - b.similarity;

export type FreshExitOptions = {
  /** The most items to pick (the set's maximum). */
  max: number;
  /** Whether the items picked so far plus this one still fit the slide. */
  fits?: (items: readonly { question: string; answer: string }[]) => boolean;
  threshold?: number;
};

/**
 * The closing exit items: fresh questions in code, none too like an in-lesson question, every
 * objective covered while the set has room. Each item is tried with its full answer and then its
 * shorter answers until the set fits.
 */
export function freshExitItems(
  facts: LessonFacts,
  slides: readonly Slide[],
  { max, fits = () => true, threshold = SIMILARITY_MAX }: FreshExitOptions,
): FreshExitItem[] {
  const asked = inLessonQuestions(slides);
  const fresh = candidates(facts).flatMap((c) => {
    // Every wording is checked against the lesson's questions; one too like them is dropped.
    const questions = [c.question, ...(c.shorterQuestions ?? [])]
      .map((q) => ({ q, sim: maxSimilarity(q, asked) }))
      .filter((x) => x.sim < threshold);
    const first = questions[0];
    if (!first) return [];
    return [
      {
        ...c,
        question: first.q,
        shorterQuestions: questions.slice(1).map((x) => x.q),
        similarity: Math.max(...questions.map((x) => x.sim)),
      },
    ];
  });
  // The fullest wordings first; when that leaves an objective out, the shortest first.
  const full = select(fresh, facts, max, fits, threshold, false);
  if (covered(full, facts) === facts.objectives.length) return full;
  const short = select(fresh, facts, max, fits, threshold, true);
  return covered(short, facts) > covered(full, facts) ? short : full;
}

const covered = (items: readonly FreshExitItem[], facts: LessonFacts) =>
  facts.objectives.filter((o) => items.some((i) => i.objectiveRefs.includes(o.id))).length;

const variants = (c: FreshExitItem, shortestFirst: boolean) => {
  const qs = [c.question, ...(c.shorterQuestions ?? [])];
  const as = [c.answer, ...c.shorter];
  const out = qs.flatMap((question) => as.map((answer) => ({ question, answer })));
  return shortestFirst ? out.reverse() : out;
};

function select(
  fresh: readonly FreshExitItem[],
  facts: LessonFacts,
  max: number,
  fits: NonNullable<FreshExitOptions["fits"]>,
  threshold: number,
  shortestFirst: boolean,
): FreshExitItem[] {
  const pool = [...fresh];
  const picked: FreshExitItem[] = [];
  const tryAdd = (c: FreshExitItem): boolean => {
    if (picked.length >= max) return false;
    if (
      picked.some((p) => p.source === c.source || similarity(p.question, c.question) >= threshold)
    )
      return false;
    for (const v of variants(c, shortestFirst)) {
      if (picked.some((p) => normalise(p.answer) === normalise(v.answer))) continue;
      const item = { ...c, ...v };
      if (fits([...picked, item])) {
        picked.push(item);
        pool.splice(pool.indexOf(c), 1);
        return true;
      }
    }
    return false;
  };

  for (const o of facts.objectives) {
    if (picked.some((p) => p.objectiveRefs.includes(o.id))) continue;
    for (const c of pool.filter((x) => x.objectiveRefs.includes(o.id)).sort(rank(COVER_ORDER))) {
      if (tryAdd(c)) break;
    }
  }
  for (const c of [...pool].sort(rank(FILL_ORDER))) tryAdd(c);
  return picked;
}
