import { createBudget, isAiError } from "@tj/ai";
import { forWorkspace, getDocument } from "@tj/db";
import type { JobResult, LessonId, ProposalTarget, WorkspaceId } from "@tj/domain";
import {
  type Lesson,
  parseLesson,
  parseStoredWorksheet,
  type Worksheet,
} from "@tj/domain/documents";
import { type PipelineDeps, type ProposeContext, proposeFor } from "@tj/generation";
import { type JobContext, NonRetryableError } from "@tj/jobs";
import { uid } from "@tj/slides";
import type { WorkerDeps } from "../deps";

/*
 * What `lesson.cascade` and `lesson.regenerate` share (ADR 0025 §18, §19): read the lesson and
 * its worksheet, re-derive the targets with `@tj/generation`, return the proposals on the
 * `completed` event. No generating lock is taken and nothing is written — the editor applies the
 * result as one undo transaction. A budget stop returns what was done so far; a cancel returns
 * nothing (`runJob` records `cancelled`).
 */

export interface LoadedLesson {
  lesson: Lesson;
  worksheet: Worksheet | undefined;
}

/** The lesson row (and its worksheet when linked) or a `NonRetryableError`; never a lock check. */
export async function loadLessonForProposals(
  deps: WorkerDeps,
  workspaceId: WorkspaceId,
  lessonId: LessonId,
): Promise<LoadedLesson> {
  const ws = forWorkspace(deps.db, workspaceId);
  const row = await getDocument(ws, lessonId);
  if (row === null || row.kind !== "lesson") throw new NonRetryableError("lesson missing");
  const lesson = parseLesson(row.body);
  if (!lesson.facts) throw new NonRetryableError("lesson has no facts to derive from");
  const worksheetId = lesson.artefacts?.worksheetId;
  const worksheetRow = worksheetId ? await getDocument(ws, worksheetId) : null;
  const worksheet =
    worksheetRow !== null && worksheetRow.kind === "worksheet"
      ? parseStoredWorksheet(worksheetRow.body)
      : undefined;
  return { lesson, worksheet };
}

type ProposalJobContext = Pick<
  JobContext<"lesson.cascade" | "lesson.regenerate", WorkerDeps>,
  "jobId" | "workspaceId" | "signal" | "progress" | "deps" | "logger"
> & { payload: { lessonId: LessonId } };

/**
 * Run one proposal job: `targets` is the impact set (cascade) or the request (regenerate);
 * `flagged` is whatever the caller already decided not to re-derive.
 */
export async function runProposalJob<J extends JobResult["job"]>(
  ctx: ProposalJobContext,
  job: J,
  loaded: LoadedLesson,
  targets: readonly ProposalTarget[],
  flagged: readonly ProposalTarget[],
  context: Omit<ProposeContext, "lesson" | "worksheet">,
): Promise<Extract<JobResult, { job: J }> | undefined> {
  const { deps, signal, logger, jobId, workspaceId } = ctx;
  if (deps.ai.kind === "unconfigured") {
    throw new NonRetryableError("AI provider is not configured (AWS_BEARER_TOKEN_BEDROCK unset)");
  }
  await ctx.progress(10, "Working out what changes");
  if (signal.aborted) return undefined;
  const pipelineDeps: PipelineDeps = {
    ai: deps.ai,
    budget: createBudget(deps.caps),
    signal,
    logger,
    now: () => new Date(),
    ids: uid,
    sources: deps.sources,
    // Proposal jobs never write; these are unreachable by construction (`proposeFor` calls neither).
    persist: async () => {
      throw new Error("proposal jobs do not persist");
    },
    onProgress: async () => {},
    context: { lessonId: ctx.payload.lessonId, jobId },
  };
  let result: Awaited<ReturnType<typeof proposeFor>>;
  try {
    result = await proposeFor(targets, { ...context, ...loaded }, pipelineDeps);
  } catch (error) {
    if (signal.aborted) return undefined;
    if (isAiError(error, "unconfigured") || isAiError(error, "invalid_model")) {
      throw new NonRetryableError(error.message);
    }
    throw error;
  }
  if (result.stoppedBy) {
    logger.info(
      {
        lessonId: ctx.payload.lessonId,
        jobId,
        workspaceId,
        by: result.stoppedBy,
        done: result.proposals.length,
      },
      "proposal job stopped at the budget cap; returning what was derived",
    );
  }
  logger.info(
    {
      lessonId: ctx.payload.lessonId,
      jobId,
      proposals: result.proposals.length,
      flagged: flagged.length,
      targets: targets.length,
    },
    "proposals ready",
  );
  return { job, proposals: result.proposals, flagged: [...flagged] } as Extract<
    JobResult,
    { job: J }
  >;
}
