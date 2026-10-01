import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ContentCredit } from "@tj/domain/documents";

/*
 * Oak knowledge packs (spike/k1-oak, behind `OAK_PACKS=1`, default off). The brief's year gives the
 * key stage; Oak lessons are searched by the topic's title, then by its core term; the best one or
 * two give a short pack (keywords, key learning points, misconceptions and, for OGL lessons only,
 * text-only exit items) that the planner reads as reference material. No match in the key stage
 * falls back to the adjacent one, with key points and misconceptions only. No match, no pack.
 *
 * The source is a disk cache outside the repo (`OAK_CACHE_DIR`, default ~/.cache/dayback-oak),
 * filled by the lab's own fetch script; this code never calls Oak and never holds the key. A
 * missing cache entry reads as "nothing found". Cached Oak content is never committed.
 */

export const OAK_LICENCE_URL =
  "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/";

/** Whether packs are on: `OAK_PACKS=1` in the host's environment, nothing else. */
export function oakPacksOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.OAK_PACKS === "1";
}

export type KeyStage = "ks1" | "ks2" | "ks3" | "ks4";

/** Year 1–2 ks1, 3–6 ks2, 7–9 ks3, 10–11 ks4; anything else (Reception, sixth form) none. */
export function keyStageForYear(yearGroup: string | undefined): KeyStage | null {
  const m = /(\d{1,2})/.exec(yearGroup ?? "");
  const y = m ? Number(m[1]) : Number.NaN;
  if (y >= 1 && y <= 2) return "ks1";
  if (y >= 3 && y <= 6) return "ks2";
  if (y >= 7 && y <= 9) return "ks3";
  if (y >= 10 && y <= 11) return "ks4";
  return null;
}

/** The fallback key stage: the next one up, or ks3 for ks4. */
export function adjacentKeyStage(ks: KeyStage): KeyStage {
  return ({ ks1: "ks2", ks2: "ks3", ks3: "ks4", ks4: "ks3" } as const)[ks];
}

const SUBJECTS: readonly (readonly [RegExp, string])[] = [
  [/^(maths?|mathematics)$/, "maths"],
  [/^(science|biology|chemistry|physics)$/, "science"],
  [/^geography$/, "geography"],
  [/^history$/, "history"],
  [/^english( language| literature)?$/, "english"],
  [/^computing$/, "computing"],
  [/^(re|religious education|religious studies)$/, "religious-education"],
  [/^(pe|physical education)$/, "physical-education"],
  [/^(art|art and design)$/, "art"],
  [/^music$/, "music"],
  [/^citizenship$/, "citizenship"],
  [/^(dt|design and technology|design & technology)$/, "design-technology"],
  [/^(pshe|rshe|rshe-pshe)$/, "rshe-pshe"],
  [/^french$/, "french"],
  [/^spanish$/, "spanish"],
  [/^german$/, "german"],
];

/** The Oak subject slug for a brief's subject, or null when Oak has none. */
export function oakSubject(subject: string | undefined): string | null {
  const s = (subject ?? "").trim().toLowerCase();
  return SUBJECTS.find(([re]) => re.test(s))?.[1] ?? null;
}

const STOP = new Set(
  "a an and are as at be by for from how in into is it its of on or the their this to two what when where which who why with".split(
    " ",
  ),
);

/** A topic's content words, lower case, stop words and numbers dropped. */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

/** A crude stem for overlap: the first four letters ("solving" and "solve", "river" and "rivers"). */
const stem = (w: string) => w.slice(0, 4);

/**
 * The two search queries: the topic's title (the part before a colon, or the whole topic), then
 * its core term (the longest content word of the rest that the title query does not hold).
 */
export function oakQueries(topic: string): { title: string; core: string | null } {
  const [head = "", ...rest] = topic.split(":");
  const title = words(head).join(" ") || words(topic).slice(0, 3).join(" ");
  const inTitle = new Set(words(head).map(stem));
  const core =
    words(rest.join(" "))
      .filter((w) => !inTitle.has(stem(w)))
      .reduce<string | null>(
        (best, w) => (best === null || w.length > best.length ? w : best),
        null,
      ) ?? null;
  return { title, core };
}

/* The Oak shapes this module reads (open-api v0.11.2), as loose as the parse needs. */
export type OakSearchHit = { lessonSlug: string; lessonTitle: string; similarity: number };
type OakAnswer = { type?: string; content?: unknown; distractor?: boolean };
type OakQuestion = {
  question: string;
  questionType: string;
  questionImage?: unknown;
  answers?: unknown;
};
export type OakQuiz = { starterQuiz?: OakQuestion[]; exitQuiz?: OakQuestion[] };
export type OakSummary = {
  lessonTitle: string;
  canonicalUrl?: string;
  subjectSlug?: string;
  subjectTitle?: string;
  keyStageSlug?: string;
  year?: number | string;
  yearSlug?: string;
  lessonKeywords?: { keyword: string; description: string }[];
  keyLearningPoints?: { keyLearningPoint: string }[];
  misconceptionsAndCommonMistakes?: { misconception: string; response: string }[];
};

/** Where packs read Oak from; every method returns null (or []) on a miss. */
export type OakSource = {
  search(q: string, ks: KeyStage, subject: string): OakSearchHit[];
  summary(slug: string): OakSummary | null;
  quiz(slug: string): OakQuiz | null;
  /** "ogl-compatible" | "restricted"; null when never checked (read as restricted). */
  restricted(slug: string): string | null;
};

const readJson = (path: string): unknown => {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

/** The cache file for one search: `search/<ks>.<subject>.<query, dashed>.json`. */
export function searchCacheKey(q: string, ks: KeyStage, subject: string): string {
  const slug = q
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return join("search", `${ks}.${subject}.${slug}.json`);
}

/** The disk cache, keyed by lesson slug (`<slug>.summary.json`, `<slug>.quiz.json`). */
export function diskOakSource(
  dir: string = process.env.OAK_CACHE_DIR || join(homedir(), ".cache", "dayback-oak"),
): OakSource & { misses: string[] } {
  const misses: string[] = [];
  const at = (rel: string) => {
    const v = readJson(join(dir, rel));
    if (v === null) misses.push(rel);
    return v;
  };
  const statuses = () => (readJson(join(dir, "restricted.json")) ?? {}) as Record<string, string>;
  return {
    misses,
    search: (q, ks, subject) => {
      const v = at(searchCacheKey(q, ks, subject));
      return Array.isArray(v) ? (v as OakSearchHit[]) : [];
    },
    summary: (slug) => {
      const v = at(`${slug}.summary.json`) as OakSummary | null;
      return v && typeof v.lessonTitle === "string" ? v : null;
    },
    quiz: (slug) => {
      const v = at(`${slug}.quiz.json`) as OakQuiz | null;
      return v && Array.isArray(v.exitQuiz) ? v : null;
    },
    restricted: (slug) => statuses()[slug] ?? null,
  };
}

/** How a lesson was found: by the title query, by the core term, or in the adjacent key stage. */
export type OakMatchType = "title" | "core" | "adjacent-ks";

export type OakMatch = {
  slug: string;
  title: string;
  similarity: number;
  /** Content words of the topic its title shares. */
  overlap: number;
  match: OakMatchType;
  keyStage: KeyStage;
};

/** A hit is taken at similarity 0.15 or more; 0.10 to 0.15 only when its title shares a topic word. */
export const MIN_SIMILARITY = 0.15;
export const WEAK_SIMILARITY = 0.1;

/**
 * At most two Oak lessons for a brief, best first: hits from both queries in the brief's key stage,
 * ranked by the topic words their titles share and then by similarity, the second taken only when
 * it shares as many; none, the adjacent key stage the same way, marked `adjacent-ks`.
 */
export function matchOakLessons(
  brief: { topic: string; subject?: string; yearGroup?: string },
  source: OakSource,
  max = 2,
): OakMatch[] {
  const ks = keyStageForYear(brief.yearGroup);
  const subject = oakSubject(brief.subject);
  if (!ks || !subject) return [];
  const { title, core } = oakQueries(brief.topic);
  const topicStems = new Set(words(brief.topic).map(stem));
  const find = (stage: KeyStage, adjacent: boolean): OakMatch[] => {
    const best = new Map<string, OakMatch>();
    const queries: [string, OakMatchType][] = [[title, "title"]];
    if (core) queries.push([core, "core"]);
    for (const [q, kind] of queries) {
      if (!q) continue;
      for (const hit of source.search(q, stage, subject)) {
        const overlap = new Set(
          words(hit.lessonTitle)
            .map(stem)
            .filter((s) => topicStems.has(s)),
        ).size;
        const ok =
          hit.similarity >= MIN_SIMILARITY || (hit.similarity >= WEAK_SIMILARITY && overlap > 0);
        if (!ok) continue;
        const was = best.get(hit.lessonSlug);
        if (was && was.similarity >= hit.similarity) continue;
        best.set(hit.lessonSlug, {
          slug: hit.lessonSlug,
          title: hit.lessonTitle,
          similarity: hit.similarity,
          overlap,
          match: adjacent ? "adjacent-ks" : kind,
          keyStage: stage,
        });
      }
    }
    return [...best.values()].sort((a, b) => b.overlap - a.overlap || b.similarity - a.similarity);
  };
  const here = find(ks, false);
  const ranked = here.length > 0 ? here : find(adjacentKeyStage(ks), true);
  // A second lesson only when it is as close to the topic as the first (the same shared words).
  return ranked.filter((m) => m.overlap === ranked[0]?.overlap).slice(0, max);
}

export type OakExitItem = { q: string; right: string[]; wrong: string[] };

export type OakPackLesson = {
  slug: string;
  title: string;
  subject: string;
  keyStage: string;
  /** Oak's year for the lesson, when the cached summary carries one. */
  year?: number;
  match: OakMatchType;
  licence: "ogl" | "restricted";
  canonicalUrl?: string;
};

export type OakPack = {
  lessons: OakPackLesson[];
  keywords: { term: string; def: string }[];
  keyPoints: string[];
  misconceptions: { wrong: string; fix: string }[];
  exitItems: OakExitItem[];
};

/** The pack's caps, over its (at most two) lessons together, the first lesson's items first. */
export const PACK_CAPS = { keywords: 6, keyPoints: 5, misconceptions: 2, exitItems: 4 } as const;

const clean = (s: string) =>
  s
    .replace(/\{\{\}\}/g, "___")
    .replace(/\s+/g, " ")
    .trim();

/** A question that leans on a picture, or a form that is not text (match, order). */
const NEEDS_PICTURE = /\b(image|picture|photo|diagram|map|shown|below|above)\b/i;

/** Up to `max` text-only exit items: multiple choice with text answers, or short answer. */
export function textExitItems(quiz: OakQuiz | null, max: number = PACK_CAPS.exitItems) {
  const out: OakExitItem[] = [];
  for (const q of quiz?.exitQuiz ?? []) {
    if (out.length >= max) break;
    if (q.questionImage || NEEDS_PICTURE.test(q.question)) continue;
    if (q.questionType !== "multiple-choice" && q.questionType !== "short-answer") continue;
    const answers = Array.isArray(q.answers) ? (q.answers as OakAnswer[]) : [];
    if (
      answers.length === 0 ||
      answers.some((a) => a.type !== "text" || typeof a.content !== "string")
    )
      continue;
    const text = (a: OakAnswer) => clean(a.content as string);
    const dedupe = (xs: string[]) =>
      xs.filter((x, i) => xs.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i);
    const right = dedupe(answers.filter((a) => a.distractor !== true).map(text));
    const wrong = dedupe(answers.filter((a) => a.distractor === true).map(text));
    if (right.length === 0) continue;
    out.push({
      q: clean(q.question),
      right: q.questionType === "short-answer" ? right.slice(0, 1) : right,
      wrong,
    });
  }
  return out;
}

/**
 * The pack for a brief's matches. A restricted lesson (or one never checked) gives its summary
 * fields only; an adjacent-key-stage match gives key points and misconceptions only; exit items
 * come from OGL lessons in the brief's own key stage. Null when no lesson has a summary.
 */
export function buildOakPack(matches: readonly OakMatch[], source: OakSource): OakPack | null {
  const pack: OakPack = {
    lessons: [],
    keywords: [],
    keyPoints: [],
    misconceptions: [],
    exitItems: [],
  };
  const push = <T>(into: T[], cap: number, items: T[]) => {
    for (const x of items) if (into.length < cap) into.push(x);
  };
  for (const m of matches) {
    const s = source.summary(m.slug);
    if (!s) continue;
    const licence = source.restricted(m.slug) === "ogl-compatible" ? "ogl" : "restricted";
    const year = Number(s.year ?? /\d+/.exec(s.yearSlug ?? "")?.[0] ?? Number.NaN);
    pack.lessons.push({
      slug: m.slug,
      title: s.lessonTitle,
      subject: s.subjectTitle ?? s.subjectSlug ?? "",
      keyStage: s.keyStageSlug ?? m.keyStage,
      ...(Number.isInteger(year) ? { year } : {}),
      match: m.match,
      licence,
      ...(s.canonicalUrl ? { canonicalUrl: s.canonicalUrl } : {}),
    });
    const adjacent = m.match === "adjacent-ks";
    if (!adjacent)
      push(
        pack.keywords,
        PACK_CAPS.keywords,
        (s.lessonKeywords ?? []).map((k) => ({
          term: clean(k.keyword),
          def: clean(k.description),
        })),
      );
    push(
      pack.keyPoints,
      PACK_CAPS.keyPoints,
      (s.keyLearningPoints ?? []).map((k) => clean(k.keyLearningPoint)),
    );
    push(
      pack.misconceptions,
      PACK_CAPS.misconceptions,
      (s.misconceptionsAndCommonMistakes ?? []).map((x) => ({
        wrong: clean(x.misconception),
        fix: clean(x.response),
      })),
    );
    if (!adjacent && licence === "ogl")
      push(
        pack.exitItems,
        PACK_CAPS.exitItems,
        textExitItems(source.quiz(m.slug), PACK_CAPS.exitItems),
      );
  }
  return pack.lessons.length > 0 ? pack : null;
}

/** The planner's reference block (plan-lesson.v22): plain lines, no labels that match its output fields. */
export function renderOakPack(pack: OakPack, yearGroup?: string): string {
  const lines: string[] = ["Reference: published lessons on this topic, for you to draw on."];
  if (pack.lessons.every((l) => l.match === "adjacent-ks"))
    lines.push(
      `They are written for a different key stage from ${yearGroup ?? "this class"}: use only their points and the wrong ideas, pitched to this class.`,
    );
  for (const k of pack.keywords) lines.push(`- ${k.term}: ${k.def}`);
  for (const p of pack.keyPoints) lines.push(`- ${p}`);
  for (const m of pack.misconceptions)
    lines.push(`- Pupils may think: ${m.wrong} In fact: ${m.fix}`);
  if (pack.exitItems.length > 0) {
    lines.push("Questions these lessons end on:");
    for (const e of pack.exitItems) {
      const wrong = e.wrong.length > 0 ? ` Wrong: ${e.wrong.join("; ")}.` : "";
      lines.push(`- ${e.q} Right: ${e.right.join("; ")}.${wrong}`);
    }
  }
  lines.push(
    `Write every word yourself: never copy its sentences or questions. Each "Pupils may think" line is a wrong idea your teach slides correct.${pack.exitItems.length > 0 ? " Write your check, hinge and practise questions in the style of its questions (a wrong option is an answer a wrong idea gives), on your own cases and numbers." : ""}`,
  );
  return lines.join("\n");
}

/** The lesson's attribution, one per Oak lesson the pack used (API T&Cs s2; never shown on a slide). */
export function oakCredits(pack: OakPack): ContentCredit[] {
  return pack.lessons.map((l) => ({
    provider: "oak" as const,
    slug: l.slug,
    title: l.title,
    text: `A ${l.subject || "curriculum"} lesson by Oak National Academy licensed under Open Government Licence (OGL)`,
    licenceUrl: OAK_LICENCE_URL,
    ...(l.canonicalUrl ? { url: l.canonicalUrl } : {}),
  }));
}

/** A rough token count for the pack's prompt block (characters / 4). */
export const approxTokens = (text: string) => Math.ceil(text.length / 4);

/**
 * The pack for a lesson, when `OAK_PACKS=1` and a lesson matches: the planner's reference block and
 * the lesson's credits. Null otherwise.
 */
export function oakPackFor(
  lesson: { subject?: string; yearGroup?: string; brief?: { topic: string } },
  source: OakSource = diskOakSource(),
  env: Record<string, string | undefined> = process.env,
): { pack: OakPack; text: string; credits: ContentCredit[] } | null {
  if (!oakPacksOn(env) || !lesson.brief) return null;
  const brief = { topic: lesson.brief.topic, subject: lesson.subject, yearGroup: lesson.yearGroup };
  const pack = buildOakPack(matchOakLessons(brief, source), source);
  if (!pack) return null;
  return { pack, text: renderOakPack(pack, lesson.yearGroup), credits: oakCredits(pack) };
}
