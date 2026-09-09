import type { Lesson, Series, Worksheet } from "@tj/domain/documents";
import {
  fractionsPracticeWorksheet,
  plantLabelsWorksheet,
  riverVocabularyWorksheet,
  romanSourceWorksheet,
} from "./demo-worksheet";
import { docFromText, newSlide } from "./factories";
import { demoLibrary, starterLesson } from "./starter";

/**
 * The demo Workspace (ADR 0024 §16): the varied library `bun run db:seed` and the e2e seed route
 * insert into an empty Workspace. It was the web mock store's fixture until TEACH-121 retired the
 * mocks; it lives here because it is built from the starter content, which stays in `@tj/editor`.
 *
 * Each entry carries a stable `key` (`demo-water-cycle`, `series-romans`, …) that tests address a
 * document by. Ids are server-minted uuids (§11), so a seeder inserts the lessons and worksheets
 * first, then rewrites each series' `lessonIds` from keys to the ids it was given — see
 * `seedDocuments` in `@tj/db`, used by `scripts/db-seed.ts` and `POST /__test/seed-library`.
 */
export type DemoDocument =
  | { key: string; kind: "lesson"; body: Lesson }
  | { key: string; kind: "worksheet"; body: Worksheet }
  /** `body.lessonIds` holds the lesson **keys**; the seeder maps them to ids. */
  | { key: string; kind: "series"; body: Series };

function timestamp(now: Date, hoursAgo: number): string {
  return new Date(now.getTime() - hoursAgo * 60 * 60 * 1000).toISOString();
}

type Meta = {
  key: string;
  title: string;
  themeId: string;
  subject: string;
  yearGroup: string;
  hoursAgo: number;
};

/** Stamp identity, timestamps and card metadata onto a freshly built body. */
function stamp<T extends Lesson | Worksheet>(now: Date, body: T, meta: Meta): T {
  body.id = meta.key;
  body.title = meta.title;
  body.themeId = meta.themeId;
  body.subject = meta.subject;
  body.yearGroup = meta.yearGroup;
  body.updatedAt = timestamp(now, meta.hoursAgo);
  body.createdAt = timestamp(now, meta.hoursAgo + 24);
  return body;
}

/** A starter lesson with `extra` more content slides, so seeded decks vary in length. */
function lesson(now: Date, meta: Meta, extra = 0): DemoDocument {
  const body = starterLesson(meta.title, meta.themeId);
  for (let i = 0; i < extra; i += 1) body.slides.push(newSlide("content", meta.themeId));
  return { key: meta.key, kind: "lesson", body: stamp(now, body, meta) };
}

/**
 * A lesson as it comes back from storage written before `fitVersion` existed: the recipe's
 * vocabulary slide with its definition boxes squashed to the old height, so the raised floors make
 * the text run into the row below until the editor tidies it (TEACH-106).
 */
function staleLesson(now: Date, meta: Meta): DemoDocument {
  const body = starterLesson(meta.title, meta.themeId);
  body.slides.push(newSlide("vocabulary", meta.themeId));
  const vocab = body.slides[body.slides.length - 1];
  if (vocab) {
    for (const el of vocab.elements) {
      if (el.type !== "text" || el.style.preset !== "small") continue;
      // A three-line definition in a box authored for one line, under the old, smaller floor.
      el.doc = docFromText(
        "A complete path that lets electricity flow from the cell, through every component in turn, and back again",
      );
      el.h = 28;
    }
  }
  body.fitVersion = 0;
  return { key: meta.key, kind: "lesson", body: stamp(now, body, meta) };
}

/**
 * One of the four real sheets (TEACH-186). `lessonKey` is the key of the lesson it belongs to;
 * the seeder maps it to that lesson's id, as it does a series' `lessonIds`.
 */
function worksheet(now: Date, meta: Meta, body: Worksheet, lessonKey?: string): DemoDocument {
  const stamped = stamp(now, body, meta);
  if (lessonKey) stamped.lessonId = lessonKey;
  return { key: meta.key, kind: "worksheet", body: stamped };
}

function series(
  now: Date,
  key: string,
  title: string,
  lessonKeys: string[],
  hours: { created: number; updated: number },
): DemoDocument {
  return {
    key,
    kind: "series",
    body: {
      id: key,
      title,
      lessonIds: lessonKeys,
      createdAt: timestamp(now, hours.created),
      updatedAt: timestamp(now, hours.updated),
    },
  };
}

const meta = (
  key: string,
  title: string,
  themeId: string,
  subject: string,
  yearGroup: string,
  hoursAgo: number,
): Meta => ({ key, title, themeId, subject, yearGroup, hoursAgo });

/**
 * A stable, suitably varied library: ten lessons, four worksheets, two series. The two demo
 * lessons are TeachDeck's (`demoLibrary()`); the other lessons are starter content under a
 * different title so every card has a real first slide to paint; the worksheets are the four real
 * sheets in `demo-worksheet.ts`, one per job. Lessons come before the worksheets and series that
 * reference them. `now` fixes every timestamp so the Recent / Earlier split is stable.
 */
export function demoWorkspace(now: Date): DemoDocument[] {
  const [waterCycle, fractions] = demoLibrary() as [Lesson, Lesson];
  return [
    {
      key: "demo-water-cycle",
      kind: "lesson",
      body: stamp(
        now,
        waterCycle,
        meta("demo-water-cycle", "The water cycle", "chalk", "Science", "Year 4", 1),
      ),
    },
    {
      key: "demo-fractions",
      kind: "lesson",
      body: stamp(
        now,
        fractions,
        meta("demo-fractions", "Fractions of amounts", "playground", "Maths", "Year 4", 3),
      ),
    },
    lesson(now, meta("roman-roads", "Roman roads", "reading-room", "History", "Year 4", 12), 2),
    lesson(
      now,
      meta("roman-army", "Life in the Roman army", "night-lab", "History", "Year 4", 30),
      1,
    ),
    lesson(now, meta("roman-empire", "The Roman Empire", "beacon", "History", "Year 4", 72)),
    lesson(
      now,
      meta("equivalent-fractions", "Equivalent fractions", "exam-hall", "Maths", "Year 4", 120),
    ),
    lesson(
      now,
      meta("plant-parts", "Parts of a flowering plant", "chalk", "Science", "Year 3", 216),
      1,
    ),
    lesson(
      now,
      meta("fronted-adverbials", "Fronted adverbials", "reading-room", "English", "Year 5", 384),
    ),
    lesson(
      now,
      meta("rivers", "How rivers shape the land", "exam-hall", "Geography", "Year 5", 600),
      2,
    ),
    staleLesson(now, meta("electricity", "Simple circuits", "night-lab", "Science", "Year 6", 960)),
    worksheet(
      now,
      meta("fraction-practice", "Fractions practice", "playground", "Maths", "Year 4", 48),
      fractionsPracticeWorksheet(),
      "demo-fractions",
    ),
    worksheet(
      now,
      meta("roman-source", "Roman source investigation", "beacon", "History", "Year 4", 168),
      romanSourceWorksheet(),
    ),
    worksheet(
      now,
      meta("plant-labels", "Label a flowering plant", "chalk", "Science", "Year 3", 480),
      plantLabelsWorksheet(),
    ),
    worksheet(
      now,
      meta("river-vocabulary", "River vocabulary", "reading-room", "Geography", "Year 5", 840),
      riverVocabularyWorksheet(),
    ),
    series(now, "series-romans", "The Romans", ["roman-roads", "demo-fractions", "roman-army"], {
      created: 240,
      updated: 30,
    }),
    series(now, "series-fractions", "Fractions unit", ["demo-fractions", "equivalent-fractions"], {
      created: 168,
      updated: 3,
    }),
  ];
}
