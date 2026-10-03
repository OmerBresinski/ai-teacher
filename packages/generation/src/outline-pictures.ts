import type { FigureBrief, FigureTemplateName, ImageBrief } from "@tj/domain/documents";

/*
 * Picture slides for the objectives-first outline (TEACH-163, stopgap until plan-write is the
 * default planner, TEACH-238). Pure code over the facts the per-objective calls already return,
 * no model call and no prompt change: a key idea whose text names a concrete thing ("A puppy has
 * fur, four legs and a tail") becomes a photograph brief; one whose text is about a structure a
 * shipped Figure template draws becomes a diagram brief. Anything else gets no picture: a missing
 * picture beats a wrong one. How many slides get one is the lesson's visuality (`visualityFor`).
 */

type IdeaText = { statement: string; explanation: string; example: string };

/** Head nouns that name an idea, a person's role or a text, not a thing a camera captures. */
const ABSTRACT = new Set(
  (
    "word words sentence sentences paragraph text texts writer writers reader readers author speaker " +
    "audience argument arguments idea ideas question questions answer answers number numbers " +
    "equation equations fraction fractions ratio ratios value values rule rules method methods " +
    "process processes reason reasons way ways example examples point points technique techniques " +
    "device devices language letter letters verb verbs noun nouns adjective adjectives adverb clause " +
    "clauses phrase phrases tense pupil pupils student students teacher teachers person people " +
    "change changes difference differences amount type types kind kinds part parts feature features " +
    "property properties energy force forces reaction reactions result results fact facts opinion " +
    "opinions claim claims statement statements evidence source sources line lines poem poems story " +
    "stories character characters theme themes structure list lists pattern patterns term terms " +
    "name names group groups thing things " +
    // Too small or invisible for a camera: a stock photograph of these is never the thing.
    "atom atoms electron electrons ion ions molecule molecules proton protons neutron neutrons " +
    "particle particles nucleus charge charges current electricity gene genes compound compounds " +
    "element elements substance substances product products heat temperature supply"
  ).split(" "),
);

/** Verbs that end the subject of a sentence opening "A …" / "The …". */
const VERB =
  "is|are|was|were|has|have|had|can|could|will|would|does|do|did|may|might|must|lives?|grows?|eats?|lays?|uses?|looks?|shows?|stands?|carries|carry|contains?|makes?|helps?|needs?|turns?|becomes?|changes?|moves?|hatches|hatch|feeds?|keeps?|gives?|flows?";
const LEADING_SUBJECT = new RegExp(
  `^(?:An?|The)\\s+([a-z][a-z-]*(?:\\s[a-z][a-z-]*){0,2}?)\\s+(?:${VERB})\\b`,
);
/** "… has fur, four legs and a tail": the visible features a photograph should show. */
const FEATURE_LIST = /\b(?:has|have|with)\s+([^.;:]+)/;

function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isConcrete(phrase: string): boolean {
  const words = phrase.toLowerCase().split(/\s+/);
  const head = words[words.length - 1] ?? "";
  return words.length > 0 && !ABSTRACT.has(head) && !words.some((w) => ABSTRACT.has(w));
}

/** The concrete thing a key idea is about, from the first sentence that opens with one. */
function subjectOf(idea: IdeaText): string | undefined {
  for (const text of [idea.example, idea.statement, idea.explanation]) {
    for (const sentence of sentencesOf(text)) {
      const subject = LEADING_SUBJECT.exec(sentence)?.[1];
      if (subject && subject.length <= 60 && isConcrete(subject)) return subject;
    }
  }
  return undefined;
}

function mustShowOf(idea: IdeaText, subject: string): string[] {
  const head = subject.split(/\s+/).pop() ?? subject;
  for (const text of [idea.example, idea.explanation, idea.statement]) {
    const list = FEATURE_LIST.exec(text)?.[1];
    if (!list) continue;
    const items = list
      .split(/,\s*|\s+and\s+/)
      .map((s) => s.replace(/^(?:an?|the|some|its|their|both)\s+/i, "").trim())
      .filter(
        (s) =>
          s.length > 0 &&
          s.length <= 40 &&
          s.split(/\s+/).length <= 4 &&
          s.toLowerCase() !== head.toLowerCase() &&
          isConcrete(s),
      );
    if (items.length > 0) return items.slice(0, 3);
  }
  return [];
}

/**
 * A photograph brief for a key idea that names a concrete thing and the features a pupil can see
 * on it; `undefined` otherwise. Both are required: a thing the facts describe by its visible parts
 * is one a stock library photographs, and a brief without them landed empty in the TEACH-163 runs
 * ("power supply", "electron").
 */
export function photoBriefFor(idea: IdeaText): ImageBrief | undefined {
  const subject = subjectOf(idea);
  if (!subject) return undefined;
  const mustShow = mustShowOf(idea, subject);
  if (mustShow.length === 0) return undefined;
  return { subject, mustShow, purpose: "observe" };
}

/** Which shipped Figure template draws what a key idea is about. */
const FIGURE_MATCHERS: { template: FigureTemplateName; test: RegExp }[] = [
  {
    template: "right-triangle",
    test: /pythagoras|hypotenuse|right[- ]angled triangle|trigonometr|soh\s?cah\s?toa/i,
  },
  {
    template: "energy-profile",
    test: /activation energy|reaction profile|energy profile|exothermic|endothermic/i,
  },
  {
    template: "triangle",
    test: /angles? in a triangle|interior angles? of a triangle|isosceles|equilateral|scalene|area of a triangle/i,
  },
];

/** A diagram brief when a shipped Figure template draws the key idea; `undefined` otherwise. */
export function figureBriefFor(idea: IdeaText): FigureBrief | undefined {
  const text = `${idea.statement} ${idea.explanation} ${idea.example}`;
  const match = FIGURE_MATCHERS.find((m) => m.test.test(text));
  if (!match) return undefined;
  const purpose = idea.statement.replace(/\s+/g, " ").trim().slice(0, 160);
  return purpose ? { template: match.template, purpose } : undefined;
}
