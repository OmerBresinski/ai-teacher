/**
 * The New dialog's theme picker: the editor's ten themes (ADR 0021; the catalogue itself lives in
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
    id: "chalk",
    name: "Chalk & Cream",
    swatch: "#FAF4E6",
    ink: "#2C2A24",
    tags: ["Primary", "Calm"],
  },
  {
    id: "playground",
    name: "Playground",
    swatch: "#FFF6DA",
    ink: "#2B2118",
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
    id: "splash",
    name: "Splash",
    swatch: "#EDF8FC",
    ink: "#10252F",
    tags: ["Primary", "Bold"],
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
    swatch: "#F4EFE6",
    ink: "#22201C",
    tags: ["Secondary", "Calm"],
  },
  {
    id: "studio",
    name: "Studio",
    swatch: "#F7F9FB",
    ink: "#0F172A",
    tags: ["Secondary", "Calm"],
  },
  {
    id: "exam-hall",
    name: "Exam Hall",
    swatch: "#FFFFFF",
    ink: "#111418",
    tags: ["Secondary", "Calm"],
  },
  {
    id: "night-lab",
    name: "Night Lab",
    swatch: "#131519",
    ink: "#ECEDEF",
    tags: ["Secondary", "Bold"],
  },
  {
    id: "beacon",
    name: "Beacon",
    swatch: "#FFFDF2",
    ink: "#0E0E0E",
    tags: ["Primary", "Bold"],
  },
];
