import { defineJob } from "@tj/jobs";
import type { WorkerDeps } from "../deps";
import { loadLessonForProposals, runProposalJob } from "./proposals";

/**
 * `lesson.regenerate` (ADR 0025 §18): the teacher asked for named slides, elements or blocks
 * again, optionally with an instruction. Every target is re-derived, teacher-authored or not —
 * the editor asked first ("This slide has your edits. Replace them?"). No lock, no write.
 */
export const lessonRegenerateJob = defineJob<"lesson.regenerate", WorkerDeps>(
  "lesson.regenerate",
  async (ctx) => {
    const loaded = await loadLessonForProposals(ctx.deps, ctx.workspaceId, ctx.payload.lessonId);
    return runProposalJob(ctx, "lesson.regenerate", loaded, ctx.payload.targets, [], {
      instruction: ctx.payload.instruction,
    });
  },
);
