import { z } from "zod";
import { BRIEF_DURATION_MAX, BRIEF_DURATION_MIN, BriefSchema } from "./brief";
import { type AgeBand, AgeBandSchema, type Lesson, parseLesson } from "./lesson";
import { DEFAULT_THEME_ID } from "./theme";

/*
 * `POST /lessons` request and its defaults (ADR 0024 §6, §13; F01 item 2). Kept apart from
 * `brief.ts` because it needs `AgeBandSchema` from `lesson.ts`, which itself imports `BriefSchema`.
 */

/**
 * The request `POST /lessons` accepts and the brief screen submits: the brief (duration optional,
 * defaulted by key stage) plus the canonical Lesson fields the teacher may set. Strict, so a
 * `sourceIds` key is rejected until F03 adds it (§13). Lives here so the form and the API share
 * one schema and one guard message (F01 item 1).
 */
export const CreateLessonSchema = z.strictObject({
  brief: BriefSchema.omit({ durationMin: true }).extend({
    durationMin: z.number().int().min(BRIEF_DURATION_MIN).max(BRIEF_DURATION_MAX).optional(),
  }),
  subject: z.string().max(80).optional(),
  yearGroup: z.string().max(40).optional(),
  ageBand: AgeBandSchema.optional(),
  readingLevel: z.string().max(40).optional(),
  language: z.string().max(16).optional(),
  themeId: z.string().optional(),
});
export type CreateLesson = z.infer<typeof CreateLessonSchema>;
export type CreateLessonInput = z.input<typeof CreateLessonSchema>;

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
  const match = /^(?:year|yr|y)\s*(\d{1,2})\b/.exec(label);
  if (match === null) return undefined;
  const year = Number(match[1]);
  if (year >= 1 && year <= 2) return "ks1";
  if (year >= 3 && year <= 6) return "ks2";
  if (year >= 7 && year <= 9) return "ks3";
  if (year >= 10 && year <= 11) return "ks4";
  if (year >= 12 && year <= 13) return "post16";
  return undefined;
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
 * from the year group when not given, `durationMin` defaulted by key stage, `title` from the topic.
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
    brief: { ...input.brief, durationMin },
  });
}
