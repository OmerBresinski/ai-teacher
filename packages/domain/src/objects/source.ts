import { z } from "zod";
import { SourceId } from "../ids";
import { workspaceOwnedFields } from "./base";

// Filled by F03 (Sources)
//
// A teacher-provided material (file/URL) used for grounding. Files live in object storage under a
// key built with `storageKey(workspaceId, "sources", ...)` (ADR 0011).
export const Source = z.strictObject({
  id: SourceId,
  ...workspaceOwnedFields,
});
export type Source = z.infer<typeof Source>;
