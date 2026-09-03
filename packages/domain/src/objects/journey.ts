import { z } from "zod";
import { JourneyId } from "../ids";
import { workspaceOwnedFields } from "./base";

// Filled by F01 (Journey Intake & Goal Capture)
//
// The central object: a typed, versioned plan to take a Cohort from current state to an outcome
// over N Lessons. `version` increments on every accepted change (Master PRD §14, Flow 10).
export const Journey = z.strictObject({
  id: JourneyId,
  ...workspaceOwnedFields,
  version: z.number().int().nonnegative(),
});
export type Journey = z.infer<typeof Journey>;
