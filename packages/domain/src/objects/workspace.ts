import { z } from "zod";
import { WorkspaceId } from "../ids";
import { IsoDateTime } from "../primitives";

// Filled by F17 (Workspace Accounts, Plans and Billing)
//
// The container for a user's Journeys, Sources and settings. One personal Workspace per user at
// MVP. This is the tenant root, so it is the only core object without a `workspaceId`.
export const Workspace = z.strictObject({
  id: WorkspaceId,
  name: z.string(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Workspace = z.infer<typeof Workspace>;
