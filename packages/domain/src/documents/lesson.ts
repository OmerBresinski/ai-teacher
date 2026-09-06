import { z } from "zod";
import { type Brief, BriefSchema } from "./brief";
import { type Generation, GenerationSchema } from "./generation";
import { type LessonFacts, LessonFactsSchema } from "./lesson-facts";
import { DocumentParseError, describeIssues, migrate } from "./migrate";
import { type Id, type Slide, SlideSchema } from "./slide";
import { type SourceRef, SourceRefSchema } from "./source-ref";

/*
 * Lesson document (ADR 0021). Behavioural reference: TeachDeck `lib/model/types.ts:37-66` and
 * `lib/model/schema.ts:252,325-346,490-511`. Product-only optional fields are added —
 * `reachedSlideId` and `taughtAt` for TD item 5, `brief` for F01 (ADR 0024 §1), `facts`,
 * `generation`, `artefacts` and `sources` for F06 (ADR 0025 §1, §3, §4, §20); everything else
 * is TeachDeck's shape, so its JSON files parse unchanged.
 */

export type AgeBand = "eyfs" | "ks1" | "ks2" | "ks3" | "ks4" | "post16";

export type Lesson = {
  version: 1;
  id: Id;
  title: string;
  themeId: string;
  slides: Slide[];
  createdAt: string; // ISO
  updatedAt: string; // ISO
  /**
   * The `FIT_VERSION` (editor `model/themes.ts`) the slides were last laid out under. Missing
   * or behind means the projector floors have moved since, and the editor re-fits the slides
   * its linter flags when the lesson is opened (ADR 0021 §3).
   */
  fitVersion?: number;
  /** Set when duplicated from a shared lesson (Chalkie "remix"). */
  remixedFrom?: Id;
  /** Free text shown on the library card. */
  subject?: string;
  ageBand?: AgeBand;
  /** What the teacher chose, e.g. "Year 5" or "EYFS"; ageBand is derived from it. */
  yearGroup?: string;
  /** The reading age the copy is pitched at, e.g. "Year 4". Blank means the year group. */
  readingLevel?: string;
  /** BCP-47 tag for spellcheck and hyphenation; "en-GB" unless the teacher says otherwise. */
  language?: string;
  /**
   * TD item 5 (ADR 0021 §4): the furthest slide shown in present mode, written on exit. Optional
   * so no stored lesson needs a migration.
   */
  reachedSlideId?: Id;
  /** TD item 5 (ADR 0021 §4): ISO time present mode exited past slide 1; unset until then. */
  taughtAt?: string;
  /**
   * F01 (ADR 0024 §1): what the teacher stated before generation. Optional so a TeachDeck file
   * without one is still a valid document; `subject` / `yearGroup` above stay canonical.
   */
  brief?: Brief;
  /** F06 (ADR 0025 §1): the facts every slide and block is derived from. */
  facts?: LessonFacts;
  /** F06 (ADR 0025 §3): the `lesson.plan` job's checkpoint, usage and residual findings. */
  generation?: Generation;
  /** F06 (ADR 0025 §4): the worksheet row generated beside this lesson. */
  artefacts?: LessonArtefacts;
  /** F03 (ADR 0025 §20): references to the teacher's source materials; never their text. */
  sources?: SourceRef[];
};

export type LessonArtefacts = { worksheetId: Id };

export const LessonArtefactsSchema = z.strictObject({ worksheetId: z.string() });

export const AgeBandSchema = z.enum(["eyfs", "ks1", "ks2", "ks3", "ks4", "post16"]);

export const LessonSchema = z.object({
  version: z.literal(1),
  id: z.string(),
  title: z.string(),
  themeId: z.string(),
  slides: z.array(SlideSchema),
  // Defaulted, not optional: a lesson written before the field existed still has a date to show
  // in the info popover, and the rest of the code reads it without a fallback.
  createdAt: z.string().default(() => new Date().toISOString()),
  updatedAt: z.string(),
  // Which projector-floor table the layout was fitted to. Defaulted to 0 rather than the current
  // version: a document written before the field existed was laid out under floors we no longer
  // use, so it has to read as behind and get re-fitted when it is opened.
  fitVersion: z.number().int().nonnegative().default(0),
  remixedFrom: z.string().optional(),
  subject: z.string().optional(),
  ageBand: AgeBandSchema.optional(),
  yearGroup: z.string().optional(),
  readingLevel: z.string().optional(),
  language: z.string().optional(),
  // TD item 5 (ADR 0021 §4).
  reachedSlideId: z.string().optional(),
  taughtAt: z.string().optional(),
  // F01 (ADR 0024 §1).
  brief: BriefSchema.optional(),
  // F06 (ADR 0025 §1, §3, §4) and F03 (§20).
  facts: LessonFactsSchema.optional(),
  generation: GenerationSchema.optional(),
  artefacts: LessonArtefactsSchema.optional(),
  sources: z.array(SourceRefSchema).optional(),
});

export function parseLesson(input: unknown): Lesson {
  const result = LessonSchema.safeParse(migrate(input));
  if (!result.success) throw new DocumentParseError(describeIssues(result.error, "lesson"));
  return result.data as Lesson;
}

export function isLesson(input: unknown): input is Lesson {
  return LessonSchema.safeParse(input).success;
}
