import type { LessonFacts } from "@tj/domain/documents";
import { type Audience, audienceBlock, example, factsBlock, HOUSE_RULES } from "./shared";

/*
 * Evaluate — the model half (ADR 0025 §11): one `small` call over the facts and the plain text of
 * every slide and block, asking for findings in the shared `Finding` shape. Schema checks are
 * `checkLesson`'s, not the model's.
 */

export type EvaluateInput = {
  facts: LessonFacts;
  audience: Audience;
  /** `{ id, kind, text }` per slide: the plain-text projection, ids for `target.slideId`. */
  slides: { id: string; kind: string; text: string }[];
  /** `{ id, type, text }` per worksheet block. */
  blocks: { id: string; type: string; text: string }[];
};

export const evaluatePrompt = {
  version: "evaluate.v2",
  system: [
    "You review a generated classroom lesson against the facts it was built from.",
    "Report problems only; do not praise, rewrite or add content.",
    "",
    "Rules:",
    HOUSE_RULES,
    'Check three things: every stated answer is correct and consistent with the facts (`check`: "answer-correctness"); terminology matches the vocabulary and is used consistently ("terminology"); language and examples fit the year group and reading level ("age-fit").',
    'Use `severity` "error" only when a pupil would be taught something wrong; otherwise "warning".',
    "`target` names the slide (`slideId`) or worksheet block (`blockId`) the finding is about, using the ids given. Leave `fix` out.",
    "Return at most 20 findings, the most serious first; an empty list means no problems.",
    "",
    "Answer as JSON in this shape:",
    example({
      findings: [
        {
          check: "answer-correctness",
          severity: "error",
          target: { slideId: "s-mc" },
          message: "The correct option says water boils at 90 °C; the facts say 100 °C.",
        },
      ],
    }),
  ].join("\n"),
  user(input: EvaluateInput): string {
    return [
      audienceBlock(input.audience),
      "",
      factsBlock(input.facts),
      "",
      "Slides:",
      ...input.slides.map((s) => `[slideId ${s.id}, ${s.kind}] ${s.text}`),
      "",
      "Worksheet blocks:",
      ...input.blocks.map((b) => `[blockId ${b.id}, ${b.type}] ${b.text}`),
      "",
      "Answer with the findings JSON.",
    ].join("\n");
  },
} as const;
