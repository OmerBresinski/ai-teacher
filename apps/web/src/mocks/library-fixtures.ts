import type { DocumentSummary, LibraryTheme, Series } from "./library-schema";

export const LIBRARY_THEMES: LibraryTheme[] = [
  { id: "chalk", name: "Chalk & Cream", swatch: "#FAF4E6", ink: "#2C2A24", tags: ["Calm"] },
  {
    id: "playground",
    name: "Playground",
    swatch: "#FFF7EF",
    ink: "#33261D",
    tags: ["Primary", "Bold"],
  },
  { id: "paper", name: "Paper", swatch: "#F2EFE8", ink: "#1F2328", tags: ["Secondary", "Calm"] },
  { id: "slate", name: "Slate", swatch: "#263238", ink: "#F5F5F5", tags: ["Secondary"] },
  { id: "meadow", name: "Meadow", swatch: "#E8F2E5", ink: "#25402E", tags: ["Primary", "Calm"] },
  { id: "ember", name: "Ember", swatch: "#FCE9DF", ink: "#4A1F13", tags: ["Bold"] },
];

function timestamp(now: Date, hoursAgo: number): string {
  return new Date(now.getTime() - hoursAgo * 60 * 60 * 1000).toISOString();
}

function document(
  now: Date,
  hoursAgo: number,
  id: string,
  kind: DocumentSummary["kind"],
  title: string,
  count: number,
  themeId: string,
  subject: string,
  yearGroup: string,
): DocumentSummary {
  const updatedAt = timestamp(now, hoursAgo);
  return {
    id,
    kind,
    title,
    count,
    updatedAt,
    createdAt: timestamp(now, hoursAgo + 24),
    themeId,
    subject,
    yearGroup,
  };
}

/** A stable, suitably varied library for the first library screens. */
export function seedLibrary(now: Date): { documents: DocumentSummary[]; series: Series[] } {
  const documents = [
    document(
      now,
      1,
      "demo-water-cycle",
      "lesson",
      "The water cycle",
      7,
      "chalk",
      "Science",
      "Year 4",
    ),
    document(
      now,
      3,
      "demo-fractions",
      "lesson",
      "Fractions of amounts",
      6,
      "playground",
      "Maths",
      "Year 4",
    ),
    document(now, 12, "roman-roads", "lesson", "Roman roads", 8, "paper", "History", "Year 4"),
    document(
      now,
      30,
      "roman-army",
      "lesson",
      "Life in the Roman army",
      7,
      "slate",
      "History",
      "Year 4",
    ),
    document(
      now,
      72,
      "roman-empire",
      "lesson",
      "The Roman Empire",
      6,
      "ember",
      "History",
      "Year 4",
    ),
    document(
      now,
      120,
      "equivalent-fractions",
      "lesson",
      "Equivalent fractions",
      6,
      "meadow",
      "Maths",
      "Year 4",
    ),
    document(
      now,
      216,
      "plant-parts",
      "lesson",
      "Parts of a flowering plant",
      7,
      "chalk",
      "Science",
      "Year 3",
    ),
    document(
      now,
      384,
      "fronted-adverbials",
      "lesson",
      "Fronted adverbials",
      6,
      "paper",
      "English",
      "Year 5",
    ),
    document(
      now,
      600,
      "rivers",
      "lesson",
      "How rivers shape the land",
      8,
      "meadow",
      "Geography",
      "Year 5",
    ),
    document(now, 960, "electricity", "lesson", "Simple circuits", 7, "slate", "Science", "Year 6"),
    document(
      now,
      48,
      "fraction-practice",
      "worksheet",
      "Fractions practice",
      4,
      "playground",
      "Maths",
      "Year 4",
    ),
    document(
      now,
      168,
      "roman-source",
      "worksheet",
      "Roman source investigation",
      5,
      "ember",
      "History",
      "Year 4",
    ),
    document(
      now,
      480,
      "plant-labels",
      "worksheet",
      "Label a flowering plant",
      4,
      "chalk",
      "Science",
      "Year 3",
    ),
    document(
      now,
      840,
      "river-vocabulary",
      "worksheet",
      "River vocabulary",
      6,
      "paper",
      "Geography",
      "Year 5",
    ),
  ];

  const series = [
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

  return { documents, series };
}
