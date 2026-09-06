import type { Lesson } from "@tj/domain/documents";
import { type MaterialiseMeta, materialiseSlide } from "@tj/slides";
import { callStructured, MAX_OUTPUT_TOKENS } from "../call";
import { planPrompt } from "../prompts";
import { assignFactIds, PlanOutputSchema } from "../specs";
import type { PipelineDeps, PipelineState } from "../types";
import { audienceOf } from "./shared";

/*
 * Plan (ADR 0025 §1, §7, §13): one `standard` call turns the Brief into `LessonFacts`; the
 * `title` and `objectives` slides are then materialised from the facts without a model call so
 * the first slide is visible early. Writes `generation` at stage `planned` and persists once.
 */

export async function plan(state: PipelineState, deps: PipelineDeps): Promise<PipelineState> {
  const { lesson } = state;
  const brief = lesson.brief;
  if (!brief) throw new Error("plan: the lesson has no brief");
  const startedAt = deps.now().toISOString();
  const sourceTexts = lesson.sources ? await deps.sources(lesson.sources) : [];

  const call = await callStructured({
    deps,
    stage: "plan",
    cls: "standard",
    prompt: planPrompt,
    input: {
      topic: brief.topic,
      durationMin: brief.durationMin,
      answers: brief.answers,
      audience: audienceOf(lesson),
      sourceTexts: sourceTexts.map((s) => ({ sourceId: s.sourceId, text: s.text })),
    },
    schema: PlanOutputSchema,
    maxOutputTokens: MAX_OUTPUT_TOKENS.plan,
  });

  const facts = assignFactIds(call.output, brief.durationMin);
  const meta: MaterialiseMeta = {
    promptVersion: planPrompt.version,
    model: call.modelId,
    at: deps.now().toISOString(),
  };
  const [titleEntry, objectivesEntry] = facts.outline;
  const title = materialiseSlide(
    {
      kind: "title",
      title: lesson.title,
      subtitle: [lesson.yearGroup, lesson.subject].filter(Boolean).join(" · ") || "Lesson",
      factRefs: titleEntry?.factRefs ?? [],
    },
    lesson.themeId,
    meta,
    deps.ids,
  );
  const objectives = materialiseSlide(
    {
      kind: "objectives",
      items: facts.objectives.slice(0, 4).map((o) => o.text),
      factRefs: objectivesEntry?.factRefs.length
        ? objectivesEntry.factRefs
        : facts.objectives.map((o) => o.id),
    },
    lesson.themeId,
    meta,
    deps.ids,
  );

  const next: Lesson = {
    ...lesson,
    facts,
    slides: [title, objectives],
    generation: {
      jobId: deps.context.jobId,
      stage: "planned",
      startedAt,
      promptVersions: { planned: planPrompt.version },
      // The budget is per job, so its totals are the job's usage so far (every stage refreshes).
      usage: deps.budget.totals(),
      findings: [],
    },
  };
  const { updatedAt } = await deps.persist(next);
  await deps.onProgress(10, "Planned", updatedAt);
  return { ...state, lesson: next };
}
