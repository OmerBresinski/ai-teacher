import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
  buildOakPack,
  clean,
  DEFAULT_OAK_DB,
  findCandidates,
  loadLesson,
  oakKeywordHits,
  openOak,
  parseKeyStage,
  parseSections,
  parseYear,
  snippetOf,
  yearGroupCovers,
} from "./oak-import";
import { checkPack, SNIPPET_MAX_WORDS, sectionToObjectiveFacts } from "./schema";

const W = "https://w3id.org/uk/oak/curriculum/";

/** The slice of Oak's schema the import reads, with two subjects sharing one keyword row. */
function fixture(): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE subject (id INTEGER PRIMARY KEY, uri TEXT, name TEXT);
    CREATE TABLE key_stage (id INTEGER PRIMARY KEY, uri TEXT, name TEXT);
    CREATE TABLE year_group (id INTEGER PRIMARY KEY, uri TEXT, name TEXT, key_stage_id INTEGER);
    CREATE TABLE scheme (id INTEGER PRIMARY KEY, uri TEXT, name TEXT, key_stage_id INTEGER, subject_id INTEGER);
    CREATE TABLE unit (id INTEGER PRIMARY KEY, uri TEXT, name TEXT, scheme_id INTEGER);
    CREATE TABLE unit_variant (id INTEGER PRIMARY KEY, uri TEXT, name TEXT, unit_id INTEGER);
    CREATE TABLE programme (id INTEGER PRIMARY KEY, uri TEXT, name TEXT, year_group_id INTEGER, scheme_id INTEGER);
    CREATE TABLE unit_variant_inclusion (id INTEGER PRIMARY KEY, uri TEXT, programme_id INTEGER, unit_variant_id INTEGER);
    CREATE TABLE lesson (id INTEGER PRIMARY KEY, uri TEXT, name TEXT, slug TEXT);
    CREATE TABLE lesson_inclusion (id INTEGER PRIMARY KEY, uri TEXT, sequence_position INTEGER, lesson_id INTEGER, unit_variant_id INTEGER);
    CREATE TABLE key_learning_point (id INTEGER PRIMARY KEY, uri TEXT, name TEXT, lesson_id INTEGER);
    CREATE TABLE pupil_lesson_outcome (id INTEGER PRIMARY KEY, uri TEXT, name TEXT, lesson_id INTEGER);
    CREATE TABLE misconception (id INTEGER PRIMARY KEY, uri TEXT, statement TEXT, correction TEXT);
    CREATE TABLE lesson_misconception (lesson_id INTEGER, misconception_id INTEGER);
    CREATE TABLE keyword (id INTEGER PRIMARY KEY, uri TEXT, name TEXT, description TEXT);
    CREATE TABLE lesson_keyword (lesson_id INTEGER, keyword_id INTEGER);

    INSERT INTO subject VALUES (1, '${W}subject-history', 'History'), (2, '${W}subject-physics', 'Physics');
    INSERT INTO key_stage VALUES (2, '${W}key-stage-2', 'Key Stage 2'), (3, '${W}key-stage-3', 'Key Stage 3');
    INSERT INTO year_group VALUES (4, '${W}year-group-4', 'Year Group 4', 2), (5, '${W}year-group-5', 'Year Group 5', 2),
      (7, '${W}year-group-7', 'Year Group 7', 3), (34, '${W}year-group-3-4', 'Year Groups 3 and 4', 2);
    INSERT INTO scheme VALUES (1, '${W}scheme-h2', 'History KS2', 2, 1), (2, '${W}scheme-p3', 'Physics KS3', 3, 2);
    INSERT INTO unit VALUES (1, '${W}unit-1', 'The Romans: what impact did the Romans have on Britain?', 1),
      (2, '${W}unit-2', 'Anglo-Saxons', 1), (3, '${W}unit-3', 'Atoms', 2), (4, '${W}unit-4', 'Mixed class topics', 1),
      (5, '${W}unit-5', 'Period studies', 1);
    INSERT INTO unit_variant VALUES (1, '${W}uv-1', 'v', 1), (2, '${W}uv-2', 'v', 2), (3, '${W}uv-3', 'v', 3), (4, '${W}uv-4', 'v', 4), (5, '${W}uv-5', 'v', 5);
    INSERT INTO programme VALUES (1, '${W}p-h4', 'History Y4', 4, 1), (2, '${W}p-h5', 'History Y5', 5, 1),
      (3, '${W}p-p7', 'Physics Y7', 7, 2), (4, '${W}p-h34', 'History Y3-4', 34, 1);
    INSERT INTO unit_variant_inclusion VALUES (1, 'a', 1, 1), (2, 'b', 2, 2), (3, 'c', 3, 3), (4, 'd', 4, 4);
    INSERT INTO lesson VALUES (1, '${W}lesson-1', 'The Roman invasion of Britain', 'the-roman-invasion-of-britain'),
      (2, '${W}lesson-2', 'Boudica''s rebellion', 'boudicas-rebellion'),
      (3, '${W}lesson-3', 'Anglo-Saxon kingdoms', 'anglo-saxon-kingdoms'),
      (4, '${W}lesson-4', 'Inside the atom', 'inside-the-atom'),
      (5, '${W}lesson-5', 'Roman roads', 'roman-roads'),
      (6, '${W}lesson-6', 'Roman forts', 'roman-forts');
    INSERT INTO lesson_inclusion VALUES (1, 'i1', 1, 1, 1), (2, 'i2', 2, 2, 1), (3, 'i3', 1, 3, 2), (4, 'i4', 1, 4, 3), (5, 'i5', 1, 5, 4), (6, 'i6', 1, 6, 5);
    INSERT INTO key_learning_point VALUES
      (1, '${W}klp-1', 'Emperor Claudius ordered the invasion of Britain in 43 CE to secure his position as
  emperor.', 1),
      (2, '${W}klp-2', 'The invasion succeeded because of the strengths of the Roman army.', 1),
      (3, '${W}klp-3', 'Boudica led a revolt in 60 CE.', 2);
    INSERT INTO pupil_lesson_outcome VALUES (1, '${W}plo-1', 'I can explain how the Romans invaded Britain.', 1);
    INSERT INTO misconception VALUES (1, '${W}mis-1', 'Pupils may think Britain was one kingdom.', 'Remind pupils that Britain was many tribes.');
    INSERT INTO lesson_misconception VALUES (1, 1);
    INSERT INTO keyword VALUES (1, '${W}keyword-invade', 'invade', 'to attack another country with soldiers'),
      (2, '${W}keyword-nucleus', 'nucleus', 'the centre of an atom'),
      (3, '${W}keyword-tribe', 'tribe', NULL),
      (4, '${W}keyword-roman-army', 'Roman army', 'the army of Rome');
    INSERT INTO lesson_keyword VALUES (1, 1), (1, 2), (1, 3), (2, 4), (4, 2);
  `);
  return db;
}

const DATASET = { revision: "oak-curriculum test", generatedAt: "2026-06-11T12:00:47.000Z" };

describe("parsing", () => {
  test("years, key stages and year-group ranges", () => {
    expect([parseYear("Year 4"), parseYear("Y10"), parseYear("7")]).toEqual([4, 10, 7]);
    expect(() => parseYear("Year Four")).toThrow();
    expect([parseKeyStage("KS3"), parseKeyStage("Key Stage 2"), parseKeyStage("4")]).toEqual([
      3, 2, 4,
    ]);
    expect(yearGroupCovers(`${W}year-group-4`, 4)).toBe(true);
    expect(yearGroupCovers(`${W}year-group-3-4`, 4)).toBe(true);
    expect(yearGroupCovers(`${W}year-group-10`, 1)).toBe(false);
  });

  test("sections pair each --outcome with the --lessons after it", () => {
    expect(
      parseSections(["import", "--outcome", "A b c d", "--lessons", "x, y", "--outcome", "B c d"]),
    ).toEqual([
      { outcome: "A b c d", lessons: ["x", "y"] },
      { outcome: "B c d", lessons: [] },
    ]);
    expect(() => parseSections(["--lessons", "x"])).toThrow();
  });

  test("clean collapses Oak's hard wraps and nothing else; snippets are word-capped prefixes", () => {
    expect(clean("as\n  emperor. ")).toBe("as emperor.");
    const long = Array.from({ length: 40 }, (_, i) => `w${i}`).join(" ");
    expect(snippetOf(long).split(" ")).toHaveLength(SNIPPET_MAX_WORDS);
    expect(long.startsWith(snippetOf(long))).toBe(true);
  });
});

describe("findCandidates (a lookup: exact subject and year, title search)", () => {
  test("matches lesson or unit titles in that subject and year, including mixed-year groups", () => {
    const db = fixture();
    const slugs = findCandidates(db, { subject: "history", year: 4, terms: ["roman"] }).map(
      (c) => c.slug,
    );
    // Ordered by unit title, then position. Boudica matches by unit title only; Roman roads
    // through the Y3-4 programme; Roman forts has no year group but sits in KS2, which holds Y4;
    // Anglo-Saxon kingdoms is Y5.
    const found = findCandidates(db, { subject: "history", year: 4, terms: ["roman"] });
    expect(slugs).toEqual([
      "roman-roads",
      "roman-forts",
      "the-roman-invasion-of-britain",
      "boudicas-rebellion",
    ]);
    expect(found.find((c) => c.slug === "roman-forts")?.match).toBe("key-stage");
    expect(findCandidates(db, { subject: "History", year: 7, terms: ["roman"] })).toEqual([]);
  });

  test("no terms lists every lesson of that subject and year; other years and subjects never", () => {
    const db = fixture();
    expect(findCandidates(db, { subject: "History", year: 5 }).map((c) => c.slug)).toEqual([
      "anglo-saxon-kingdoms",
      "roman-forts",
    ]);
    expect(findCandidates(db, { subject: "History", year: 12 })).toEqual([]);
    expect(findCandidates(db, { subject: "Economics", year: 4 })).toEqual([]);
  });

  test("reports counts per lesson", () => {
    const [c] = findCandidates(fixture(), { subject: "History", year: 4, terms: ["invasion"] });
    expect(c).toMatchObject({
      keyLearningPoints: 2,
      misconceptions: 1,
      keywords: 3,
      match: "year",
      yearGroups: ["Year Group 4"],
    });
  });
});

describe("buildOakPack (a field copy)", () => {
  const build = () => {
    const db = fixture();
    const lessons = new Map(
      ["the-roman-invasion-of-britain", "boudicas-rebellion"].map((s) => [s, loadLesson(db, s)]),
    );
    return buildOakPack(
      {
        topic: "romans",
        subject: "History",
        yearGroup: "Year 4",
        writtenAt: "2026-09-23T12:00:00.000Z",
        sections: [
          {
            outcome: "Explain why the Romans invaded Britain",
            lessons: ["the-roman-invasion-of-britain"],
          },
          {
            outcome: "Describe Boudica's rebellion",
            lessons: ["boudicas-rebellion", "the-roman-invasion-of-britain"],
          },
        ],
      },
      lessons,
      DATASET,
    );
  };

  test("key learning points, misconceptions and keywords land verbatim, with Oak provenance", () => {
    const { pack } = build();
    expect(pack.arm).toBe("oak-import");
    expect(pack.id).toBe("romans.oak-import");
    const f = pack.sections[0]?.facts;
    expect(f?.keyIdeas.map((k) => k.statement)).toEqual([
      "Emperor Claudius ordered the invasion of Britain in 43 CE to secure his position as emperor.",
      "The invasion succeeded because of the strengths of the Roman army.",
    ]);
    expect(f?.keyIdeas[0]).toMatchObject({
      explanation: f?.keyIdeas[0]?.statement,
      example: f?.keyIdeas[0]?.statement,
      oak: { itemUri: `${W}klp-1`, copiedFields: ["explanation", "example"] },
    });
    expect(f?.misconceptions).toEqual([
      {
        belief: "Pupils may think Britain was one kingdom.",
        correction: "Remind pupils that Britain was many tribes.",
        evidence: [
          {
            url: `${W}lesson-1`,
            sentenceIds: ["s1.4", "s1.5"],
            snippet: "Pupils may think Britain was one kingdom.",
          },
        ],
        oak: { itemUri: `${W}mis-1`, copiedFields: [] },
      },
    ]);
    // "tribe" has no description in Oak: no definition to copy, so no vocabulary item.
    expect(f?.vocabulary.map((v) => [v.term, v.definition, v.band])).toEqual([
      ["invade", "to attack another country with soldiers", "Y4"],
      ["nucleus", "the centre of an atom", "Y4"],
    ]);
    expect(f?.workedExamples).toEqual([]);
    expect(f?.questions).toEqual([]);
    const src = pack.sources[0];
    expect(src).toMatchObject({
      id: "s1",
      url: `${W}lesson-1`,
      licence: "OGL-3.0",
      revision: DATASET.revision,
      fetchedAt: DATASET.generatedAt,
      oak: {
        kind: "oak",
        lessonSlug: "the-roman-invasion-of-britain",
        webUrl: "https://www.thenational.academy/teachers/lessons/the-roman-invasion-of-britain",
        subject: "History",
        keyStage: "Key Stage 2",
      },
    });
    expect(src?.sentences[0]).toEqual({
      id: "s1.1",
      heading: "The Roman invasion of Britain > Pupil lesson outcome",
      text: "I can explain how the Romans invaded Britain.",
    });
  });

  test("a lesson reused by two sections is one source; the pack is structurally sound", () => {
    const { pack } = build();
    expect(pack.sources.map((s) => s.oak?.lessonSlug)).toEqual([
      "the-roman-invasion-of-britain",
      "boudicas-rebellion",
    ]);
    expect(pack.sections[1]?.facts.keyIdeas.map((k) => k.statement)[0]).toBe(
      "Boudica led a revolt in 60 CE.",
    );
    expect(checkPack(pack)).toEqual([]);
    expect(sectionToObjectiveFacts(pack.sections[0] as never).keyIdeas).toHaveLength(2);
  });

  test("reports skipped keywords and keyword rows shared with other subjects", () => {
    const { report } = build();
    expect(report.keywordsWithoutDescription).toEqual([
      { lesson: "the-roman-invasion-of-britain", term: "tribe" },
    ]);
    expect(report.keywordsSharedAcrossSubjects).toEqual([
      {
        lesson: "the-roman-invasion-of-britain",
        term: "nucleus",
        subjects: ["History", "Physics"],
      },
    ]);
  });

  test("an unknown slug or an empty section fails loudly", () => {
    const db = fixture();
    expect(() => loadLesson(db, "no-such-lesson")).toThrow();
    expect(() =>
      buildOakPack(
        {
          topic: "t",
          subject: "History",
          yearGroup: "Year 4",
          writtenAt: "2026-09-23T12:00:00.000Z",
          sections: [{ outcome: "Explain something here", lessons: [] }],
        },
        new Map(),
        DATASET,
      ),
    ).toThrow();
  });
});

describe("oakKeywordHits (W3e)", () => {
  test("exact and whole-word matches, scoped to the key stage and optionally the subject", () => {
    const db = fixture();
    expect(oakKeywordHits(db, "nucleus", 3).exact.map((h) => h.lessons)).toEqual([
      ["inside-the-atom"],
    ]);
    expect(oakKeywordHits(db, "nucleus", 3, "History").exact).toEqual([]);
    const army = oakKeywordHits(db, "army", 2);
    expect(army.exact).toEqual([]);
    expect(army.partial.map((h) => h.keyword)).toEqual(["Roman army"]);
    expect(oakKeywordHits(db, "arm", 2).partial).toEqual([]);
    expect(oakKeywordHits(db, "turgor", 3)).toEqual({ exact: [], partial: [] });
  });
});

describe.skipIf(!existsSync(DEFAULT_OAK_DB))("the real Oak sqlite", () => {
  test("W7 coverage: Y4 Romans and Y7 cells have lessons; Oak has no Year 12 or 13", () => {
    const db = openOak();
    expect(
      findCandidates(db, { subject: "History", year: 4, terms: ["roman"] }).length,
    ).toBeGreaterThan(5);
    expect(
      findCandidates(db, { subject: "Biology", year: 7, terms: ["cell"] }).map((c) => c.slug),
    ).toContain("animal-cell-structures-and-their-functions");
    for (const year of [12, 13])
      for (const subject of ["History", "Economics", "Psychology", "Biology"])
        expect(findCandidates(db, { subject, year })).toEqual([]);
  });

  test("W3e: centrosome and turgor are not KS3 keywords", () => {
    const db = openOak();
    for (const term of ["centrosome", "turgor"])
      expect(oakKeywordHits(db, term, 3)).toEqual({ exact: [], partial: [] });
  });
});
