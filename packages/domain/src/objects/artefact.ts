import { z } from "zod";
import { ArtefactId } from "../ids";
import { workspaceOwnedFields } from "./base";

// Filled by F07 (Artefact Editor and Teacher Authorship)
//
// A generated document that is a projection of a Lesson + Journey (plan, slides, worksheet, quiz,
// exit ticket, ...). Carries a derived-from lineage and a review state (`ArtefactState`).
export const Artefact = z.strictObject({
  id: ArtefactId,
  ...workspaceOwnedFields,
});
export type Artefact = z.infer<typeof Artefact>;
