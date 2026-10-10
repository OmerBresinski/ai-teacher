import { z } from "zod";
import artAndDesign from "./england/art-and-design.json" with { type: "json" };
import citizenship from "./england/citizenship.json" with { type: "json" };
import computing from "./england/computing.json" with { type: "json" };
import designAndTechnology from "./england/design-and-technology.json" with { type: "json" };
import english from "./england/english.json" with { type: "json" };
import geography from "./england/geography.json" with { type: "json" };
import history from "./england/history.json" with { type: "json" };
import languages from "./england/languages.json" with { type: "json" };
import mathematics from "./england/mathematics.json" with { type: "json" };
import music from "./england/music.json" with { type: "json" };
import physicalEducation from "./england/physical-education.json" with { type: "json" };
import science from "./england/science.json" with { type: "json" };

/**
 * The statutory National Curriculum in England (KS1–KS4 programmes of study, DfE, gov.uk),
 * verbatim, one row per "Pupils should be taught" statement. Contains public sector information
 * licensed under the Open Government Licence v3.0. Provenance is in each file's `_provenance`
 * and in `README.md` beside this file.
 */
export const CurriculumStatementSchema = z.strictObject({
  /** Stable, derived: `england.<subject>.<y6|y3-4>.<heading path slugs>.<n>`. */
  id: z.string().regex(/^england\.[a-z0-9-]+\.y\d{1,2}(-\d{1,2})?\.[a-z0-9/-]+\.\d+$/),
  country: z.literal("england"),
  subject: z.string().min(1),
  keyStage: z.string().regex(/^KS[1-4](-[1-4])?$/),
  /** First and last year the statement is taught in, e.g. [6, 6] or [7, 9]. */
  years: z.tuple([z.number().int().min(1).max(11), z.number().int().min(1).max(11)]),
  /** The programme-of-study heading the year band comes from, verbatim. */
  yearBand: z.string().min(1),
  /** The nearest domain/topic heading, verbatim (the year band heading when there is none). */
  domain: z.string().min(1),
  headings: z.array(z.string().min(1)).min(1),
  text: z.string().min(1),
  /** A sub-point's parent statement (a nested list item in the source). */
  parentId: z.string().optional(),
});
export type CurriculumStatement = z.infer<typeof CurriculumStatementSchema>;

export const CurriculumProvenanceSchema = z.strictObject({
  title: z.string().min(1),
  publisher: z.literal("Department for Education"),
  sourceUrl: z.string().startsWith("https://www.gov.uk/government/publications/"),
  sourceUpdated: z.string().min(1),
  retrieved: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  licence: z.string().includes("Open Government Licence v3.0"),
  attribution: z.string().includes("Open Government Licence v3.0"),
  scope: z.string().min(1),
});

export const CurriculumFileSchema = z.strictObject({
  _provenance: CurriculumProvenanceSchema,
  statements: z.array(CurriculumStatementSchema).min(1),
});
export type CurriculumFile = z.infer<typeof CurriculumFileSchema>;

/** The raw files, by subject slug (validated in `curriculum.test.ts`, not at load). */
export const CURRICULUM_FILES: Readonly<Record<string, unknown>> = {
  "art-and-design": artAndDesign,
  citizenship,
  computing,
  "design-and-technology": designAndTechnology,
  english,
  geography,
  history,
  languages,
  mathematics,
  music,
  "physical-education": physicalEducation,
  science,
};

/** Every statement, in source order, subject by subject. */
export const CURRICULUM: readonly CurriculumStatement[] = Object.values(CURRICULUM_FILES).flatMap(
  (f) => (f as CurriculumFile).statements,
);

/** Names a teacher or brief may use for a subject, to the data's subject name, normalised. */
export const SUBJECT_ALIASES: Readonly<Record<string, string>> = {
  maths: "mathematics",
  math: "mathematics",
  biology: "science",
  chemistry: "science",
  physics: "science",
  art: "art and design",
  dt: "design and technology",
  "d&t": "design and technology",
  "design technology": "design and technology",
  pe: "physical education",
  "p.e.": "physical education",
  mfl: "languages",
  "modern foreign languages": "languages",
  "foreign languages": "languages",
  french: "languages",
  spanish: "languages",
  german: "languages",
  "english language": "english",
  "english literature": "english",
};

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const SUBJECTS = new Map(CURRICULUM.map((s) => [norm(s.subject), s.subject]));

/** The data's subject name for `subject`, or undefined when the curriculum has no such subject. */
export function curriculumSubject(subject: string): string | undefined {
  const key = norm(subject);
  return SUBJECTS.get(key) ?? SUBJECTS.get(norm(SUBJECT_ALIASES[key] ?? "")) ?? undefined;
}

/** The years each key stage covers. */
const KEY_STAGE_YEARS: Readonly<Record<string, readonly [number, number]>> = {
  "1": [1, 2],
  "2": [3, 6],
  "3": [7, 9],
  "4": [10, 11],
};

/**
 * The first and last year in a year group: "Year 6", "Y6", "6" -> [6, 6]; "Years 5-6",
 * "Year 5/6", "Y5/6" -> [5, 6]; "KS2", "Key Stage 2" -> [3, 6]. Undefined for Reception, EYFS,
 * Nursery, anything outside years 1 to 11, or text it cannot read.
 */
export function curriculumYears(yearGroup: string): [number, number] | undefined {
  const g = norm(yearGroup);
  const ks = /^(?:ks|key stage)\s*([1-4])$/.exec(g);
  if (ks) {
    const r = KEY_STAGE_YEARS[ks[1] as string] as readonly [number, number];
    return [r[0], r[1]];
  }
  const m =
    /^(?:y(?:ears?|rs?)?\s*)?(\d{1,2})(?:\s*(?:-|\/|to|and|&|\u2013)\s*(?:y(?:ear)?\s*)?(\d{1,2}))?$/.exec(
      g,
    );
  if (!m) return undefined;
  const lo = Number(m[1]);
  const hi = m[2] === undefined ? lo : Number(m[2]);
  return lo >= 1 && hi <= 11 && lo <= hi ? [lo, hi] : undefined;
}

/** The year number of a single year group ("Year 6", "Y6", "6"); undefined for a range or none. */
export function curriculumYear(yearGroup: string): number | undefined {
  const r = curriculumYears(yearGroup);
  return r && r[0] === r[1] ? r[0] : undefined;
}

const STOP = new Set(
  "a an and the of in on to for with by from at as is are be how what why its their our into about using use lesson lessons year key stage ks".split(
    " ",
  ),
);
/** Lower-case content words, plural "s" dropped: the keyword match is exact on these. */
function words(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (STOP.has(w) || w.length < 2) continue;
    out.add(w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
  }
  return out;
}
const overlap = (a: Set<string>, b: Set<string>) => [...a].filter((w) => b.has(w)).length;

export type CurriculumQuery = {
  /** Only "england" has data; any other country returns nothing. */
  country: string;
  subject: string;
  /** "Year 6", "Y6", "6". */
  yearGroup: string;
  /** The lesson topic; orders the matching domains first. */
  topic?: string;
};

export type CurriculumLookup = {
  /** The data's subject name and the years looked up; undefined when there is no data. */
  subject?: string;
  years?: [number, number];
  /**
   * Without a topic, every statutory statement for those years, in source order. With one, the
   * matched domains' statements in full, best first, then at most `CURRICULUM_OTHER_CAP` others.
   */
  statements: CurriculumStatement[];
  /** The domain headings the topic matched, best first (empty without a topic or a match). */
  matchedDomains: string[];
};

/** With a topic, how many statements outside the matched domains still go to the prompt. */
export const CURRICULUM_OTHER_CAP = 8;
/** A domain matched only through a statement's text goes in whole when it has at most this many. */
export const CURRICULUM_WHOLE_DOMAIN_MAX = 12;

/**
 * The statutory statements for one subject and year group. Without a topic, all of them in
 * source order. With a topic, the domains whose heading shares a keyword with it come first, then
 * the domains whose statements do, best first, each in full; after them at most
 * `CURRICULUM_OTHER_CAP` statements from the other domains, in source order, so the objectives
 * prompt never gets a whole key stage's list. Deterministic: a keyword match, no model call.
 */
export function curriculumFor(q: CurriculumQuery): CurriculumLookup {
  const subject = norm(q.country) === "england" ? curriculumSubject(q.subject) : undefined;
  const years = curriculumYears(q.yearGroup);
  if (!subject || years === undefined) return { statements: [], matchedDomains: [] };
  const [lo, hi] = years;
  const rows = CURRICULUM.filter(
    (s) => s.subject === subject && s.years[0] <= hi && lo <= s.years[1],
  );
  const groups = new Map<string, CurriculumStatement[]>();
  for (const s of rows) {
    const key = `${s.yearBand}\u0000${s.headings.join("\u0000")}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const topic = words(q.topic ?? "");
  if (topic.size === 0) return { subject, years, statements: rows, matchedDomains: [] };
  // A domain whose heading shares a topic keyword goes in whole, best first. With none, the
  // domains holding a statement whose text shares one, best statement first: whole when the
  // domain is short, else only the matching statements (a KS4 domain can run to dozens of rows).
  const scored = [...groups.values()].map((g, order) => {
    const head = overlap(topic, words((g[0] as CurriculumStatement).domain));
    const hits = g.filter((s) => overlap(topic, words(s.text)) > 0);
    const best = Math.max(0, ...g.map((s) => overlap(topic, words(s.text))));
    return { g, order, head, hits, best };
  });
  const byOrder = (x: number, y: number, a: number, b: number) => y - x || a - b;
  const heads = scored.filter((r) => r.head > 0);
  const matched =
    heads.length > 0
      ? heads.sort((a, b) => byOrder(a.head, b.head, a.order, b.order)).map((r) => r.g)
      : scored
          .filter((r) => r.best > 0)
          .sort((a, b) => byOrder(a.best, b.best, a.order, b.order))
          .map((r) => (r.g.length <= CURRICULUM_WHOLE_DOMAIN_MAX ? r.g : r.hits));
  const picked = matched.flat();
  const ids = new Set(picked.map((s) => s.id));
  const others = rows.filter((s) => !ids.has(s.id)).slice(0, CURRICULUM_OTHER_CAP);
  return {
    subject,
    years,
    statements: [...picked, ...others],
    matchedDomains: [...new Set(picked.map((s) => s.domain))],
  };
}

/**
 * The objectives step's `{{curriculum}}` block: a heading line, then the statements grouped by
 * domain heading in the lookup's order. Empty when there is no data.
 */
export function curriculumBlock(lookup: CurriculumLookup, yearGroup: string): string {
  if (lookup.statements.length === 0) return "";
  const lines = [`Curriculum statements (statutory, ${yearGroup} ${lookup.subject}):`];
  let last = "";
  for (const s of lookup.statements) {
    const key = `${s.yearBand}\u0000${s.headings.join("\u0000")}`;
    if (key !== last) lines.push(s.headings.join(": "));
    last = key;
    lines.push(`${s.parentId ? "  " : ""}- ${s.text}`);
  }
  return lines.join("\n");
}
