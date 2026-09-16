import { defineJob, type JobRegistry, NonRetryableError } from "@tj/jobs";
import type { WorkerDeps } from "../deps";
import { aiPingJob } from "./ai-ping";
import { lessonCascadeJob } from "./lesson-cascade";
import { lessonPlanJob } from "./lesson-plan";
import { lessonRegenerateJob } from "./lesson-regenerate";
import { pingJob } from "./ping";

/**
 * Placeholder for a job whose contract landed before its handler (TEACH-311): `lesson.generate`
 * arrives with TEACH-13 and `lesson.worksheet` with TEACH-14. Nothing enqueues either yet.
 */
const notImplemented = <K extends "lesson.generate" | "lesson.worksheet">(name: K) =>
  defineJob<K, WorkerDeps>(name, async () => {
    throw new NonRetryableError(`${name} is not implemented (TEACH-311)`);
  });

/** Every `JobName` needs a handler here; a missing key is a compile error (`JobRegistry`). */
export const registry: JobRegistry<WorkerDeps> = {
  ping: pingJob,
  "ai.ping": aiPingJob,
  "lesson.plan": lessonPlanJob,
  "lesson.cascade": lessonCascadeJob,
  "lesson.regenerate": lessonRegenerateJob,
  "lesson.generate": notImplemented("lesson.generate"),
  "lesson.worksheet": notImplemented("lesson.worksheet"),
};
