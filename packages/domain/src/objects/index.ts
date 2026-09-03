import { Adaptation } from "./adaptation";
import { Artefact } from "./artefact";
import { CohortProfile } from "./cohort-profile";
import { Concept } from "./concept";
import { Journey } from "./journey";
import { KnowledgeNode } from "./knowledge-node";
import { Lesson } from "./lesson";
import { Observation } from "./observation";
import { Skill } from "./skill";
import { Source } from "./source";
import { Workspace } from "./workspace";

export { Adaptation } from "./adaptation";
export { Artefact } from "./artefact";
export { workspaceOwnedFields } from "./base";
export { CohortProfile } from "./cohort-profile";
export { Concept } from "./concept";
export { Journey } from "./journey";
export { KnowledgeNode } from "./knowledge-node";
export { Lesson } from "./lesson";
export { Observation } from "./observation";
export { Skill } from "./skill";
export { Source } from "./source";
export { Workspace } from "./workspace";

/**
 * Every core object schema (Master PRD §8) keyed by object name. Used by the "every object is
 * workspace-owned except Workspace" invariant test and by tooling that iterates the object model.
 */
export const OBJECT_SCHEMAS = {
  Workspace,
  Journey,
  CohortProfile,
  Concept,
  Lesson,
  Artefact,
  Observation,
  Adaptation,
  Source,
  Skill,
  KnowledgeNode,
} as const;

export type ObjectName = keyof typeof OBJECT_SCHEMAS;
