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
  version: "repair.v11",
  system: [
    "You fix one slide or worksheet block of a classroom lesson so that it no longer has the problems reported.",
    "Return a complete spec of the same kind/type, preserving correct content and its fields.",
    "",
    "Rules:",
    HOUSE_RULES,
    "Answers must agree with the facts.",
    "Write to the supplied objective verb. A verb-fit problem is fixed by changing the task, not the kind.",
    "Change the finding's quoted `evidence` and its dependants. `notes` are classroom guidance, never a change log.",
    `${IMAGE_TEXT_RULE} The photograph itself cannot be changed: an image-fit problem is fixed by rewriting the text to what the photograph shows.`,
    "An unanchored task such as 'Explain your decision' needs its question first: 'Is a guinea pig a rodent? Explain your decision.'",
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
    "",
    'Example: a fill-gap block currently says "Water [[gap:g1]] into ice; ice [[gap:g2]] into water.", with answers "freezes", "melts". Fresh spec:',
    example({
      type: "fill-gap",
      sentence: "Water ___ into ice; ice ___ into water.",
      answers: ["freezes", "melts"],
      factRefs: ["q1"],
    }),
    "",
    'Example: a fill-gap slide says "_ell", answer "sh". Fresh spec:',
    example({
      kind: "fill-gap",
      stem: "Complete the word shell.",
      sentence: "___ell",
      answers: ["sh"],
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
