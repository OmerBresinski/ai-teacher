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
 * the findings about it in context — each quoting the text it is about — so the fix is targeted.
 * Same shapes as Generate, so the same materialiser places the result; the spec sanitiser refuses
 * repair commentary in `notes`. Since TEACH-230 it is given the same verb block Generate had, so a
 * rewritten slide is written to the objective verb too. Since lab round 1 (v14) a slide call is
 * also shown up to six other slides read-only, and the verb-fit, repetition and tested-not-taught
 * warnings arrive with the errors (scratchpad/quality-prd/lab/r1/checks.md §3).
 *
 * v15 (24 Sept 2026 audit, FIX-PLAN B6): the target's plan reaches the call (contract C2: the
 * facts it was planned to teach and its brief, with one rule beside them — a verb-fit warning fix
 * deleted the groyne example an exit question needed) and so do its current `factRefs` (C3). The
 * target lines carry spec-field labels from the caller (C5). The image-text rule moves from the
 * system text to the user turn, beside the photograph it is about, so the calls with no
 * photograph (all of them in the lab) do not carry it.
 */

/** One other slide a repair call sees and must not rewrite (`repairContext`, lab round 1). */
export type RepairContextSlide = {
  /** 1-based position in the deck. */
  position: number;
  kind: string;
  text: string;
  /** Why it is shown: next to the target, holds the repeated text, or taught before the target. */
  why: "before" | "after" | "repeats" | "taught-earlier";
};

const WHY_SHOWN: Record<RepairContextSlide["why"], string> = {
  before: "before the target",
  after: "after the target",
  repeats: "makes the repeated point",
  "taught-earlier": "taught earlier",
};

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
  /** Other slides shown read-only (slide repairs only; lab round 1). */
  context?: { slides: RepairContextSlide[] } | undefined;
  /** What the outline planned the target to teach (C2): its fact ids and brief. Optional. */
  planned?: { factRefs: string[]; brief: string } | undefined;
  /** The target's `factRefs` as it stands (C3). Optional. */
  currentFactRefs?: string[] | undefined;
};

/** The image-text rule and what an image-fit fix may change, sent beside the photograph. */
const PHOTO_RULE = `${IMAGE_TEXT_RULE} The photograph itself cannot be changed: an image-fit problem is fixed by rewriting the text to what the photograph shows.`;

export const repairPrompt = {
  version: "repair.v15",
  system: [
    "You fix one slide or worksheet block of a classroom lesson so that it no longer has the problems reported.",
    "Return a complete spec of the same kind/type, preserving correct content and its fields.",
    "",
    "Rules:",
    HOUSE_RULES,
    "Answers must agree with the facts.",
    "Fix every problem listed — errors, then warnings — changing only the text each quotes and what depends on it; other items and headings stay. `notes` are classroom guidance, never a change log, and keep their answer lines.",
    "Make each point, example and quotation once: where another slide shown already makes it, take a different one from the facts.",
    "A question, task or model answer asks only what the slides marked taught earlier and the target's facts state; for tested-not-taught, narrow the task to that.",
    "Write to the supplied objective verb. A verb-fit problem is fixed by changing the task, not the kind, at the class's level: in Years 1 and 2 an explain item may keep its naming question and add the reason, answered in one short sentence aloud or on one line.",
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
    const others = input.context?.slides ?? [];
    // Errors before warnings, each labelled, so "errors first" names lines the model can see.
    const findings = [...input.findings].sort(
      (a, b) => Number(b.severity === "error") - Number(a.severity === "error"),
    );
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
      ...(input.currentFactRefs?.length ? [`factRefs: ${input.currentFactRefs.join(", ")}`] : []),
      ...(input.planned
        ? [
            "",
            `Planned to teach ${input.planned.factRefs.join(", ")}: ${input.planned.brief}`,
            "Keep every fact the slide was planned to teach; fix a warning without dropping one.",
          ]
        : []),
      ...(t.kind === "slide" && t.photo !== undefined
        ? ["", ...photoBlock(t.photo), PHOTO_RULE]
        : []),
      ...(others.length > 0
        ? [
            "",
            "Other slides in the lesson, for reference only; answer with the target's spec alone:",
            ...others.flatMap((s) => [
              `Slide ${s.position} (${s.kind}, ${WHY_SHOWN[s.why]}):`,
              s.text,
            ]),
          ]
        : []),
      "",
      "Problems reported:",
      ...findings.map(
        (f) =>
          `- [${f.check}, ${f.severity}] ${f.message}${f.evidence ? ` — about: "${f.evidence}"` : ""}`,
      ),
      "",
      `Answer with the JSON for the fixed item, shape: ${input.shape}`,
    ].join("\n");
  },
} as const;
