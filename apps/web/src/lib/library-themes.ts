/**
 * The New dialog's theme picker: the editor's six themes (ADR 0021; the catalogue itself lives in
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
