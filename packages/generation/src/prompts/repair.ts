import type { Finding, LessonFacts } from "@tj/domain/documents";
import { type Audience, audienceBlock, example, factsBlock, HOUSE_RULES } from "./shared";

/*
 * Repair (ADR 0025 §12): regenerate one slide or block spec with the `error` findings about it
 * in context. Same shapes as Generate, so the same materialiser places the result.
 */

export type RepairInput = {
  facts: LessonFacts;
  audience: Audience;
  target:
    | { kind: "slide"; slideKind: string; slideId: string; text: string }
    | { kind: "block"; blockType: string; blockId: string; text: string };
  findings: Finding[];
  /** The JSON shape wanted, copied from the Generate prompt's shape list for this kind/type. */
  shape: string;
};

export const repairPrompt = {
  version: "repair.v2",
  system: [
    "You fix one slide or worksheet block of a classroom lesson so that it no longer has the problems reported.",
    "Rewrite the whole item as a fresh spec of the same kind; keep everything that was right, change only what the findings require.",
    "",
    "Rules:",
    HOUSE_RULES,
    "The kind/type cannot change. Every answer must be correct and consistent with the facts. Put the ids of the facts the item draws on in `factRefs`.",
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
      "",
      factsBlock(input.facts),
      "",
      `${what} currently says:`,
      t.text,
      "",
      "Problems reported:",
      ...input.findings.map((f) => `- [${f.check}] ${f.message}`),
      "",
      `Answer with the JSON for the fixed item, shape: ${input.shape}`,
    ].join("\n");
  },
} as const;
