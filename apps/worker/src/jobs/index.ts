import type { JobRegistry } from "@tj/jobs";
import type { WorkerDeps } from "../deps";
import { aiPingJob } from "./ai-ping";
import { lessonCascadeJob } from "./lesson-cascade";
import { lessonGenerateJob } from "./lesson-generate";
import { lessonPlanJob } from "./lesson-plan";
import { lessonRegenerateJob } from "./lesson-regenerate";
import { lessonWorksheetJob } from "./lesson-worksheet";
import { pingJob } from "./ping";

/** Every `JobName` needs a handler here; a missing key is a compile error (`JobRegistry`). */
export const registry: JobRegistry<WorkerDeps> = {
  ping: pingJob,
  "ai.ping": aiPingJob,
  "lesson.plan": lessonPlanJob,
  "lesson.cascade": lessonCascadeJob,
  "lesson.regenerate": lessonRegenerateJob,
  "lesson.generate": lessonGenerateJob,
  "lesson.worksheet": lessonWorksheetJob,
};
