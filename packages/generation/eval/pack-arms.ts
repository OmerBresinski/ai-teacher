import { z } from "zod";
import { callStructured } from "../src/call";
import type { LabArm, ObjectiveFactsPlan } from "../src/lab/plan-pipeline";
import type { ObjectiveFactsOutput } from "../src/merge-objective-facts";
import {
  type PlanFactsObjectiveInput,
  planFactsObjectiveOutputSchemaFor,
} from "../src/prompts/plan-facts-objective";
import type { PipelineDeps } from "../src/types";
import type { LessonArm } from "./experiments/np1";
import {
  type PackSelectOutput,
  PackSelectOutputSchema,
  packFillPrompt,
  packSelectPrompt,
} from "./packs/prompts";
import {
  FACT_TYPES,
  type FactType,
  type Pack,
  type PackSection,
  presentTypes,
  sectionToObjectiveFacts,
} from "./packs/schema";

/*
 * The three lesson arms of np1 as `LabArm` hooks for `src/lab/plan-pipeline.ts`:
 *
 *   live      the current path: no pack anywhere.
 *   grounded  the objectives call is given the pack's section outcomes as its curriculum extract
 *             (scope retrieved BEFORE objectives); after the objectives, a select call per
 *             objective names the section that covers it, and that section's facts are handed to
 *             the objective's facts call as reference text. Every fact is still written live.
 *   packed    objectives as grounded; for a fully covered objective the facts are the pack's,
 *             copied field for field (`sectionToObjectiveFacts`), with no facts call; for a partly
 *             covered one the pack's facts plus ONE fill call for the missing types only; for an
 *             uncovered one the live facts call.
 *
 * Matching is the select call: the model decides section | none, full | partial, and names the
 * missing types and concepts. Code only reads the declaration and does the structural part: the
 * fill types are the declared missing types plus any type the section holds none of. Nothing
 * here scores similarity or infers coverage from text.
 */

// 200 crashed np1-externalities-packed (select 4 calls, 200+200+25+25 out): raised to 600.
export const MAX_OUTPUT_TOKENS_SELECT = 600;
export const MAX_OUTPUT_TOKENS_FILL = 1600;

/** The pack's section outcomes as the curriculum extract the objectives call reads. */
export function outcomesText(pack: Pack): string {
  return [
    "Unit outcomes (one per section):",
    ...pack.sections.map((s, i) => `${i + 1}. ${s.outcome}`),
  ].join("\n");
}

/**
 * A section's facts as reference text for a live facts call (grounded arm) or a fill call. Plain
 * lines, no ids (the call mints none), no evidence, no heading: the facts prompt's `reference`
 * input (v10) introduces them with `REFERENCE_INSTRUCTION`.
 */
export function referenceText(
  section: PackSection,
  types: readonly FactType[] = FACT_TYPES,
): string {
  const f = section.facts;
  const want = new Set(types);
  const L: string[] = [];
  if (want.has("keyIdeas"))
    for (const k of f.keyIdeas)
      L.push(`- Key idea: ${k.statement} ${k.explanation} Example: ${k.example}`);
  if (want.has("misconceptions"))
    for (const m of f.misconceptions)
      L.push(`- Misconception: pupils think ${m.belief}; in fact ${m.correction}`);
  if (want.has("vocabulary"))
    for (const v of f.vocabulary) L.push(`- Term: ${v.term} — ${v.definition}`);
  if (want.has("workedExamples"))
    for (const x of f.workedExamples)
      L.push(`- Worked example: ${x.problem} Steps: ${x.steps.join(" ")} Answer: ${x.answer}`);
  if (want.has("questions"))
    for (const q of f.questions) L.push(`- Question: ${q.stem} Answer: ${q.answer}`);
  return L.join("\n");
}

export interface SelectRecord {
  objective: string;
  decision: PackSelectOutput;
  section: string | null;
}

export interface ArmDeps {
  deps: PipelineDeps;
  /** Where the select decisions are recorded for the report; the arm appends to it. */
  selections: SelectRecord[];
}

/** One select call: the model's declaration, plus the section it names (or null). */
export async function selectSection(
  pack: Pack,
  objective: string,
  audience: { subject: string; yearGroup: string },
  arm: ArmDeps,
): Promise<{ decision: PackSelectOutput; section: PackSection | null }> {
  const result = await callStructured({
    deps: arm.deps,
    stage: "plan",
    cls: "standard",
    effort: "low",
    prompt: packSelectPrompt,
    input: {
      subject: audience.subject,
      yearGroup: audience.yearGroup,
      packYearGroup: pack.yearGroup,
      objective,
      sections: pack.sections.map((s) => ({ outcome: s.outcome, types: presentTypes(s) })),
    },
    schema: PackSelectOutputSchema,
    maxOutputTokens: MAX_OUTPUT_TOKENS_SELECT,
  });
  const decision = result.output;
  const section =
    decision.section !== null && decision.coverage !== "none"
      ? (pack.sections[decision.section] ?? null)
      : null;
  arm.selections.push({ objective, decision, section: section?.id ?? null });
  return { decision, section };
}

/** The fill types: what the model declared missing, plus every type the section holds none of. */
export function fillTypesFor(section: PackSection, decision: PackSelectOutput): FactType[] {
  const present = new Set(presentTypes(section));
  const declared = new Set(decision.coverage === "partial" ? decision.missingTypes : []);
  return FACT_TYPES.filter((t) => declared.has(t) || !present.has(t));
}

/** The facts call's own schema restricted to the types wanted, so the item shapes cannot drift. */
export function fillSchemaFor(input: PlanFactsObjectiveInput, types: readonly FactType[]) {
  // The factory's declared type is the wide `ZodType`; the value is the strict object it builds.
  const full = planFactsObjectiveOutputSchemaFor(input, {
    soft: true,
  }) as unknown as z.ZodObject<z.ZodRawShape>;
  const mask = Object.fromEntries(types.map((t) => [t, true as const]));
  return full.pick(mask as never) as z.ZodType<Partial<ObjectiveFactsOutput>>;
}

/**
 * Pack facts for the present types plus one fill call for the rest; filled items lose any
 * misconception ordinal. The fill sees the KEPT lists as reference (a reference carrying the lists
 * it is writing is copied back, smoke call 23 Sept) and the select call's missing concepts.
 */
export async function packWithFill(
  section: PackSection,
  types: FactType[],
  input: PlanFactsObjectiveInput,
  arm: ArmDeps,
  concepts: readonly string[] = [],
): Promise<ObjectiveFactsOutput> {
  const kept = FACT_TYPES.filter((t) => !types.includes(t));
  const base = sectionToObjectiveFacts(section, kept);
  if (types.length === 0) return base;
  const filled = await callStructured({
    deps: arm.deps,
    stage: "plan",
    cls: "standard",
    effort: "medium",
    prompt: packFillPrompt,
    input: { ...input, types, concepts, reference: { text: referenceText(section, kept) } },
    schema: fillSchemaFor(input, types),
    maxOutputTokens: MAX_OUTPUT_TOKENS_FILL,
  });
  const out = filled.output as Partial<ObjectiveFactsOutput>;
  const strip = <T extends { misconceptionRef?: unknown }>({ misconceptionRef: _m, ...rest }: T) =>
    rest;
  return {
    ...base,
    ...(out.keyIdeas ? { keyIdeas: out.keyIdeas } : {}),
    ...(out.misconceptions ? { misconceptions: out.misconceptions } : {}),
    ...(out.vocabulary ? { vocabulary: out.vocabulary } : {}),
    ...(out.workedExamples ? { workedExamples: out.workedExamples.map(strip) } : {}),
    // A filled question's `keyIdeaRefs` index the fill's own key ideas: kept only when it wrote them.
    ...(out.questions
      ? {
          questions: out.questions.map(({ keyIdeaRefs, ...q }) => ({
            ...q,
            ...(out.keyIdeas && keyIdeaRefs ? { keyIdeaRefs } : {}),
            distractors: q.distractors?.map(strip),
          })),
        }
      : {}),
  };
}

/** The `LabArm` for one lesson arm over one pack (`undefined` for `live`). */
export function armHooks(
  name: LessonArm,
  pack: Pack | undefined,
  audience: { subject: string; yearGroup: string },
  arm: ArmDeps,
): LabArm | undefined {
  if (name === "live") return undefined;
  if (!pack) throw new Error(`arm ${name} needs a pack`);
  const curriculum = { text: outcomesText(pack) };
  const factsFor = async (
    objectives: { text: string }[],
    input: Omit<PlanFactsObjectiveInput, "target">,
  ): Promise<ObjectiveFactsPlan[]> =>
    Promise.all(
      objectives.map(async (o, target): Promise<ObjectiveFactsPlan> => {
        const { decision, section } = await selectSection(pack, o.text, audience, arm);
        if (!section) return { mode: "call" };
        if (name === "grounded") return { mode: "call", reference: referenceText(section) };
        const types = fillTypesFor(section, decision);
        const full: PlanFactsObjectiveInput = { ...input, target };
        const output = await packWithFill(section, types, full, arm, decision.missingConcepts);
        return { mode: "pack", output: retarget(output, target), filled: types };
      }),
    );
  return { name, curriculum, factsFor };
}

/** Section-local objective refs (index 0) become the lesson objective the section was matched to. */
export function retarget(output: ObjectiveFactsOutput, target: number): ObjectiveFactsOutput {
  return {
    ...output,
    workedExamples: output.workedExamples.map((x) => ({
      ...x,
      ...(x.objectiveRefs
        ? { objectiveRefs: x.objectiveRefs.map((r) => ({ ...r, index: target })) }
        : {}),
    })),
  };
}

/** One checker's recorded verdict on one fact (the pack report's `checks.<checker>[]`). */
export interface CheckVerdict {
  fact: number;
  supportedByEvidence: string;
  correct: string;
  /** pack-check.v2 only. */
  valuesStated?: string;
  pitched?: string;
  note?: string;
}

/** The part of a pack report (`eval/results/packs/<pack id>/report.json`) admission reads. */
export interface PackCheckReport {
  sections: { id: string; checks: Partial<Record<string, CheckVerdict[] | null>> }[];
}

export interface AdmissionRule {
  checkers: readonly string[];
  correct: "yes";
  rejectSupportedByEvidence: "no";
  /**
   * np2 gates (pack-check.v2): a fact is dropped when any checker records `pitched` = no, or no
   * `pitched` at all (a v1 verdict cannot pass). v2 (`experiments/pack-gates.v2.json`) also rejects
   * `valuesStated` = no or missing; v3 (`pack-gates.v3.json`, pitched only) leaves it out.
   */
  gates?: { rejectPitched: "no"; rejectValuesStated?: "no" | undefined };
}

const GatesNoteSchema = z.object({
  registeredAt: z.string().datetime(),
  rule: z.string(),
  checkers: z.array(z.enum(["luna", "sol"])).min(1),
  correct: z.literal("yes"),
  rejectSupportedByEvidence: z.literal("no"),
  gates: z.strictObject({
    rejectPitched: z.literal("no"),
    rejectValuesStated: z.literal("no").optional(),
  }),
});

/** A registered pack admission rule, `experiments/pack-gates.<version>.json` (np1.json untouched). */
export async function loadPackGates(
  version: "v2" | "v3",
): Promise<AdmissionRule & { rule: string }> {
  const path = `${import.meta.dir}/experiments/pack-gates.${version}.json`;
  return GatesNoteSchema.parse(await Bun.file(path).json());
}

/** The np2 admission rule, registered in `experiments/pack-gates.v2.json`. */
export const loadPackGatesV2 = () => loadPackGates("v2");

/** Why a checker's verdict failed the rule, one tag per failed test (`correct`, `pitched`, ...). */
export function failedTests(v: CheckVerdict | null, rule: AdmissionRule): string[] {
  if (v === null) return ["missing"];
  const out: string[] = [];
  if (v.correct !== rule.correct) out.push("correct");
  if (v.supportedByEvidence === rule.rejectSupportedByEvidence) out.push("supported");
  if (rule.gates) {
    if (v.pitched === undefined || v.pitched === rule.gates.rejectPitched) out.push("pitched");
    const values = rule.gates.rejectValuesStated;
    if (values !== undefined && (v.valuesStated === undefined || v.valuesStated === values))
      out.push("valuesStated");
  }
  return out;
}

export interface DroppedFact {
  section: string;
  type: FactType;
  index: number;
  /** The fact's flat position, as the checkers numbered it. */
  fact: number;
  verdicts: Record<string, { supportedByEvidence: string; correct: string } | null>;
  /** Failed tests per checker, as `failedTests` names them (`sol:pitched`). */
  failed: string[];
}

/**
 * The pre-registered admission rule (np1.json `packAdmission`), applied structurally: a fact stays
 * only if every named checker recorded `correct` = yes and none recorded `supportedByEvidence` =
 * no; with np2's `gates`, also none recorded `pitched` = no (and, under v2, `valuesStated` = no).
 * A missing verdict or a missing section in the report fails the fact. Facts are numbered as
 * the checkers saw them (FACT_TYPES order, then position). Misconception refs are renumbered to
 * the kept misconceptions; a ref to a dropped misconception is removed.
 */
export function admitPack(
  pack: Pack,
  report: PackCheckReport,
  rule: AdmissionRule,
): { pack: Pack; dropped: DroppedFact[] } {
  const dropped: DroppedFact[] = [];
  const sections = pack.sections.map((section) => {
    const checks = report.sections.find((s) => s.id === section.id)?.checks ?? {};
    const byChecker = new Map(
      rule.checkers.map((c) => [c, new Map((checks[c] ?? []).map((v) => [v.fact, v]))] as const),
    );
    const keep: Record<FactType, boolean[]> = {
      keyIdeas: [],
      misconceptions: [],
      vocabulary: [],
      workedExamples: [],
      questions: [],
    };
    let n = 0;
    for (const type of FACT_TYPES)
      (section.facts[type] as unknown[]).forEach((_, index) => {
        const fact = n++;
        const verdicts = rule.checkers.map(
          (c) => [c, byChecker.get(c)?.get(fact) ?? null] as const,
        );
        const failed = verdicts.flatMap(([c, v]) => failedTests(v, rule).map((t) => `${c}:${t}`));
        const ok = failed.length === 0;
        keep[type].push(ok);
        if (!ok)
          dropped.push({
            section: section.id,
            type,
            index,
            fact,
            verdicts: Object.fromEntries(
              verdicts.map(([c, v]) => [
                c,
                v
                  ? {
                      supportedByEvidence: v.supportedByEvidence,
                      correct: v.correct,
                      ...(v.valuesStated ? { valuesStated: v.valuesStated } : {}),
                      ...(v.pitched ? { pitched: v.pitched } : {}),
                    }
                  : null,
              ]),
            ),
            failed,
          });
      });
    const newIndex = new Map<number, number>();
    keep.misconceptions.forEach((k, i) => {
      if (k) newIndex.set(i, newIndex.size);
    });
    const remap = <T extends { misconceptionRef?: { type: "misconception"; index: number } }>(
      x: T,
    ): T => {
      if (!x.misconceptionRef) return x;
      const to = newIndex.get(x.misconceptionRef.index);
      const { misconceptionRef, ...rest } = x;
      return (
        to === undefined ? rest : { ...rest, misconceptionRef: { ...misconceptionRef, index: to } }
      ) as T;
    };
    const f = section.facts;
    const kept = <T>(type: FactType, items: T[]) => items.filter((_, i) => keep[type][i]);
    return {
      ...section,
      facts: {
        keyIdeas: kept("keyIdeas", f.keyIdeas),
        misconceptions: kept("misconceptions", f.misconceptions),
        vocabulary: kept("vocabulary", f.vocabulary),
        workedExamples: kept("workedExamples", f.workedExamples).map(remap),
        questions: kept("questions", f.questions).map((q) =>
          q.distractors ? { ...q, distractors: q.distractors.map(remap) } : q,
        ),
      },
    };
  });
  return { pack: { ...pack, sections }, dropped };
}
