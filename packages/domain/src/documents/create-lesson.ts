import { z } from "zod";
import { BRIEF_DURATION_MAX, BRIEF_DURATION_MIN, BriefSchema, DEFAULT_SLIDE_COUNT } from "./brief";
import { guarded } from "./identifier-guard";
import { type AgeBand, AgeBandSchema, type Lesson, parseLesson } from "./lesson";
import { FactIdSchema } from "./lesson-facts";
import { DEFAULT_THEME_ID } from "./theme";

/*
 * `POST /lessons` request and its defaults (ADR 0024 §6, §13; F01 item 2), and the plan screen's
 * `/plan` and `/generate` requests (ADR 0029), so `@tj/api-client` types them. Kept apart from
 * `brief.ts` because it needs `AgeBandSchema` from `lesson.ts`, which itself imports `BriefSchema`.
 */

const DurationMinSchema = z.number().int().min(BRIEF_DURATION_MIN).max(BRIEF_DURATION_MAX);
const SubjectSchema = z.string().max(80);
const YearGroupSchema = z.string().max(40);
/** ADR 0027 §5: a lesson holds at most three Sources. */
const SourceIdsSchema = z.array(z.uuid()).max(3);

/**
 * The request `POST /lessons` accepts and the brief screen submits: the brief (duration optional,
 * defaulted by key stage) plus the canonical Lesson fields the teacher may set, and up to three
 * `sourceIds` — Sources uploaded through `POST /sources` that the route binds to the new lesson
 * (ADR 0027 §5). Strict. Lives here so the form and the API share one schema and one guard
 * message (F01 item 1).
 */
export const CreateLessonSchema = z.strictObject({
  brief: BriefSchema.omit({ durationMin: true }).extend({
    durationMin: DurationMinSchema.optional(),
  }),
  subject: SubjectSchema.optional(),
  yearGroup: YearGroupSchema.optional(),
  ageBand: AgeBandSchema.optional(),
  readingLevel: z.string().max(40).optional(),
  language: z.string().max(16).optional(),
  themeId: z.string().optional(),
  sourceIds: SourceIdsSchema.optional(),
  /**
   * ADR 0029 item 1: run the whole pipeline in one job, without stopping at the plan screen.
   * The plan is written as `confirmed` up front and the row's `continue_when_planned` is set.
   */
  skipPlanning: z.boolean().optional(),
  /**
   * ADR 0029 item 11: a client-minted id; a repeat in the same Workspace answers the lesson the
   * first call created instead of creating (and paying for) a second one.
   */
  requestId: z.uuid().optional(),
});
export type CreateLesson = z.infer<typeof CreateLessonSchema>;
export type CreateLessonInput = z.input<typeof CreateLessonSchema>;

/**
 * `POST /lessons/:id/plan` (ADR 0029 items 4, 7, 12): re-plan the proposal the teacher is looking
 * at. `expectedRevision` is the `Lesson.plan.revision` the screen shows; the brief fields sent
 * replace the stored ones, and `sourceIds`, when present, is the lesson's whole new Source list.
 */
export const PlanLessonSchema = z.strictObject({
  expectedRevision: z.number().int().min(0),
  brief: BriefSchema.pick({
    topic: true,
    classContext: true,
    slideCount: true,
    level: true,
  }).extend({ durationMin: DurationMinSchema.optional() }),
  yearGroup: YearGroupSchema.optional(),
  subject: SubjectSchema.optional(),
  sourceIds: SourceIdsSchema.optional(),
});
export type PlanLesson = z.infer<typeof PlanLessonSchema>;
export type PlanLessonInput = z.input<typeof PlanLessonSchema>;

/** How many objectives the plan screen may confirm (the objectives slide shows four). */
export const MAX_CONFIRMED_OBJECTIVES = 4;
export const OBJECTIVE_TEXT_MAX = 300;

/**
 * `POST /lessons/:id/generate` (ADR 0029 items 7, 8): confirm the plan at `expectedRevision` with
 * the teacher's objectives (up to four; an existing `id` keeps that objective, none adds one)
 * and, optionally, a new deck length or duration. What the edit does is `applyObjectiveEdits`'s
 * call.
 */
export const GenerateLessonSchema = z.strictObject({
  expectedRevision: z.number().int().min(0),
  objectives: z
    .array(
      z.strictObject({
        id: FactIdSchema.optional(),
        text: guarded(z.string().trim().min(1).max(OBJECTIVE_TEXT_MAX)),
      }),
    )
    // No `.min(1)`: an empty list is well-formed but cannot be confirmed — the route answers 422
    // (TDD T4), not the 400 a malformed body gets.
    .max(MAX_CONFIRMED_OBJECTIVES),
  slideCount: BriefSchema.shape.slideCount,
  durationMin: DurationMinSchema.optional(),
});
export type GenerateLesson = z.infer<typeof GenerateLessonSchema>;
export type GenerateLessonInput = z.input<typeof GenerateLessonSchema>;

/** `Lesson.title` is the topic, cut to this many characters. */
export const LESSON_TITLE_MAX = 80;

/**
 * The key stage a year-group label implies (England): Reception / Nursery / EYFS → `eyfs`,
 * Year 1–2 → `ks1`, 3–6 → `ks2`, 7–9 → `ks3`, 10–11 → `ks4`, 12–13 → `post16`. Anything else
 * (blank, "Mixed", a Scottish P-level) is `undefined` and the caller leaves `ageBand` unset.
 */
export function deriveAgeBand(yearGroup: string | undefined): AgeBand | undefined {
  if (yearGroup === undefined) return undefined;
  const label = yearGroup.trim().toLowerCase();
  if (label === "") return undefined;
  if (/^(reception|nursery|eyfs|early years)/.test(label)) return "eyfs";
  const year = yearNumberOf(yearGroup);
  if (year === undefined) return undefined;
  if (year >= 1 && year <= 2) return "ks1";
  if (year >= 3 && year <= 6) return "ks2";
  if (year >= 7 && year <= 9) return "ks3";
  if (year >= 10 && year <= 11) return "ks4";
  if (year >= 12 && year <= 13) return "post16";
  return undefined;
}

/**
 * The number in an England year-group label — "Year 9", "Y9", "yr 9" → 9, within Years 1–13;
 * Reception, EYFS, blank, "Mixed", a Scottish P-level or a year outside that range → `undefined`. The one place the label is parsed; `deriveAgeBand`
 * and the Plan model routing (`AI_PLAN_FRONTIER_FROM_YEAR`, TEACH-259) both read it.
 */
export function yearNumberOf(yearGroup: string | undefined): number | undefined {
  if (yearGroup === undefined) return undefined;
  const match = /^(?:year|yr|y)\s*(\d{1,2})\b/.exec(yearGroup.trim().toLowerCase());
  if (match === null) return undefined;
  const year = Number(match[1]);
  return year >= 1 && year <= 13 ? year : undefined;
}

/**
 * The lesson length a key stage usually gets, so generation can start with nothing but a topic
 * (F01 item 2). Unknown → an hour.
 */
export function defaultDurationMin(ageBand: AgeBand | undefined): number {
  switch (ageBand) {
    case "eyfs":
      return 30;
    case "ks1":
      return 45;
    default:
      return 60;
  }
}

/**
 * The empty lesson the brief becomes: canonical Lesson fields from the request, `ageBand` derived
 * from the year group when not given, `durationMin` defaulted by key stage, `slideCount` to
 * `DEFAULT_SLIDE_COUNT`, `title` from the topic.
 * Pure, so `POST /lessons`, the brief screen and the Studio entry all apply the same defaults.
 */
export function lessonFromBrief(input: CreateLesson, lessonId: string, now: Date): Lesson {
  const ageBand = input.ageBand ?? deriveAgeBand(input.yearGroup);
  const durationMin = input.brief.durationMin ?? defaultDurationMin(ageBand);
  const at = now.toISOString();
  return parseLesson({
    version: 1,
    id: lessonId,
    title: input.brief.topic.trim().slice(0, LESSON_TITLE_MAX),
    themeId: input.themeId ?? DEFAULT_THEME_ID,
    slides: [],
    createdAt: at,
    updatedAt: at,
    subject: input.subject,
    yearGroup: input.yearGroup,
    ageBand,
    readingLevel: input.readingLevel,
    language: input.language ?? "en-GB",
    brief: {
      ...input.brief,
      durationMin,
      slideCount: input.brief.slideCount ?? DEFAULT_SLIDE_COUNT,
    },
  });
}
