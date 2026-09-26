/**
 * The body changes behind `POST /lessons/:id/plan` and `POST /lessons/:id/generate` (ADR 0029
 * items 3, 8; TDD §4.4), as pure functions over the lesson `setPlanRevisionAndLock` read under its
 * row lock. The routes own the compare-and-set, the lock and the enqueue; these only say what the
 * next body is. What an objective edit does to the facts is `applyObjectiveEdits`'s rule.
 *
 * Both clear `generation` whenever they reset the facts: a row must not claim a checkpoint it no
 * longer has, and the plan job then starts from the input check (`resumeFrom`).
 */
import type { JobId } from "@tj/domain";
import {
  applyObjectiveEdits,
  type Brief,
  defaultDurationMin,
  deriveAgeBand,
  type GenerateLesson,
  LESSON_TITLE_MAX,
  type Lesson,
  type LessonFacts,
  type PlanLesson,
  type SourceRef,
} from "@tj/domain/documents";

/** The facts a pinned re-plan starts from: the objectives, and nothing derived from them. */
export function pinnedFacts(facts: LessonFacts): LessonFacts {
  const { keyIdeas, ...rest } = facts;
  return {
    ...structuredClone(rest),
    ...(keyIdeas !== undefined ? { keyIdeas: [] } : {}),
    vocabulary: [],
    workedExamples: [],
    questions: [],
    misconceptions: [],
    outline: [],
  };
}

/** The lesson without its checkpoint; spread first so later fields can replace the rest. */
function withoutCheckpoint(lesson: Lesson): Omit<Lesson, "generation" | "facts"> {
  const { generation: _generation, facts: _facts, ...rest } = lesson;
  return rest;
}

export interface ReplanResult {
  lesson: Lesson;
  /** The objectives were kept: the plan job runs with `pinObjectives`. */
  pinned: boolean;
}

/**
 * `/plan`: the sent brief fields replace the stored ones, and the plan becomes revision + 1,
 * `proposed`, owned by `jobId`. A new topic or a new Source list is a fresh proposal (facts
 * cleared, edits discarded); anything else keeps the objectives and pins them. The slides are
 * dropped: Plan writes the title and objectives slides again from the new brief at once.
 * `sources` is the lesson's new Source list, or `undefined` when it did not change.
 */
export function replanLesson(
  lesson: Lesson,
  input: PlanLesson,
  { jobId, sources }: { jobId: JobId; sources?: SourceRef[] },
): ReplanResult {
  const topicChanged = input.brief.topic.trim() !== (lesson.brief?.topic ?? "").trim();
  const objectives = lesson.facts?.objectives ?? [];
  const pinned = !topicChanged && sources === undefined && objectives.length > 0;
  const yearGroup = input.yearGroup ?? lesson.yearGroup;
  const ageBand = input.yearGroup !== undefined ? deriveAgeBand(input.yearGroup) : lesson.ageBand;
  const brief: Brief = {
    ...lesson.brief,
    ...input.brief,
    durationMin:
      input.brief.durationMin ?? lesson.brief?.durationMin ?? defaultDurationMin(ageBand),
  };
  const next: Lesson = {
    ...withoutCheckpoint(lesson),
    title: topicChanged ? input.brief.topic.trim().slice(0, LESSON_TITLE_MAX) : lesson.title,
    yearGroup,
    ageBand,
    subject: input.subject ?? lesson.subject,
    brief,
    slides: [],
    ...(sources !== undefined ? { sources } : {}),
    plan: { revision: (lesson.plan?.revision ?? 0) + 1, state: "proposed", jobId },
  };
  if (pinned && lesson.facts) next.facts = pinnedFacts(lesson.facts);
  return { lesson: next, pinned };
}

export interface ConfirmResult {
  lesson: Lesson;
  /** A shape change: the plan job re-plans with the objectives pinned, then generates. */
  replan: boolean;
}

/**
 * `/generate` on a lesson at `planned` with facts: the teacher's objectives applied and the plan
 * `confirmed` for `jobId`. A text-only edit keeps the revision, the checkpoint and the slides —
 * `lesson.generate` re-materialises the objectives slide. Adding or removing an objective, or a
 * new deck length, is a pinned re-plan: revision + 1, outline emptied, checkpoint cleared. A new
 * duration is stored on the brief and re-plans nothing: a lesson's size is its slide count
 * (ruling 82). A lesson written before plans existed (revision 0) is confirmed as revision 1.
 */
export function confirmLesson(
  lesson: Lesson & { facts: LessonFacts },
  input: GenerateLesson,
  { jobId, now }: { jobId: JobId; now: Date },
): ConfirmResult {
  const edited = applyObjectiveEdits(lesson.facts, input.objectives);
  const brief = lesson.brief;
  const slideCountChanged =
    input.slideCount !== undefined && input.slideCount !== brief?.slideCount;
  const replan = edited.shapeChanged || slideCountChanged;
  const revision = lesson.plan?.revision ?? 0;
  const plan = {
    revision: replan || revision === 0 ? revision + 1 : revision,
    state: "confirmed" as const,
    jobId,
    confirmedAt: now.toISOString(),
  };
  const briefPatch = brief
    ? {
        brief: {
          ...brief,
          ...(input.slideCount !== undefined ? { slideCount: input.slideCount } : {}),
          ...(input.durationMin !== undefined ? { durationMin: input.durationMin } : {}),
        },
      }
    : {};
  // The stored duration follows the brief in both branches; nothing is re-planned for it.
  const withDuration = (facts: LessonFacts): LessonFacts =>
    input.durationMin !== undefined ? { ...facts, durationMin: input.durationMin } : facts;
  if (!replan) {
    return {
      lesson: { ...lesson, ...briefPatch, facts: withDuration(edited.facts), plan },
      replan,
    };
  }
  return {
    lesson: {
      ...withoutCheckpoint(lesson),
      facts: withDuration(edited.shapeChanged ? edited.facts : pinnedFacts(edited.facts)),
      ...briefPatch,
      slides: [],
      plan,
    },
    replan,
  };
}
