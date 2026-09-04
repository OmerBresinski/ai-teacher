import type { JobRegistry } from "@tj/jobs";
import { pingJob } from "./ping";

/** Every `JobName` needs a handler here; a missing key is a compile error (`JobRegistry`). */
export const registry: JobRegistry = {
  ping: pingJob,
};
