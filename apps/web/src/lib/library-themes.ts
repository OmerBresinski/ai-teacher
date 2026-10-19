/**
 * The New dialog's theme picker: the editor's sixteen themes (ADR 0021; the catalogue itself lives in
 * `@tj/slides`, and `library-themes.test.ts` checks this table agrees with it) with the shell's
 * own "Primary / Secondary / Calm / Bold" filter chips. A literal so the dialog's chunk does not
 * carry the catalogue.
 */
export type LibraryTheme = {
  id: string;
  name: string;
  swatch: string;
  ink: string;
  tags: string[];
};

export const LIBRARY_THEMES: LibraryTheme[] = [
  {
    id: "paper",
    name: "Paper",
    swatch: "#FFFAF4",
    ink: "#22152B",
    tags: ["Primary", "Secondary", "Calm"],
  },
  {
    id: "poster",
    name: "Poster",
    swatch: "#FFF4E2",
    ink: "#1B1B2F",
    tags: ["Primary", "Secondary", "Bold"],
  },
  {
    id: "treehouse",
    name: "Treehouse",
    swatch: "#F1F7EA",
    ink: "#1D291D",
    tags: ["Primary", "Calm"],
  },
  {
    id: "reading-room",
    name: "Reading Room",
    swatch: "#F8F8F5",
    ink: "#22201C",
    tags: ["Secondary", "Calm"],
  },
  {
    id: "storytime",
    name: "Storytime",
    swatch: "#FFFCF5",
    ink: "#1E2A3A",
    tags: [],
  },
  {
    id: "scrapbook",
    name: "Scrapbook",
    swatch: "#FBF8F1",
    ink: "#23201C",
    tags: ["Primary"],
  },
  {
    id: "calm",
    name: "Calm",
    swatch: "#F6F6F2",
    ink: "#1E2226",
    tags: ["Calm"],
  },
  {
    id: "geometric",
    name: "Geometric",
    swatch: "#FFFFFF",
    ink: "#0E1B33",
    tags: ["Secondary"],
  },
  {
    id: "beacon",
    name: "Beacon",
    swatch: "#FFFDF2",
    ink: "#0E0E0E",
    tags: ["Primary", "Bold"],
  },
  {
    id: "crayon",
    name: "Crayon Box",
    swatch: "#FFFDF7",
    ink: "#232120",
    tags: ["Primary", "Bold"],
  },
  {
    id: "exam-hall",
    name: "Exam Hall",
    swatch: "#FFFFFF",
    ink: "#111418",
    tags: ["Secondary", "Calm"],
  },
  {
    id: "playground",
    name: "Playground",
    swatch: "#FFF6DA",
    ink: "#2B2118",
    tags: ["Primary", "Bold"],
  },
  {
    id: "splash",
    name: "Splash",
    swatch: "#EDF8FC",
    ink: "#10252F",
    tags: ["Primary", "Bold"],
  },
  {
    id: "studio",
    name: "Studio",
    swatch: "#F7F9FB",
    ink: "#0F172A",
    tags: ["Secondary", "Calm"],
  },
  {
    id: "dark-slate",
    name: "Slate",
    swatch: "#1E232B",
    ink: "#E4E7EB",
    tags: [],
  },
  {
    id: "dark-ember",
    name: "Ember",
    swatch: "#1B1B1E",
    ink: "#EDEDEF",
    tags: [],
  },
];

/**
 * The New dialog's preselected theme. Named, not "first in the list": the list follows the
 * catalogue order (round 5 put Paper first, TEACH-215 part c), and the default stays as it was
 * until Greg decides otherwise.
 */
export const NEW_DIALOG_DEFAULT_THEME_ID = "playground";
