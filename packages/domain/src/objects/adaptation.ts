import { z } from "zod";
import { AdaptationId } from "../ids";
import { workspaceOwnedFields } from "./base";

// Filled by F10 (Adaptation)
//
// Proposed and accepted changes to upcoming Lessons derived from Observations.
export const Adaptation = z.strictObject({
  id: AdaptationId,
  ...workspaceOwnedFields,
});
export type Adaptation = z.infer<typeof Adaptation>;
