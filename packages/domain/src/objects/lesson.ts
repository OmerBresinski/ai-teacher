import { z } from "zod";
import { LessonId } from "../ids";
import { workspaceOwnedFields } from "./base";

// Filled by F06 (Lesson Builder and Coherent Artefact Generation)
//
// An ordered session in the Journey covering one or more Concepts. Its taught state uses
// `LessonTaughtState` from `../states`.
export const Lesson = z.strictObject({
  id: LessonId,
  ...workspaceOwnedFields,
});
export type Lesson = z.infer<typeof Lesson>;
