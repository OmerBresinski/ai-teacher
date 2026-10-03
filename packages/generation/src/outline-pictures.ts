import type { FigureBrief, FigureTemplateName, ImageBrief } from "@tj/domain/documents";
import type { KeyIdeaPicture } from "./prompts/plan-teach-objective";

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
    test: /activation energy|reaction profile|energy profile|energy level|exothermic|endothermic|energy change/i,
  },
  {
    template: "triangle",
    test: /\btriangles?\b|isosceles|equilateral|scalene/i,
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

/** Subjects a template's drawing belongs to; a lesson with another named subject never gets it. */
const TEMPLATE_SUBJECTS: Record<FigureTemplateName, RegExp> = {
  "right-triangle": /math/i,
  triangle: /math/i,
  "energy-profile": /science|chemistry|physics/i,
};

function clipTo(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).replace(/[\s,;:.]+$/, "")}…`;
}

/**
 * The declared subject as a stock-photo query (TEACH-163 round 3: "Photograph of Philipp
 * Scheidemann proclaiming the republic…" and "A duckling beside an adult duck" found nothing):
 * no leading article or "photo of", and only the head before a scene clause or a dash.
 */
export function searchSubject(subject: string): string {
  let s = subject.replace(/\s+/g, " ").trim();
  s = s.replace(/^(?:an?|the)\s+/i, "");
  s = s.replace(
    /^(?:(?:a|an|the)\s+)?(?:photo(?:graph)?s?|pictures?|images?)\s+(?:of|showing)\s+/i,
    "",
  );
  s = s.replace(/^(?:an?|the)\s+/i, "");
  const cut = s.search(
    /\s(?:beside|next to|during|while|with|showing|in front of|proclaiming|holding|at the|on a|in a)\s|\s[–—-]\s|[,;:(…]/i,
  );
  const head = (cut > 0 ? s.slice(0, cut) : s).trim();
  return head.length > 0 ? head : subject.trim();
}

export type IdeaPicture =
  | { kind: "photo"; brief: ImageBrief }
  | { kind: "diagram"; brief: FigureBrief }
  | { kind: "none" };

/**
 * The picture a key idea declared (`plan-teach-objective` v5), checked in code: a diagram's
 * template must fit the lesson (its subject, when the lesson names one, and the idea's own words,
 * the same matchers the text path uses), otherwise the idea gets none; "none" is never overridden.
 * `undefined` when the idea declared nothing (facts written before v5): the caller falls back to
 * the text heuristics above.
 */
export function declaredPicture(
  idea: IdeaText & { picture?: KeyIdeaPicture | undefined },
  subject?: string,
): IdeaPicture | undefined {
  const picture = idea.picture;
  if (!picture) return undefined;
  if (picture.kind === "photo") {
    const mustShow = picture.notice.map((n) => clipTo(n, 120)).slice(0, 4);
    return {
      kind: "photo",
      brief: { subject: clipTo(searchSubject(picture.subject), 60), mustShow, purpose: "observe" },
    };
  }
  if (picture.kind === "diagram") {
    const named = subject?.trim() ?? "";
    const subjectFits = named === "" || TEMPLATE_SUBJECTS[picture.template].test(named);
    // The idea's own words, not `shows`: the model wrote both, and only the first is the content.
    const text = `${idea.statement} ${idea.explanation} ${idea.example}`;
    const textFits = FIGURE_MATCHERS.some(
      (m) => m.template === picture.template && m.test.test(text),
    );
    if (!subjectFits || !textFits) return { kind: "none" };
    return {
      kind: "diagram",
      brief: { template: picture.template, purpose: clipTo(picture.shows, 160) },
    };
  }
  return { kind: "none" };
}
