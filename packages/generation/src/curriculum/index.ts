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

/** Names a teacher or brief may use for a subject, to the data's subject name. */
const SUBJECT_ALIASES: Readonly<Record<string, string>> = {
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
  "english language": "English",
  "english literature": "English",
};

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const SUBJECTS = new Map(CURRICULUM.map((s) => [norm(s.subject), s.subject]));

/** The data's subject name for `subject`, or undefined when the curriculum has no such subject. */
export function curriculumSubject(subject: string): string | undefined {
  const key = norm(subject);
  return SUBJECTS.get(key) ?? SUBJECTS.get(SUBJECT_ALIASES[key] ?? "") ?? undefined;
}

/** The year number in "Year 6", "Y6", "year 10" or "6"; undefined for Reception or none. */
export function curriculumYear(yearGroup: string): number | undefined {
  const m = /^\s*(?:y(?:ear)?\s*)?(\d{1,2})\s*$/i.exec(yearGroup);
  const n = m ? Number(m[1]) : Number.NaN;
  return n >= 1 && n <= 11 ? n : undefined;
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
  /** The data's subject name and the year looked up; undefined when there is no data. */
  subject?: string;
  year?: number;
  /** Every statutory statement for that year, the topic's matching domains first. */
  statements: CurriculumStatement[];
  /** The domain headings the topic matched, best first (empty without a topic or a match). */
  matchedDomains: string[];
};

/**
 * The statutory statements for one subject and year, all of them (code never narrows to the
 * topic: the model picks the unit). With a topic, the domains whose heading shares a keyword
 * with it come first, then the domains whose statements do, best first; the rest keep source
 * order. Deterministic: a keyword match, no model call.
 */
export function curriculumFor(q: CurriculumQuery): CurriculumLookup {
  const subject = norm(q.country) === "england" ? curriculumSubject(q.subject) : undefined;
  const year = curriculumYear(q.yearGroup);
  if (!subject || year === undefined) return { statements: [], matchedDomains: [] };
  const rows = CURRICULUM.filter(
    (s) => s.subject === subject && s.years[0] <= year && year <= s.years[1],
  );
  const groups = new Map<string, CurriculumStatement[]>();
  for (const s of rows) {
    const key = `${s.yearBand}\u0000${s.headings.join("\u0000")}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const topic = words(q.topic ?? "");
  const scored = [...groups.values()].map((g, order) => {
    const head = g[0] as CurriculumStatement;
    const heading = overlap(topic, words(head.domain));
    const text = overlap(topic, words(g.map((s) => s.text).join(" ")));
    return { g, order, domain: head.domain, score: heading * 100 + text };
  });
  const ranked = [...scored].sort((a, b) => b.score - a.score || a.order - b.order);
  return {
    subject,
    year,
    statements: ranked.flatMap((r) => r.g),
    matchedDomains: ranked.filter((r) => r.score > 0).map((r) => r.domain),
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
