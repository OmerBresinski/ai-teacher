import type { Lesson, Worksheet } from "@tj/domain/documents";
import {
  demoLibrary,
  demoWorksheet,
  docFromText,
  newSlide,
  starterLesson,
  starterWorksheet,
} from "@tj/editor";
import type { LibraryTheme, Series } from "./library-schema";
import type { StoredDocument } from "./summarise";

/**
 * The New dialog's theme picker: the editor's six themes (ADR 0021; the catalogue itself lives in
 * `@tj/editor`, and `library-fixtures.test.ts` checks this table agrees with it) with the shell's
 * own "Primary / Secondary / Calm / Bold" filter chips. A literal so the dialog's chunk does not
 * carry the catalogue.
 */
export const LIBRARY_THEMES: LibraryTheme[] = [
  {
    id: "chalk",
    name: "Chalk & Cream",
    swatch: "#FAF4E6",
    ink: "#2C2A24",
    tags: ["Primary", "Calm"],
  },
  {
    id: "playground",
    name: "Playground",
    swatch: "#FFF7EF",
    ink: "#33261D",
    tags: ["Primary", "Bold"],
  },
  {
    id: "reading-room",
    name: "Reading Room",
    swatch: "#F2EFE8",
    ink: "#1F2328",
    tags: ["Secondary", "Calm"],
  },
  {
    id: "exam-hall",
    name: "Exam Hall",
    swatch: "#F6F7F5",
    ink: "#16191C",
    tags: ["Secondary", "Calm"],
  },
  {
    id: "night-lab",
    name: "Night Lab",
    swatch: "#131519",
    ink: "#ECEDEF",
    tags: ["Secondary", "Bold"],
  },
  { id: "beacon", name: "Beacon", swatch: "#FFFDF2", ink: "#0E0E0E", tags: ["Primary", "Bold"] },
];

function timestamp(now: Date, hoursAgo: number): string {
  return new Date(now.getTime() - hoursAgo * 60 * 60 * 1000).toISOString();
}

type Meta = {
  id: string;
  title: string;
  themeId: string;
  subject: string;
  yearGroup: string;
  hoursAgo: number;
};

/** Stamp identity, timestamps and card metadata onto a freshly built body. */
function stamp<T extends Lesson | Worksheet>(now: Date, body: T, meta: Meta): T {
  body.id = meta.id;
  body.title = meta.title;
  body.themeId = meta.themeId;
  body.subject = meta.subject;
  body.yearGroup = meta.yearGroup;
  body.updatedAt = timestamp(now, meta.hoursAgo);
  body.createdAt = timestamp(now, meta.hoursAgo + 24);
  return body;
}

/** A starter lesson with `extra` more content slides, so seeded decks vary in length. */
function lesson(now: Date, meta: Meta, extra = 0): Lesson {
  const body = starterLesson(meta.title, meta.themeId);
  for (let i = 0; i < extra; i += 1) body.slides.push(newSlide("content", meta.themeId));
  return stamp(now, body, meta);
}

/**
 * A lesson as it comes back from storage written before `fitVersion` existed: the recipe's
 * vocabulary slide with its definition boxes squashed to the old height, so the raised floors make
 * the text run into the row below until the editor tidies it.
 */
function staleLesson(now: Date, meta: Meta): Lesson {
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
  return stamp(now, body, meta);
}

function worksheet(now: Date, meta: Meta): Worksheet {
  return stamp(now, starterWorksheet(meta.title, meta.themeId), meta);
}

const meta = (
  id: string,
  title: string,
  themeId: string,
  subject: string,
  yearGroup: string,
  hoursAgo: number,
): Meta => ({ id, title, themeId, subject, yearGroup, hoursAgo });

/**
 * A stable, suitably varied library for the first library screens. The two demo lessons are
 * TeachDeck's (`demoLibrary()`, same ids); everything else is starter content under a different
 * title so every card has a real first slide to paint.
 */
export function seedLibrary(now: Date): { documents: StoredDocument[]; series: Series[] } {
  const [waterCycle, fractions] = demoLibrary() as [Lesson, Lesson];
  const bodies: (Lesson | Worksheet)[] = [
    stamp(
      now,
      waterCycle,
      meta("demo-water-cycle", "The water cycle", "chalk", "Science", "Year 4", 1),
    ),
    stamp(
      now,
      fractions,
      meta("demo-fractions", "Fractions of amounts", "playground", "Maths", "Year 4", 3),
    ),
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
    // Stored under the previous floor table (`fitVersion: 0`) with a vocabulary slide whose
    // definition boxes were authored too short for the raised `small` floor: the editor's fit
    // migration (TEACH-106) re-fits it once on open. The other seeds are all current.
    staleLesson(now, meta("electricity", "Simple circuits", "night-lab", "Science", "Year 6", 960)),
    stamp(
      now,
      demoWorksheet(),
      meta("fraction-practice", "Fractions practice", "playground", "Maths", "Year 4", 48),
    ),
    worksheet(
      now,
      meta("roman-source", "Roman source investigation", "beacon", "History", "Year 4", 168),
    ),
    worksheet(
      now,
      meta("plant-labels", "Label a flowering plant", "chalk", "Science", "Year 3", 480),
    ),
    worksheet(
      now,
      meta("river-vocabulary", "River vocabulary", "reading-room", "Geography", "Year 5", 840),
    ),
  ];

  const series: Series[] = [
    {
      id: "series-romans",
      title: "The Romans",
      lessonIds: ["roman-roads", "demo-fractions", "roman-army"],
      createdAt: timestamp(now, 240),
      updatedAt: timestamp(now, 30),
    },
    {
      id: "series-fractions",
      title: "Fractions unit",
      lessonIds: ["demo-fractions", "equivalent-fractions"],
      createdAt: timestamp(now, 168),
      updatedAt: timestamp(now, 3),
    },
  ];

  return { documents: bodies.map((body) => ({ body })), series };
}
