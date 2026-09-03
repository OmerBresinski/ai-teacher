import { z } from "zod";
import { WorkspaceId } from "../ids";
import { IsoDateTime } from "../primitives";

// Filled by F17 (Workspace Accounts, Plans and Billing)
//
// The container for a user's Journeys, Sources and settings. One personal Workspace per user at
// MVP. This is the tenant root, so it is the only core object without a `workspaceId`.
// Display name, plan, members and policies are F17 fields — not defined here.
export const Workspace = z.strictObject({
  id: WorkspaceId,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Workspace = z.infer<typeof Workspace>;
