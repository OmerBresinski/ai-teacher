import type { Finding, Lesson, LessonFacts, Worksheet, WorksheetBlock } from "@tj/domain/documents";
import { defaultInstruction, TASK_BLOCK_TYPES } from "@tj/domain/documents";
import {
  docFromText,
  isPlaceholder,
  type MaterialiseMeta,
  materialiseBlock,
  numberQuestions,
  RECIPE_PROMPT_VERSION,
  type WorksheetRecipe,
} from "@tj/slides";
import { callStructured, MAX_OUTPUT_TOKENS, specRuleFinding } from "../call";
import { generateWorksheetFillPrompt } from "../prompts";
import { worksheetFillSchemaFor } from "../specs";
import { stemPlan } from "../stages/question-pool";
import { audienceOf, shapeOf } from "../stages/shared";
import type { PipelineDeps } from "../types";
import { type FillSlot, objectivesPractisedBy } from "./frame";

/*
 * Fill (ADR 0030 item 3.ii–iii; TDD §7 steps 2–3): one `small` call at low effort for the
 * placeholder slots only — the same settings the whole-sheet call had — with the sheet's question
 * pool and the stems the slides own (`stemPlan`, shared with Generate). Each slot's specs replace
 * its placeholder through `materialiseBlock`, stamped with the prompt version and `authoredBy:
 * "ai"`; then every task block gets an instruction line if none stands since the last heading
 * (ruling 61), and the questions are renumbered. An editorial miss the retry still carried
 * (TEACH-257) becomes a `spec-rule` finding on the block it names, for the check step to repair.
 */

export interface FillInput {
  worksheet: Worksheet;
  fillSlots: FillSlot[];
  recipe: WorksheetRecipe;
  lesson: Lesson;
  facts: LessonFacts;
  practiceMinutes: number;
}

export interface FillResult {
  worksheet: Worksheet;
  findings: Finding[];
  /** The stems reserved from the sheet, for the log's count and the tests. */
  reservedStems: string[];
  /** Set when a call was made. */
  modelId?: string;
}

export type FillDeps = Pick<
  PipelineDeps,
  "ai" | "budget" | "signal" | "logger" | "context" | "now" | "ids"
>;

export async function fillFrame(input: FillInput, deps: FillDeps): Promise<FillResult> {
  const { worksheet, fillSlots, recipe, lesson, facts, practiceMinutes } = input;
  const { pool, reservedForWorksheet } = stemPlan(facts);
  if (fillSlots.length === 0) {
    return {
      worksheet: { ...worksheet, blocks: numberQuestions(withInstructions(worksheet.blocks)) },
      findings: [],
      reservedStems: reservedForWorksheet,
    };
  }
  const context = { fillSlots, facts, practised: objectivesPractisedBy(worksheet, facts) };
  const call = await callStructured({
    deps,
    stage: "worksheet",
    cls: "small",
    effort: "low",
    prompt: generateWorksheetFillPrompt,
    input: {
      objectives: facts.objectives.map(({ id, text }) => ({ id, text })),
      shape: shapeOf(lesson),
      keyIdeas: facts.keyIdeas ?? [],
      misconceptions: facts.misconceptions,
      pool,
      reservedStems: reservedForWorksheet,
      pitch: facts.pitch,
      audience: audienceOf(lesson),
      lessonTitle: lesson.title,
      recipe: {
        id: recipe.id,
        job: recipe.jobs[0] ?? "practise",
        fillSlots,
        minutesBudget: practiceMinutes,
      },
    },
    schema: worksheetFillSchemaFor(context),
    soft: worksheetFillSchemaFor(context, { soft: true }),
    maxOutputTokens: MAX_OUTPUT_TOKENS.worksheet,
  });
  const meta: MaterialiseMeta = {
    promptVersion: generateWorksheetFillPrompt.version,
    model: call.modelId,
    at: deps.now().toISOString(),
  };
  // The answer's slots in answer order, materialised, so an editorial miss's path
  // (`slots.<k>.blocks.<j>…`) still finds the block it is about.
  const answered = call.output.slots.map((slot) => ({
    index: slot.index,
    blocks: slot.blocks.map((spec) => materialiseBlock(spec, meta, deps.ids)),
  }));
  const byIndex = new Map(answered.map((slot) => [slot.index, slot.blocks]));
  const spliced = worksheet.blocks.flatMap((block, index) =>
    isPlaceholder(block) ? (byIndex.get(index) ?? []) : [block],
  );
  const findings: Finding[] = call.editorialMisses.map((miss) => {
    const [root, k, blocksKey, j, ...rest] = miss.path;
    const block =
      root === "slots" && typeof k === "number" && blocksKey === "blocks" && typeof j === "number"
        ? answered[k]?.blocks[j]
        : undefined;
    return block
      ? specRuleFinding({ ...miss, path: rest }, { blockId: block.id })
      : specRuleFinding(miss, {}, "warning");
  });
  deps.logger.info(
    {
      recipeId: recipe.id,
      slots: fillSlots.length,
      blocks: answered.reduce((n, slot) => n + slot.blocks.length, 0),
      attempts: call.attempts,
      editorialMisses: call.editorialMisses.length,
      reservedStems: reservedForWorksheet.length,
    },
    "worksheet fill answered",
  );
  return {
    worksheet: { ...worksheet, blocks: numberQuestions(withInstructions(spliced)) },
    findings,
    reservedStems: reservedForWorksheet,
    modelId: call.modelId,
  };
}

type TaskKind = WorksheetBlock["type"];

/** Word bank and fill-gap share one instruction line, so they count as one kind of task. */
const taskKind = (type: WorksheetBlock["type"]): TaskKind =>
  type === "word-bank" ? "fill-gap" : type;

/**
 * Ruling 61 (TEACH-194): no task block prints without an instruction since the last heading.
 * The recipe's own lines cover the blocks they were written for; a filled block of another task
 * kind after them, or with no line at all, gets the guide's default line before it, cited from
 * the block it introduces. The same rule `instructionBefore` applies in the editor.
 */
export function withInstructions(blocks: readonly WorksheetBlock[]): WorksheetBlock[] {
  const out: WorksheetBlock[] = [];
  // `null`: no line since the last heading; `"any"`: a fresh line not yet claimed by a task kind.
  let line: TaskKind | "any" | null = null;
  for (const block of blocks) {
    if (block.type === "heading") line = null;
    else if (block.type === "instructions") line = "any";
    else if (TASK_BLOCK_TYPES.includes(block.type)) {
      const kind = taskKind(block.type);
      if (line === null || (line !== "any" && line !== kind)) {
        const text = defaultInstruction(block.type);
        if (text !== null) {
          const inserted: WorksheetBlock = {
            id: block.id.length > 0 ? `${block.id}-i` : "i",
            type: "instructions",
            doc: docFromText(text),
          };
          const refs = block.generatedFrom?.factRefs ?? [];
          if (refs.length > 0) {
            inserted.generatedFrom = {
              factRefs: refs,
              promptVersion: RECIPE_PROMPT_VERSION,
              model: "recipe",
              at: block.generatedFrom?.at ?? new Date(0).toISOString(),
            };
          }
          out.push(inserted);
        }
      }
      line = kind;
    }
    out.push(block);
  }
  return out;
}
