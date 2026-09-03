import { z } from "zod";
import { ConceptId } from "../ids";
import { workspaceOwnedFields } from "./base";

// Filled by F04/F05 (Knowledge Layer: Progressions and Misconceptions Graph)
//
// A unit of understanding with prerequisites, objectives and typical misconceptions; a node in a
// Journey's Progression (ordered DAG).
export const Concept = z.strictObject({
  id: ConceptId,
  ...workspaceOwnedFields,
});
export type Concept = z.infer<typeof Concept>;
