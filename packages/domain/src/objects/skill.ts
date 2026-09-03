import { z } from "zod";
import { SkillId } from "../ids";
import { workspaceOwnedFields } from "./base";

// Filled by F13 (Pedagogy Skills Runtime and Model Routing)
//
// A packaged pedagogical capability the runtime calls (unit planning, retrieval generation,
// differentiation, ...).
export const Skill = z.strictObject({
  id: SkillId,
  ...workspaceOwnedFields,
});
export type Skill = z.infer<typeof Skill>;
