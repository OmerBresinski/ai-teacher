import type { QueryClient } from "@tanstack/react-query";
import {
  type ClassContext,
  type CreateLessonInput,
  CreateLessonSchema,
  findNamePatterns,
  lessonFromBrief,
  NEED_CATEGORIES,
  type NeedCategory,
  type SizeBand,
} from "@tj/domain/documents";
import {
  CONFIDENCE_QUESTION,
  confidenceOptions,
  OBJECTIVE_QUESTION,
  objectiveOptions,
  shouldAskQuestions,
} from "./brief-questions";
import { LIBRARY_THEMES } from "./library-themes";
import { queryKeys } from "./query";

/*
 * The lesson brief's form model (F01 item 2, TEACH-122): the controlled state the page holds,
 * the pure mapping from it to the `POST /lessons` request, and the cache seed that makes
 * `/l/$lessonId` paint before the server is asked. No React here; `lesson-brief.page.tsx` renders
 * it and `lesson-brief.page.test.tsx` asserts the request shapes through the page.
 */

/** England's labels (TeachDeck `year-groups.ts` plus Reception); the label is what is stored. */
export const YEAR_GROUPS = ["Reception", ...Array.from({ length: 13 }, (_, i) => `Year ${i + 1}`)];
export const OTHER_SUBJECT = "Other…";
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
  OTHER_SUBJECT,
];
export const SIZE_BAND_LABELS: Record<SizeBand, string> = {
  under15: "Under 15",
  "15to24": "15–24",
  "25to30": "25–30",
  over30: "Over 30",
};
export const NEED_LABELS: Record<NeedCategory, string> = {
  send: "SEND",
  eal: "EAL",
  higherAttaining: "Higher attaining",
  lowerAttaining: "Lower attaining",
  other: "Other",
};

/** One clarifying question's state: which option, or skipped. */
export type Answer = { skipped: boolean; index: number };
export const DEFAULT_ANSWER: Answer = { skipped: false, index: 0 };

export type BriefState = {
  topic: string;
  subject: string;
  subjectOther: string;
  yearGroup: string;
  duration: string;
  themeId: string;
  classOpen: boolean;
  sizeBand: SizeBand | "";
  needs: Partial<Record<NeedCategory, string>>;
  priorKnowledge: string;
  notes: string;
  objective: Answer;
  confidence: Answer;
};

export const INITIAL_BRIEF: BriefState = {
  topic: "",
  subject: "",
  subjectOther: "",
  yearGroup: "",
  duration: "",
  themeId: LIBRARY_THEMES[0]?.id ?? "chalk",
  classOpen: false,
  sizeBand: "",
  needs: {},
  priorKnowledge: "",
  notes: "",
  objective: DEFAULT_ANSWER,
  confidence: DEFAULT_ANSWER,
};

/** The free-text fields the identifier guard watches, with the state key each reads. */
export const GUARDED_FIELDS = ["topic", "priorKnowledge", "notes"] as const;
export type GuardedField = (typeof GUARDED_FIELDS)[number];

/** Whether any free-text field holds an identifier the guard refuses. */
export function hasGuardHits(state: BriefState): boolean {
  return GUARDED_FIELDS.some((field) => findNamePatterns(state[field]).length > 0);
}

function trimmedOrUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** The class context the form describes, or `undefined` when every field is untouched. */
function classContextOf(state: BriefState): ClassContext | undefined {
  const needs: Partial<Record<NeedCategory, number>> = {};
  for (const category of NEED_CATEGORIES) {
    const raw = (state.needs[category] ?? "").trim();
    if (raw !== "") needs[category] = Number(raw);
  }
  const context: ClassContext = {};
  if (state.sizeBand) context.sizeBand = state.sizeBand;
  if (Object.keys(needs).length > 0) context.needs = needs;
  const prior = trimmedOrUndefined(state.priorKnowledge);
  if (prior !== undefined) context.priorKnowledge = prior;
  const notes = trimmedOrUndefined(state.notes);
  if (notes !== undefined) context.notes = notes;
  return Object.keys(context).length > 0 ? context : undefined;
}

/** What `POST /lessons` receives, exactly (TEACH-122 acceptance: no `durationMin` unless typed). */
export function briefInputOf(state: BriefState): CreateLessonInput {
  const topic = state.topic.trim();
  const brief: CreateLessonInput["brief"] = { topic };
  if (state.duration.trim() !== "") brief.durationMin = Number(state.duration);
  const classContext = classContextOf(state);
  if (classContext) brief.classContext = classContext;
  if (shouldAskQuestions(topic)) {
    const answers: Record<string, string> = {};
    if (!state.objective.skipped) {
      const option = objectiveOptions(topic)[state.objective.index];
      if (option) answers[OBJECTIVE_QUESTION.id] = option.value;
    }
    if (!state.confidence.skipped) {
      const option = confidenceOptions()[state.confidence.index];
      if (option) answers[CONFIDENCE_QUESTION.id] = option.value;
    }
    if (Object.keys(answers).length > 0) brief.answers = answers;
  }
  const subject =
    state.subject === OTHER_SUBJECT
      ? trimmedOrUndefined(state.subjectOther)
      : state.subject || undefined;
  const input: CreateLessonInput = { brief, themeId: state.themeId };
  if (subject !== undefined) input.subject = subject;
  if (state.yearGroup) input.yearGroup = state.yearGroup;
  return input;
}

/**
 * Put the lesson `POST /lessons` just created into the cache before navigating to it, so
 * `/l/$lessonId` paints the generating view at once instead of after a cold `GET`. The body is the
 * same `lessonFromBrief` the API built (ADR 0024 §6: pure, shared defaults), locked by the job.
 * The entry is then marked stale so the page reconciles with the row — its real timestamps, and
 * any slide the worker has already written — in the background.
 */
export function seedGeneratingLesson(
  queryClient: QueryClient,
  input: CreateLessonInput,
  ids: { lessonId: string; jobId: string },
): void {
  const now = new Date();
  const lesson = lessonFromBrief(CreateLessonSchema.parse(input), ids.lessonId, now);
  const at = now.toISOString();
  queryClient.setQueryData(queryKeys.libraryDocument(ids.lessonId), lesson);
  queryClient.setQueryData(queryKeys.libraryDocumentMeta(ids.lessonId), {
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
    generatingJobId: ids.jobId,
  });
  void queryClient.invalidateQueries({
    queryKey: queryKeys.libraryDocument(ids.lessonId),
    refetchType: "none",
  });
}
