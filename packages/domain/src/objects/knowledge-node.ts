import { z } from "zod";
import { KnowledgeNodeId } from "../ids";
import { workspaceOwnedFields } from "./base";

// Filled by F05 (Knowledge Layer: Progressions and Misconceptions Graph)
//
// An entry in the progressions/misconceptions graph.
export const KnowledgeNode = z.strictObject({
  id: KnowledgeNodeId,
  ...workspaceOwnedFields,
});
export type KnowledgeNode = z.infer<typeof KnowledgeNode>;
