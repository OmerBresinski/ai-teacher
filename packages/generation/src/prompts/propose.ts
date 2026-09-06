import type { LessonFacts } from "@tj/domain/documents";
import { type Audience, audienceBlock, example, factsBlock, HOUSE_RULES } from "./shared";

/*
 * Proposal jobs (ADR 0025 §18): re-derive one slide or block after a fact changed (`cascade`) or
 * on the teacher's request (`regenerate`). Same spec shapes as Generate, so `materialiseSlide` /
 * `materialiseBlock` place the result; the editor applies it as one undo transaction. Two prompt
 * modules share one builder because only the reason differs.
 */

export type ProposeInput = {
  facts: LessonFacts;
  audience: Audience;
  target:
    | { kind: "slide"; slideKind: string; slideId: string; text: string }
    | { kind: "block"; blockType: string; blockId: string; text: string };
  /** The JSON shape wanted, e.g. `a "multiple-choice" slide spec`. */
  shape: string;
  /** Cascade: the facts that changed (ids); the prompt names them so the model knows why. */
  changedFactIds?: string[] | undefined;
  /** Regenerate: what the teacher asked for. */
  instruction?: string | undefined;
};

const SYSTEM = (why: string) =>
  [
    "You rewrite one slide or worksheet block of a classroom lesson.",
    why,
    "Produce a fresh spec of the same kind; keep everything that is still right and change only what the reason requires.",
    "",
    "Rules:",
    HOUSE_RULES,
    "The kind/type cannot change. Every answer must be correct and consistent with the facts as they now stand. Put the ids of the facts the item draws on in `factRefs`.",
    "",
    "Example answer for a content slide:",
    example({
      kind: "content",
      heading: "The particle model",
      body: "Everything is made of tiny particles; how they are arranged and move decides the state of matter.",
      factRefs: ["o1"],
      notes: "Draw the three diagrams on the board.",
    }),
  ].join("\n");

function user(input: ProposeInput): string {
  const t = input.target;
  const what =
    t.kind === "slide"
      ? `Slide ${t.slideId} (kind "${t.slideKind}")`
      : `Worksheet block ${t.blockId} (type "${t.blockType}")`;
  const parts = [
    audienceBlock(input.audience),
    "",
    factsBlock(input.facts),
    "",
    `${what} currently says:`,
    t.text,
    "",
  ];
  if (input.changedFactIds && input.changedFactIds.length > 0) {
    parts.push(
      `The facts that changed: ${input.changedFactIds.join(", ")}. Bring the item into line with their new wording.`,
    );
  }
  if (input.instruction) parts.push(`The teacher asks: ${input.instruction}`);
  parts.push("", `Answer with the JSON for the rewritten item, shape: ${input.shape}`);
  return parts.join("\n");
}

export const cascadePrompt = {
  version: "cascade.v1",
  system: SYSTEM(
    "A fact the item was built from has been edited by the teacher; the item must match the new fact.",
  ),
  user,
} as const;

export const regeneratePrompt = {
  version: "regenerate.v1",
  system: SYSTEM(
    "The teacher has asked for this item again, optionally with an instruction about what to change.",
  ),
  user,
} as const;
