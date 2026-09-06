import { impactSet } from "@tj/generation";
import { defineJob } from "@tj/jobs";
import type { WorkerDeps } from "../deps";
import { loadLessonForProposals, runProposalJob } from "./proposals";

/**
 * `lesson.cascade` (ADR 0025 §18): a fact changed. Every AI-authored element or block whose
 * `generatedFrom.factRefs` names one of `changedFactIds` is re-derived and returned as a
 * proposal; teacher-authored ones come back `flagged` for F07. No lock, no write.
 */
export const lessonCascadeJob = defineJob<"lesson.cascade", WorkerDeps>(
  "lesson.cascade",
  async (ctx) => {
    const loaded = await loadLessonForProposals(ctx.deps, ctx.workspaceId, ctx.payload.lessonId);
    const { redo, flagged } = impactSet(
      loaded.lesson,
      loaded.worksheet,
      ctx.payload.changedFactIds,
    );
    return runProposalJob(ctx, "lesson.cascade", loaded, redo, flagged, {
      changedFactIds: ctx.payload.changedFactIds,
    });
  },
);
