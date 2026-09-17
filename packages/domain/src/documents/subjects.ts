import { z } from "zod";

/*
 * The subjects and year groups the brief form offers (F01; moved from `apps/web/src/lib/brief-form.ts`
 * for TEACH-16 so `POST /briefs/parse` and its rules read the same lists the form shows). The web
 * appends its own "Other…" affordance to the subjects; that entry is a form control, not a value
 * a lesson can carry, so it lives there. England's year-group labels (TeachDeck `year-groups.ts`
 * plus Reception); the label is what is stored.
 */

export const SUBJECTS = [
  "English",
  "Maths",
  "Science",
  "History",
  "Geography",
  "Art and design",
  "Computing",
  "Design and technology",
  "Languages",
  "Music",
  "PE",
  "PSHE",
  "RE",
] as const;
export type Subject = (typeof SUBJECTS)[number];
export const SubjectSchema = z.enum(SUBJECTS);

export const YEAR_GROUPS: readonly string[] = [
  "Reception",
  ...Array.from({ length: 13 }, (_, i) => `Year ${i + 1}`),
];
