import { z } from "zod";
import { CohortProfileId } from "../ids";
import { workspaceOwnedFields } from "./base";

// Filled by F02 (Cohort Profile)
//
// Class-level description of who is being taught; never individual. No field on this object may
// ever identify a learner (Master PRD principle 2, F15-R03 identifier guard).
export const CohortProfile = z.strictObject({
  id: CohortProfileId,
  ...workspaceOwnedFields,
});
export type CohortProfile = z.infer<typeof CohortProfile>;
