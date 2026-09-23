#!/usr/bin/env bun
// Oak import (quality plan W7 arm O, W3a/e): Oak National Academy lessons become a pack, with no
// model and no rewriting. Three commands, all lookups over the local Oak sqlite (OGL v3.0):
//
//   bun packages/generation/eval/packs/oak-import.ts candidates --subject History --year 4
//     [--search Roman --search Britain]
//       Lessons in that exact subject and year group whose lesson or unit title contains any
//       search term. Prints them; it never picks. The caller reads the list and chooses slugs.
//
//   bun packages/generation/eval/packs/oak-import.ts import --topic romans --subject History
//     --year 4 --outcome "Explain why the Romans invaded Britain" --lessons slug-a,slug-b
//     [--outcome "…" --lessons …] [--out path]
//       One section per --outcome, paired in order with the --lessons that follow it. Key
//       learning points → keyIdeas, misconceptions → misconceptions, keywords → vocabulary.
//
//   bun packages/generation/eval/packs/oak-import.ts keyword --term turgor --key-stage 3
//     [--subject Biology]
//       W3e: does the term appear among Oak's keywords for that key stage (exact, or as a whole
//       word inside a longer keyword). A structural cross-check; it says nothing about pitch.
//
// Common flag: --db <path> (default scratchpad/data/oak/oak-curriculum.sqlite, outside the repo).

import { Database } from "bun:sqlite";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  type Evidence,
  type Pack,
  PackSchema,
  type PackSection,
  type PackSource,
  type Sentence,
  SNIPPET_MAX_WORDS,
} from "./schema";

/** Beside the source cache (`sources.ts`): `scratchpad/data/oak/`, outside the repo. */
export const DEFAULT_OAK_DB = join(
  import.meta.dir,
  "../../../../..",
  "data",
  "oak",
  "oak-curriculum.sqlite",
);
export const OAK_LICENCE_URL =
  "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/";
const OAK_LESSON_WEB = "https://www.thenational.academy/teachers/lessons/";

/** Oak text carries hard line wraps; runs of whitespace become one space and nothing else changes. */
export const clean = (text: string): string => text.replace(/\s+/g, " ").trim();

/** The first `SNIPPET_MAX_WORDS` words of a text, verbatim (after `clean`). */
export const snippetOf = (text: string): string =>
  clean(text).split(" ").slice(0, SNIPPET_MAX_WORDS).join(" ");

/** "Year 4", "Y4", "4" → 4. */
export function parseYear(input: string): number {
  const m = /^(?:year\s*|y)?(\d{1,2})$/i.exec(input.trim());
  if (!m) throw new Error(`not a year group: ${input}`);
  return Number(m[1]);
}

/** Oak year-group uris end `year-group-4` or, for mixed classes, `year-group-3-4`. */
export function yearGroupCovers(uri: string, year: number): boolean {
  const m = /year-group-(\d+)(?:-(\d+))?$/.exec(uri);
  if (!m) return false;
  const lo = Number(m[1]);
  const hi = m[2] === undefined ? lo : Number(m[2]);
  return year >= lo && year <= hi;
}

/** "3", "KS3", "Key Stage 3" → 3. */
export function parseKeyStage(input: string): number {
  const m = /^(?:key\s*stage\s*|ks)?(\d)$/i.exec(input.trim());
  if (!m) throw new Error(`not a key stage: ${input}`);
  return Number(m[1]);
}

export const openOak = (path = DEFAULT_OAK_DB): Database => {
  if (!existsSync(path)) throw new Error(`Oak sqlite not found: ${path}`);
  return new Database(path, { readonly: true });
};

/* ----------------------------------------------------------------------------------------- */
/* Candidates: a lookup, never a relevance decision.                                          */
/* ----------------------------------------------------------------------------------------- */

export interface Candidate {
  slug: string;
  title: string;
  uri: string;
  units: string[];
  keyStage: string;
  yearGroups: string[];
  /**
   * "year": a programme for the requested year includes the lesson. "key-stage": Oak gives the
   * lesson's unit no year group (some KS4 option units), but its key stage contains the year.
   */
  match: "year" | "key-stage";
  keyLearningPoints: number;
  misconceptions: number;
  keywords: number;
}

interface PlacementRow {
  slug: string;
  title: string;
  uri: string;
  unit: string;
  keyStage: string;
  ygUri: string | null;
  ygName: string | null;
  position: number;
}

const PLACEMENT_SQL = `
  SELECT l.slug AS slug, l.name AS title, l.uri AS uri, u.name AS unit, ks.name AS keyStage,
         yg.uri AS ygUri, yg.name AS ygName, li.sequence_position AS position
  FROM lesson l
  JOIN lesson_inclusion li ON li.lesson_id = l.id
  JOIN unit_variant uv ON uv.id = li.unit_variant_id
  JOIN unit u ON u.id = uv.unit_id
  JOIN scheme sc ON sc.id = u.scheme_id
  JOIN subject su ON su.id = sc.subject_id
  JOIN key_stage ks ON ks.id = sc.key_stage_id
  LEFT JOIN unit_variant_inclusion uvi ON uvi.unit_variant_id = uv.id
  LEFT JOIN programme p ON p.id = uvi.programme_id
  LEFT JOIN year_group yg ON yg.id = p.year_group_id`;

const count = (db: Database, table: string, lessonId: number): number =>
  (
    db.query(`SELECT count(*) AS n FROM ${table} WHERE lesson_id = ?`).get(lessonId) as {
      n: number;
    }
  ).n;

/** The key stage Oak files a single year group under, e.g. 10 → "Key Stage 4". */
function keyStageOfYear(db: Database, year: number): string | null {
  const row = db
    .query(
      `SELECT ks.name AS name FROM year_group yg JOIN key_stage ks ON ks.id = yg.key_stage_id
       WHERE yg.uri LIKE ?`,
    )
    .get(`%/year-group-${year}`) as { name: string } | null;
  return row?.name ?? null;
}

/**
 * Lessons whose subject name equals `subject` (case-insensitive), that sit in a programme for
 * `year` (or have no year group at all in a key stage that contains `year`), and whose lesson or unit title contains any of `terms` (case-insensitive substring; no
 * terms = every lesson of that subject and year). Ordered by unit, then position in the unit.
 */
export function findCandidates(
  db: Database,
  query: { subject: string; year: number; terms?: string[] },
): Candidate[] {
  const rows = db
    .query(`${PLACEMENT_SQL} WHERE lower(su.name) = lower(?) ORDER BY u.name, li.sequence_position`)
    .all(query.subject) as PlacementRow[];
  const terms = (query.terms ?? []).map((t) => t.toLowerCase()).filter(Boolean);
  const ksOfYear = keyStageOfYear(db, query.year);
  const bySlug = new Map<
    string,
    Omit<Candidate, "match"> & { inYear: boolean; anyYear: boolean; hit: boolean }
  >();
  for (const r of rows) {
    const c = bySlug.get(r.slug) ?? {
      slug: r.slug,
      title: r.title,
      uri: r.uri,
      units: [],
      keyStage: r.keyStage,
      yearGroups: [],
      keyLearningPoints: 0,
      misconceptions: 0,
      keywords: 0,
      inYear: false,
      anyYear: false,
      hit: terms.length === 0,
    };
    if (!c.units.includes(r.unit)) c.units.push(r.unit);
    if (r.ygName && !c.yearGroups.includes(r.ygName)) c.yearGroups.push(r.ygName);
    if (r.ygUri) c.anyYear = true;
    if (r.ygUri && yearGroupCovers(r.ygUri, query.year)) c.inYear = true;
    const hay = `${r.title}\n${r.unit}`.toLowerCase();
    if (terms.some((t) => hay.includes(t))) c.hit = true;
    bySlug.set(r.slug, c);
  }
  const out: Candidate[] = [];
  for (const { inYear, anyYear, hit, ...c } of bySlug.values()) {
    const ksOnly = !anyYear && ksOfYear !== null && c.keyStage === ksOfYear;
    if (!(inYear || ksOnly) || !hit) continue;
    const id = (db.query("SELECT id FROM lesson WHERE slug = ?").get(c.slug) as { id: number }).id;
    out.push({
      ...c,
      match: inYear ? "year" : "key-stage",
      keyLearningPoints: count(db, "key_learning_point", id),
      misconceptions: count(db, "lesson_misconception", id),
      keywords: count(db, "lesson_keyword", id),
    });
  }
  return out;
}

/* ----------------------------------------------------------------------------------------- */
/* One lesson's content, exactly as Oak stores it.                                            */
/* ----------------------------------------------------------------------------------------- */

export interface OakLesson {
  slug: string;
  uri: string;
  title: string;
  subject: string;
  keyStage: string;
  yearGroups: string[];
  units: { uri: string; title: string }[];
  outcomes: { uri: string; text: string }[];
  keyLearningPoints: { uri: string; text: string }[];
  misconceptions: { uri: string; statement: string; correction: string }[];
  /**
   * Oak stores one row per keyword name across the whole curriculum (13,012 names, 13,012 rows),
   * so a description can belong to another subject's sense ("nucleus" in a cells lesson carries
   * the atom's definition). `subjects` lists every subject whose lessons use the row.
   */
  keywords: { uri: string; name: string; description: string | null; subjects: string[] }[];
}

export function loadLesson(db: Database, slug: string): OakLesson {
  const l = db.query("SELECT id, uri, name FROM lesson WHERE slug = ?").get(slug) as {
    id: number;
    uri: string;
    name: string;
  } | null;
  if (!l) throw new Error(`no Oak lesson with slug ${slug}`);
  const placements = db
    .query(
      `SELECT DISTINCT u.uri AS unitUri, u.name AS unit, su.name AS subject, ks.name AS keyStage,
              yg.name AS ygName
       FROM lesson_inclusion li
       JOIN unit_variant uv ON uv.id = li.unit_variant_id
       JOIN unit u ON u.id = uv.unit_id
       JOIN scheme sc ON sc.id = u.scheme_id
       JOIN subject su ON su.id = sc.subject_id
       JOIN key_stage ks ON ks.id = sc.key_stage_id
       LEFT JOIN unit_variant_inclusion uvi ON uvi.unit_variant_id = uv.id
       LEFT JOIN programme p ON p.id = uvi.programme_id
       LEFT JOIN year_group yg ON yg.id = p.year_group_id
       WHERE li.lesson_id = ? ORDER BY u.name`,
    )
    .all(l.id) as {
    unitUri: string;
    unit: string;
    subject: string;
    keyStage: string;
    ygName: string | null;
  }[];
  const first = placements[0];
  if (!first) throw new Error(`Oak lesson ${slug} sits in no unit`);
  const units: OakLesson["units"] = [];
  const yearGroups: string[] = [];
  for (const p of placements) {
    if (!units.some((u) => u.uri === p.unitUri)) units.push({ uri: p.unitUri, title: p.unit });
    if (p.ygName && !yearGroups.includes(p.ygName)) yearGroups.push(p.ygName);
  }
  const named = (table: string) =>
    (
      db.query(`SELECT uri, name FROM ${table} WHERE lesson_id = ? ORDER BY id`).all(l.id) as {
        uri: string;
        name: string;
      }[]
    ).map((r) => ({ uri: r.uri, text: clean(r.name) }));
  const misconceptions = (
    db
      .query(
        `SELECT m.uri, m.statement, m.correction FROM misconception m
         JOIN lesson_misconception lm ON lm.misconception_id = m.id
         WHERE lm.lesson_id = ? ORDER BY m.id`,
      )
      .all(l.id) as OakLesson["misconceptions"]
  ).map((m) => ({ uri: m.uri, statement: clean(m.statement), correction: clean(m.correction) }));
  const keywords = (
    db
      .query(
        `SELECT k.uri, k.name, k.description FROM keyword k
         JOIN lesson_keyword lk ON lk.keyword_id = k.id
         WHERE lk.lesson_id = ? ORDER BY k.id`,
      )
      .all(l.id) as OakLesson["keywords"]
  ).map((k) => ({
    uri: k.uri,
    name: clean(k.name),
    description: k.description === null ? null : clean(k.description),
    subjects: (
      db
        .query(
          `SELECT DISTINCT su.name AS name FROM keyword k
           JOIN lesson_keyword lk ON lk.keyword_id = k.id
           JOIN lesson_inclusion li ON li.lesson_id = lk.lesson_id
           JOIN unit_variant uv ON uv.id = li.unit_variant_id
           JOIN unit u ON u.id = uv.unit_id
           JOIN scheme sc ON sc.id = u.scheme_id
           JOIN subject su ON su.id = sc.subject_id
           WHERE k.uri = ? ORDER BY su.name`,
        )
        .all(k.uri) as { name: string }[]
    ).map((r) => r.name),
  }));
  return {
    slug,
    uri: l.uri,
    title: clean(l.name),
    subject: first.subject,
    keyStage: first.keyStage,
    yearGroups,
    units,
    outcomes: named("pupil_lesson_outcome"),
    keyLearningPoints: named("key_learning_point"),
    misconceptions,
    keywords,
  };
}

/* ----------------------------------------------------------------------------------------- */
/* Lessons → pack. Pure: a field copy, no wording of its own.                                 */
/* ----------------------------------------------------------------------------------------- */

export interface OakDataset {
  /** e.g. "oak-curriculum v0.1.3 c07f4ee sqlite sha256:f96180a…" */
  revision: string;
  /** When Oak generated the distribution (ISO datetime); the pack's `fetchedAt`. */
  generatedAt: string;
}

export interface OakImportRequest {
  topic: string;
  subject: string;
  yearGroup: string;
  sections: { outcome: string; lessons: string[] }[];
  writtenAt: string;
}

export interface OakImportReport {
  /** Keywords Oak stores without a description: no definition to copy, so no vocabulary item. */
  keywordsWithoutDescription: { lesson: string; term: string }[];
  /** Imported keywords whose single Oak row is shared with other subjects (see `OakLesson`). */
  keywordsSharedAcrossSubjects: { lesson: string; term: string; subjects: string[] }[];
}

interface LessonSource {
  source: PackSource;
  klp: Sentence[];
  mis: { statement: Sentence; correction: Sentence }[];
  kw: (Sentence | null)[];
}

function lessonSource(lesson: OakLesson, ordinal: number, dataset: OakDataset): LessonSource {
  let seq = 0;
  const sentences: Sentence[] = [];
  const add = (heading: string, text: string): Sentence => {
    const s = { id: `s${ordinal}.${++seq}`, heading: `${lesson.title} > ${heading}`, text };
    sentences.push(s);
    return s;
  };
  for (const o of lesson.outcomes) add("Pupil lesson outcome", o.text);
  const klp = lesson.keyLearningPoints.map((k) => add("Key learning points", k.text));
  const mis = lesson.misconceptions.map((m) => ({
    statement: add("Misconceptions", m.statement),
    correction: add("Misconceptions > Response", m.correction),
  }));
  const kw = lesson.keywords.map((k) =>
    k.description === null ? null : add(`Keywords > ${k.name}`, k.description),
  );
  return {
    source: {
      id: `s${ordinal}`,
      url: lesson.uri,
      title: lesson.title,
      revision: dataset.revision,
      fetchedAt: dataset.generatedAt,
      licence: "OGL-3.0",
      sentences,
      oak: {
        kind: "oak",
        lessonSlug: lesson.slug,
        webUrl: `${OAK_LESSON_WEB}${lesson.slug}`,
        subject: lesson.subject,
        keyStage: lesson.keyStage,
        yearGroups: lesson.yearGroups,
        units: lesson.units,
      },
    },
    klp,
    mis,
    kw,
  };
}

const cite = (url: string, sentences: Sentence[], snippetFrom: Sentence): Evidence => ({
  url,
  sentenceIds: sentences.map((s) => s.id),
  snippet: snippetOf(snippetFrom.text),
});

/**
 * Builds the pack. Key learning point → key idea (`statement`; `explanation` and `example` are
 * verbatim copies, flagged in `oak.copiedFields`). Misconception → `{belief: statement,
 * correction}`. Keyword → `{term: name, definition: description}` (`sense` a flagged copy of the
 * description; `band` the requested year). Worked examples and questions: Oak has none here.
 */
export function buildOakPack(
  request: OakImportRequest,
  lessons: ReadonlyMap<string, OakLesson>,
  dataset: OakDataset,
): { pack: Pack; report: OakImportReport } {
  const band = `Y${parseYear(request.yearGroup)}`;
  const sources = new Map<string, LessonSource>();
  const report: OakImportReport = {
    keywordsWithoutDescription: [],
    keywordsSharedAcrossSubjects: [],
  };
  const sourceFor = (slug: string): LessonSource => {
    const known = sources.get(slug);
    if (known) return known;
    const lesson = lessons.get(slug);
    if (!lesson) throw new Error(`lesson ${slug} was not loaded`);
    const made = lessonSource(lesson, sources.size + 1, dataset);
    sources.set(slug, made);
    lesson.keywords.forEach((k) => {
      if (k.description === null)
        report.keywordsWithoutDescription.push({ lesson: slug, term: k.name });
      else if (k.subjects.length > 1)
        report.keywordsSharedAcrossSubjects.push({
          lesson: slug,
          term: k.name,
          subjects: k.subjects,
        });
    });
    return made;
  };

  const sections: PackSection[] = request.sections.map((sec, si) => {
    if (sec.lessons.length === 0) throw new Error(`section ${si + 1} names no lessons`);
    const facts: PackSection["facts"] = {
      keyIdeas: [],
      misconceptions: [],
      vocabulary: [],
      workedExamples: [],
      questions: [],
    };
    const sentenceIds: string[] = [];
    for (const slug of sec.lessons) {
      const lesson = lessons.get(slug);
      const ls = sourceFor(slug);
      if (!lesson) throw new Error(`lesson ${slug} was not loaded`);
      const url = ls.source.url;
      sentenceIds.push(...ls.source.sentences.map((s) => s.id));
      ls.klp.forEach((s, i) => {
        facts.keyIdeas.push({
          statement: s.text,
          explanation: s.text,
          example: s.text,
          evidence: [cite(url, [s], s)],
          oak: {
            itemUri: (lesson.keyLearningPoints[i] as { uri: string }).uri,
            copiedFields: ["explanation", "example"],
          },
        });
      });
      ls.mis.forEach((m, i) => {
        facts.misconceptions.push({
          belief: m.statement.text,
          correction: m.correction.text,
          evidence: [cite(url, [m.statement, m.correction], m.statement)],
          oak: { itemUri: (lesson.misconceptions[i] as { uri: string }).uri, copiedFields: [] },
        });
      });
      ls.kw.forEach((s, i) => {
        const k = lesson.keywords[i] as OakLesson["keywords"][number];
        if (!s) return;
        facts.vocabulary.push({
          term: k.name,
          sense: s.text,
          band,
          definition: s.text,
          evidence: [cite(url, [s], s)],
          oak: { itemUri: k.uri, copiedFields: ["sense"] },
        });
      });
    }
    return {
      id: `sec${si + 1}`,
      outcome: sec.outcome,
      sentenceIds: [...new Set(sentenceIds)],
      facts,
    };
  });

  const pack = PackSchema.parse({
    id: `${request.topic}.oak-import`,
    topic: request.topic,
    subject: request.subject,
    yearGroup: request.yearGroup,
    arm: "oak-import",
    writtenAt: request.writtenAt,
    provenance: {
      writer: "none (mechanical Oak import, OGL v3.0)",
      writerPrompt: "oak-import.v1",
    },
    sources: [...sources.values()].map((s) => s.source),
    sections,
  });
  return { pack, report };
}

/** Reads the distribution's own version and the sqlite checksum from files beside the db. */
export function datasetOf(dbPath: string): OakDataset {
  const dir = dirname(dbPath);
  let version = "unknown";
  let generatedAt = new Date(0).toISOString();
  let sha = "unknown";
  try {
    const info = JSON.parse(readFileSync(join(dir, "distribution-info.json"), "utf8")) as {
      ref?: string;
      commit_short?: string;
      generated_at?: string;
    };
    version = `${info.ref?.replace("refs/tags/", "") ?? "?"} ${info.commit_short ?? "?"}`;
    if (info.generated_at) generatedAt = new Date(info.generated_at).toISOString();
  } catch {}
  try {
    const line = readFileSync(join(dir, "checksums-sha256.txt"), "utf8")
      .split("\n")
      .find((l) => l.endsWith("oak-curriculum.sqlite"));
    if (line) sha = line.split(/\s+/)[0] ?? sha;
  } catch {}
  return { revision: `oak-curriculum ${version} sqlite sha256:${sha}`, generatedAt };
}

/* ----------------------------------------------------------------------------------------- */
/* W3e: Oak keyword presence at a key stage.                                                  */
/* ----------------------------------------------------------------------------------------- */

export interface KeywordHit {
  keyword: string;
  description: string | null;
  lessons: string[];
}

/**
 * Oak keywords taught in lessons of key stage `keyStage` whose name equals `term` (exact,
 * case-insensitive after whitespace collapse) or contains it as a whole word (`partial`).
 * `subject` (optional, exact name) narrows to that subject's lessons.
 */
export function oakKeywordHits(
  db: Database,
  term: string,
  keyStage: number,
  subject?: string,
): { exact: KeywordHit[]; partial: KeywordHit[] } {
  const want = clean(term).toLowerCase();
  const rows = db
    .query(
      `SELECT DISTINCT k.name AS name, k.description AS description, l.slug AS slug
       FROM keyword k
       JOIN lesson_keyword lk ON lk.keyword_id = k.id
       JOIN lesson l ON l.id = lk.lesson_id
       JOIN lesson_inclusion li ON li.lesson_id = l.id
       JOIN unit_variant uv ON uv.id = li.unit_variant_id
       JOIN unit u ON u.id = uv.unit_id
       JOIN scheme sc ON sc.id = u.scheme_id
       JOIN key_stage ks ON ks.id = sc.key_stage_id
       JOIN subject su ON su.id = sc.subject_id
       WHERE ks.uri LIKE ? AND instr(lower(k.name), ?) > 0
         AND (? IS NULL OR lower(su.name) = lower(?))
       ORDER BY k.name, l.slug`,
    )
    .all(`%/key-stage-${keyStage}`, want, subject ?? null, subject ?? null) as {
    name: string;
    description: string | null;
    slug: string;
  }[];
  const escaped = want.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const word = new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`);
  const exact = new Map<string, KeywordHit>();
  const partial = new Map<string, KeywordHit>();
  for (const r of rows) {
    const name = clean(r.name);
    const lower = name.toLowerCase();
    const bucket = lower === want ? exact : word.test(lower) ? partial : null;
    if (!bucket) continue;
    const hit = bucket.get(lower) ?? {
      keyword: name,
      description: r.description === null ? null : clean(r.description),
      lessons: [],
    };
    if (!hit.lessons.includes(r.slug)) hit.lessons.push(r.slug);
    bucket.set(lower, hit);
  }
  return { exact: [...exact.values()], partial: [...partial.values()] };
}

/* ----------------------------------------------------------------------------------------- */
/* CLI                                                                                        */
/* ----------------------------------------------------------------------------------------- */

function values(argv: string[], name: string): string[] {
  const out: string[] = [];
  argv.forEach((a, i) => {
    if (a === `--${name}` && argv[i + 1] !== undefined) out.push(argv[i + 1] as string);
  });
  return out;
}

/** `--outcome A --lessons x,y --outcome B --lessons z` → paired sections, in order. */
export function parseSections(argv: string[]): OakImportRequest["sections"] {
  const sections: OakImportRequest["sections"] = [];
  argv.forEach((a, i) => {
    const v = argv[i + 1];
    if (v === undefined) return;
    if (a === "--outcome") sections.push({ outcome: v, lessons: [] });
    if (a === "--lessons") {
      const last = sections.at(-1);
      if (!last) throw new Error("--lessons before any --outcome");
      last.lessons.push(
        ...v
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      );
    }
  });
  return sections;
}

function main(argv: string[]): void {
  const [command] = argv;
  const one = (name: string) => values(argv, name)[0];
  const dbPath = one("db") ?? DEFAULT_OAK_DB;
  const need = (name: string): string => {
    const v = one(name);
    if (v === undefined) throw new Error(`--${name} is required`);
    return v;
  };
  const db = openOak(dbPath);
  if (command === "candidates") {
    const found = findCandidates(db, {
      subject: need("subject"),
      year: parseYear(need("year")),
      terms: values(argv, "search"),
    });
    for (const c of found)
      console.log(
        `${c.slug}\t${c.title}\t[${c.units.join(" | ")}]\t${c.keyStage}; ${c.match === "year" ? c.yearGroups.join(", ") : "no year group in Oak"}\tklp ${c.keyLearningPoints} mis ${c.misconceptions} kw ${c.keywords}`,
      );
    console.log(`${found.length} candidate lesson(s)`);
    return;
  }
  if (command === "import") {
    const sections = parseSections(argv);
    if (sections.length === 0) throw new Error("give at least one --outcome with --lessons");
    const slugs = [...new Set(sections.flatMap((s) => s.lessons))];
    const lessons = new Map(slugs.map((s) => [s, loadLesson(db, s)]));
    const topic = need("topic");
    const { pack, report } = buildOakPack(
      {
        topic,
        subject: need("subject"),
        yearGroup: `Year ${parseYear(need("year"))}`,
        sections,
        writtenAt: new Date().toISOString(),
      },
      lessons,
      datasetOf(dbPath),
    );
    const out = one("out") ?? join(import.meta.dir, `${topic}.oak-import.json`);
    writeFileSync(out, `${JSON.stringify(pack, null, 2)}\n`);
    for (const s of pack.sections)
      console.log(
        `${s.id}: ${s.facts.keyIdeas.length} key ideas, ${s.facts.misconceptions.length} misconceptions, ${s.facts.vocabulary.length} vocabulary — ${s.outcome}`,
      );
    for (const k of report.keywordsWithoutDescription)
      console.log(`skipped keyword without description: ${k.term} (${k.lesson})`);
    for (const k of report.keywordsSharedAcrossSubjects)
      console.log(
        `keyword row shared across subjects, check its sense: ${k.term} (${k.lesson}; ${k.subjects.join(", ")})`,
      );
    console.log(`wrote ${out}`);
    return;
  }
  if (command === "keyword") {
    const ks = parseKeyStage(need("key-stage"));
    for (const term of values(argv, "term")) {
      const { exact, partial } = oakKeywordHits(db, term, ks, one("subject"));
      console.log(`${term} @ KS${ks}: ${exact.length} exact, ${partial.length} partial`);
      for (const h of [...exact, ...partial])
        console.log(
          `  ${h.keyword}: ${h.description ?? "(no description)"} [${h.lessons.join(", ")}]`,
        );
    }
    return;
  }
  throw new Error("usage: oak-import.ts candidates|import|keyword …");
}

if (import.meta.main) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error((e as Error).message);
    process.exit(2);
  }
}
