import { WorkspaceId } from "../ids";
import { IsoDateTime } from "../primitives";

/**
 * Ownership + audit fields shared by every workspace-owned object (everything in Master PRD §8
 * except Workspace itself). Spread into each object's `z.strictObject({...})` after `id`.
 *
 * `workspaceId` is the tenant key: every table built from these schemas is a "tenant table" and
 * must be queried through `forWorkspace()` (ADR 0007).
 */
export const workspaceOwnedFields = {
  workspaceId: WorkspaceId,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
} as const;
