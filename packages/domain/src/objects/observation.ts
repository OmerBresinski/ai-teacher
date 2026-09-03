import { z } from "zod";
import { ObservationId } from "../ids";
import { workspaceOwnedFields } from "./base";

// Filled by F09 (Assessment and Observation Capture)
//
// Class-level evidence of understanding recorded after teaching a Lesson. Aggregated before
// persistence; never a per-learner record.
export const Observation = z.strictObject({
  id: ObservationId,
  ...workspaceOwnedFields,
});
export type Observation = z.infer<typeof Observation>;
