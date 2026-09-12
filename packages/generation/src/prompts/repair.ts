import type { Finding, LessonFacts } from "@tj/domain/documents";
import { IMAGE_TEXT_RULE, photoBlock, type SlidePhoto } from "./generate-slide";
import {
  type Audience,
  audienceBlock,
  example,
  factsBlock,
  HOUSE_RULES,
  verbBlock,
  type WritingShape,
} from "./shared";

/*
 * Repair (ADR 0025 §12; Generation quality §4, TEACH-216): regenerate one slide or block spec with
 * the `error` findings about it in context — each quoting the text it is about — so the fix is
 * targeted. Same shapes as Generate, so the same materialiser places the result; the spec
 * sanitiser refuses repair commentary in `notes`. Since TEACH-230 it is given the same verb block
 * Generate had, so a rewritten slide is written to the objective verb too.
 */

export type RepairInput = {
  facts: LessonFacts;
  audience: Audience;
  /**
   * The lesson's objective verb and the class's prior confidence (`lessonShapeOf`, TEACH-230).
   * Named apart from `shape`, which here is the JSON shape wanted.
   */
  lessonShape: WritingShape;
  target:
    | {
        kind: "slide";
        slideKind: string;
        slideId: string;
        text: string;
        /**
         * The slide's text as labelled spec fields (TEACH-222), shown instead of `text` when
         * present: the recipe's fixed captions are not among them, so the model cannot copy
         * "KEY IDEA" into `heading`.
         */
        fields?: { field: string; text: string }[] | undefined;
        /** An `image-text` slide's photograph (TEACH-220): the picture stays, only the text changes. */
        photo?: SlidePhoto | "none" | undefined;
      }
    | { kind: "block"; blockType: string; blockId: string; text: string };
  findings: Finding[];
  /** The JSON shape wanted, copied from the Generate prompt's shape list for this kind/type. */
  shape: string;
};

export const repairPrompt = {
  version: "repair.v9",
  system: [
    "You fix one slide or worksheet block of a classroom lesson so that it no longer has the problems reported.",
    "Rewrite the whole item as a fresh spec of the same kind; keep everything that was right, change only what the findings require. The current text is shown field by field; put each field's content back in the same field.",
    "",
    "Rules:",
    HOUSE_RULES,
    "The kind/type cannot change. Every answer must be correct and consistent with the facts. Put the ids of the facts the item draws on in `factRefs`.",
    "You are told the lesson's objective verb and what each kind of slide, and the worksheet, is for under it; the rewritten item serves that verb. A verb-fit problem is fixed by changing the task, not the kind.",
    "Each finding quotes the exact text it is about (`evidence`); change that and what depends on it, keep the rest. Never describe what you changed — `notes` are for the teacher in the room, not a change log.",
    `${IMAGE_TEXT_RULE} The photograph itself cannot be changed: an image-fit problem is fixed by rewriting the text to what the photograph shows.`,
    "An image-fit error: the photograph cannot change, so rewrite the task to what the visible list says is there, or make the slide a description — never a find, spot or count task on something not visible.",
    "A task that leans on something no earlier sentence set up — 'your decision', 'your answer', 'your choice', 'the animal', 'it', 'this one', 'these' — with no question before it: write the question first (\"Is a guinea pig a rodent?\"), then the task.",
    "",
    "Example answer for a multiple-choice slide:",
    example({
      kind: "multiple-choice",
      stem: "At what temperature does water boil at sea level?",
      options: [
        { text: "90 °C", correct: false },
        { text: "100 °C", correct: true },
        { text: "110 °C", correct: false },
        { text: "0 °C", correct: false },
      ],
      explanation: "Water boils at 100 °C at standard atmospheric pressure.",
      factRefs: ["q1"],
    }),
  ].join("\n"),
  user(input: RepairInput): string {
    const t = input.target;
    const what =
      t.kind === "slide"
        ? `Slide ${t.slideId} (kind "${t.slideKind}")`
        : `Worksheet block ${t.blockId} (type "${t.blockType}")`;
    return [
      audienceBlock(input.audience),
      verbBlock(input.lessonShape),
      "",
      factsBlock(input.facts),
      "",
      `${what} currently says:`,
      ...(t.kind === "slide" && t.fields && t.fields.length > 0
        ? t.fields.map((f) => `${f.field}: ${f.text}`)
        : [t.text]),
      ...(t.kind === "slide" && t.photo !== undefined ? ["", ...photoBlock(t.photo)] : []),
      "",
      "Problems reported:",
      ...input.findings.map(
        (f) => `- [${f.check}] ${f.message}${f.evidence ? ` — about: "${f.evidence}"` : ""}`,
      ),
      "",
      `Answer with the JSON for the fixed item, shape: ${input.shape}`,
    ].join("\n");
  },
} as const;
