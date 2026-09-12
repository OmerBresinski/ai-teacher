import type { LessonFacts } from "@tj/domain/documents";
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
 * Evaluate — the model half (ADR 0025 §11): one `small` call over the facts and the plain text of
 * every slide and block, asking for findings in the shared `Finding` shape. Schema checks are
 * `checkLesson`'s, not the model's. Since TEACH-230 the reviewer is told the objective verb and
 * reports a slide whose task does not serve it as `verb-fit` (a warning).
 */

export type EvaluateInput = {
  facts: LessonFacts;
  audience: Audience;
  /** The lesson's objective verb and the class's prior confidence (`lessonShapeOf`, TEACH-230). */
  shape: WritingShape;
  /**
   * `{ id, kind, text, notes, photo }` per slide; notes are shown apart so `notes-quality` can
   * judge them. `photo` is the 1-based number of the image part carrying the slide's photograph
   * (an `image-text` slide with a placed photo, TEACH-220), so `image-fit` can look at it.
   */
  slides: {
    id: string;
    kind: string;
    text: string;
    notes?: string | undefined;
    photo?: number | undefined;
  }[];
  /** `{ id, type, text }` per worksheet block. */
  blocks: { id: string; type: string; text: string }[];
};

export const evaluatePrompt = {
  version: "evaluate.v5",
  system: [
    "You review a generated classroom lesson against the facts it was built from.",
    "Report problems only; do not praise, rewrite or add content.",
    "",
    "Rules:",
    HOUSE_RULES,
    'Each finding has a `check` from this list and nothing else: "answer-correctness" (a stated answer is wrong or does not follow from the facts); "fact-consistency" (the slide or block says something the facts contradict, or uses a term the facts do not); "kind-misuse" (the slide kind does not fit the task — a sort with no order, a matching with identical right-hand sides, a true-false with two claims); "repetition" (the same stem or the same key phrase on two items); "pitch" (language or examples above or below the reading level — say which); "notes-quality" (notes that do not say what to say, what misconception to watch for, or what to ask); "image-fit" (a photographed slide sets a task — spot, find, count, point to, identify, circle, label — that does not work with the photograph shown, or describes the photograph wrongly); "verb-fit" (a slide whose task does not serve the objective verb — a Recall lesson asking for a judgement, an Apply lesson with no method, an Explain content slide that lists facts without how or why).',
    "You are told the lesson's objective verb and what each kind of slide is for under it; a slide that does what another verb would ask for is a `verb-fit` finding (a warning), with the task phrase as `evidence`.",
    "Some slides carry a photograph: `[slideId …, image-text, photo N]` means the N-th image given is that slide's photograph. Look at it and check every task the text sets against it; if one does not work, report `image-fit` (a warning) with the task phrase as `evidence`.",
    '`severity` is "error" only for "answer-correctness" and "fact-consistency", where a pupil would be taught something wrong; every other check is a "warning".',
    "`evidence` is the exact span of the slide or block text the finding is about, copied word for word — a finding you cannot quote is not a finding. `message` says what is wrong with it.",
    "`target` names the slide (`slideId`) or worksheet block (`blockId`) the finding is about, using the ids given. When the fact itself is wrong, name it too in `target.factId` and put the wrong fact text in `evidence`. Leave `fix` out.",
    "Return at most 20 findings, the most serious first; an empty list means no problems.",
    "",
    "Answer as JSON in this shape:",
    example({
      findings: [
        {
          check: "answer-correctness",
          severity: "error",
          target: { slideId: "s-mc" },
          evidence: "Water boils at 90 °C",
          message: "The correct option gives 90 °C; the facts say 100 °C.",
        },
        {
          check: "notes-quality",
          severity: "warning",
          target: { slideId: "s-content" },
          evidence: "Go through the slide.",
          message: "The notes say nothing to ask and name no misconception to watch for.",
        },
      ],
    }),
  ].join("\n"),
  user(input: EvaluateInput): string {
    return [
      audienceBlock(input.audience),
      verbBlock(input.shape),
      "",
      factsBlock(input.facts),
      "",
      "Slides:",
      ...input.slides.map(
        (s) =>
          `[slideId ${s.id}, ${s.kind}${s.photo !== undefined ? `, photo ${s.photo}` : ""}] ${s.text}${s.notes ? `\nTeacher notes: ${s.notes}` : ""}`,
      ),
      "",
      "Worksheet blocks:",
      ...input.blocks.map((b) => `[blockId ${b.id}, ${b.type}] ${b.text}`),
      "",
      "Answer with the findings JSON.",
    ].join("\n");
  },
} as const;
