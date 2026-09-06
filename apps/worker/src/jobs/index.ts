import type { JobRegistry } from "@tj/jobs";
import type { WorkerDeps } from "../deps";
import { aiPingJob } from "./ai-ping";
import { lessonPlanJob } from "./lesson-plan";
import { pingJob } from "./ping";

/** Every `JobName` needs a handler here; a missing key is a compile error (`JobRegistry`). */
export const registry: JobRegistry<WorkerDeps> = {
  ping: pingJob,
  "ai.ping": aiPingJob,
  "lesson.plan": lessonPlanJob,
};
