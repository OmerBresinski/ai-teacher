import type { LessonFacts, Objective } from "@tj/domain/documents";
import { callStructured } from "../call";
import { MAX_OUTPUT_TOKENS_TEACH } from "../planner/plan-pipeline";
import type { DesignCycleFacts } from "../prompts/design-cycle";
import {
  type PlanTeachObjectiveInput,
  type PlanTeachObjectiveOutput,
  planTeachObjectiveOutputSchemaFor,
  planTeachObjectivePrompt,
} from "../prompts/plan-teach-objective";
import type { Audience } from "../prompts/shared";
import type { LessonShape } from "../shapes";
import type { VerifyCorrection } from "../specs";
import { type PipelineDeps, SOURCE_TEXT_MAX_CHARS } from "../types";
import { plannerEffort } from "./objectives";
import { retrievalInput } from "./shared";
import { selectSourceTexts } from "./source-texts";
import { runVerify } from "./verify";

/*
 * The designer's facts feed (round 5, arm F; behind `DESIGNER_FACTS=1`). Per objective, in
 * parallel, the objectives-first teach call (`plan-teach-objective`, as `runWaves` makes it: the
 * same input, schema, soft schema, cap and effort; no question sets) writes the key ideas,
 * misconceptions, vocabulary and worked example; the objective's design cycle starts the moment its
 * own facts land and is handed them as `facts`. Verify (`verify-facts`) checks each objective's
 * facts in parallel with its cycle, never in front of it: a Verify call at medium takes longer
 * than the ~3 s the first slide could afford. When it corrects something, the slots whose words
 * carry what the correction removed are re-filled from the corrected facts (`correctedSlots`);
 * the rest of the cycle stands.
 */

/** Whether the facts feed is on: `DESIGNER_FACTS=1` in the host's environment. */
export function designerFactsOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.DESIGNER_FACTS === "1";
}

/** One objective's facts as they travel: for the cycle, and as `LessonFacts` for Verify. */
export type FedFacts = { cycle: DesignCycleFacts; lesson: LessonFacts };

/** What the feed did for one objective, for the design report and the latency log. */
export type FactsFeedTiming = {
  objective: number;
  /** The teach call returned (ms after the design step began); absent when it failed. */
  teachMs?: number;
  /** Verify over its facts returned (ms after the design step began). */
  verifyMs?: number;
  corrections: number;
  /** Slide numbers (1-based) re-filled after a correction. */
  refilled: number[];
  failed?: true;
};

/**
 * One objective's teach output as `LessonFacts` for Verify: every objective (ids as on the
 * lesson), the four lists with minted ids (`k`, `m`, `v`, `x`), each item on the target
 * objective, a worked example's misconception ordinal turned into its id.
 */
export function taughtAsLessonFacts(
  taught: PlanTeachObjectiveOutput,
  objectives: readonly Objective[],
  target: number,
  durationMin: number,
): LessonFacts {
  const own = [objectives[target]?.id ?? `o${target + 1}`];
  return {
    objectives: [...objectives],
    keyIdeas: taught.keyIdeas.map((k, i) => ({
      id: `k${i + 1}`,
      statement: k.statement,
      explanation: k.explanation,
      example: k.example,
      ...(k.analogy ? { analogy: k.analogy } : {}),
      objectiveRefs: own,
    })),
    misconceptions: taught.misconceptions.map((m, i) => ({
      id: `m${i + 1}`,
      belief: m.belief,
      correction: m.correction,
      objectiveRefs: own,
    })),
    vocabulary: taught.vocabulary.map((v, i) => ({
      id: `v${i + 1}`,
      term: v.term,
      definition: v.definition,
      objectiveRefs: own,
    })),
    workedExamples: taught.workedExamples.map((x, i) => ({
      id: `x${i + 1}`,
      problem: x.problem,
      steps: [...x.steps],
      answer: x.answer,
      ...(x.misconceptionRef ? { misconceptionRef: `m${x.misconceptionRef.index + 1}` } : {}),
      objectiveRefs: own,
    })),
    questions: [],
    outline: [],
    durationMin,
  };
}

/** The design cycle's view of the facts: the four lists, ids and references dropped. */
export function cycleFactsOf(facts: LessonFacts): DesignCycleFacts {
  return {
    keyIdeas: (facts.keyIdeas ?? []).map(({ statement, explanation, example, analogy }) => ({
      statement,
      explanation,
      example,
      ...(analogy ? { analogy } : {}),
    })),
    misconceptions: facts.misconceptions.map(({ belief, correction }) => ({ belief, correction })),
    vocabulary: facts.vocabulary.map(({ term, definition }) => ({ term, definition })),
    workedExamples: facts.workedExamples.map(({ problem, steps, answer }) => ({
      problem,
      steps,
      answer,
    })),
  };
}

/** The text a correction replaced, read from the facts before it was applied. */
export function correctedText(facts: LessonFacts, c: VerifyCorrection): string | undefined {
  const lists = [
    facts.keyIdeas ?? [],
    facts.misconceptions,
    facts.vocabulary,
    facts.workedExamples,
    facts.questions,
  ] as readonly (readonly Record<string, unknown>[])[];
  for (const list of lists) {
    const fact = list.find((f) => f.id === c.factId);
    if (!fact) continue;
    const value = fact[c.field];
    if (typeof value === "string") return value;
    if (Array.isArray(value) && c.index !== undefined) {
      const item = value[c.index] as unknown;
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && "text" in item) return String(item.text);
    }
    return undefined;
  }
  return undefined;
}

const STOP = new Set(
  "the and for are was were that this with from into they them their its has have had not but you your our all any can one two who what when how why which".split(
    " ",
  ),
);

/** Words (3+ letters, or any number) of a text, lower-cased; the common short words left out. */
export function contentWords(text: string): Set<string> {
  const words = text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? [];
  return new Set(words.filter((w) => (/\d/.test(w) || w.length >= 3) && !STOP.has(w)));
}

/**
 * The slots a correction reaches: those whose material carries a word the correction took out
 * (in the old text, not in the new one) that the corrected facts no longer say anywhere (`still`,
 * every word of them), so a topic word the rest of the facts repeat does not reach every slot. A
 * correction that only adds words reaches none: nothing wrong is on a slide.
 */
export function correctedSlots(
  corrections: readonly { before: string; after: string }[],
  slots: readonly { key: number; material: string }[],
  still: ReadonlySet<string> = new Set(),
): number[] {
  const removed = new Set<string>();
  for (const c of corrections) {
    const after = contentWords(c.after);
    for (const w of contentWords(c.before)) if (!after.has(w) && !still.has(w)) removed.add(w);
  }
  if (removed.size === 0) return [];
  return slots
    .filter((s) => [...contentWords(s.material)].some((w) => removed.has(w)))
    .map((s) => s.key);
}

/** Every word the facts say, for `correctedSlots`' `still`. */
export function factsWords(facts: DesignCycleFacts): Set<string> {
  return contentWords(
    [
      ...facts.keyIdeas.flatMap((k) => [k.statement, k.explanation, k.example, k.analogy ?? ""]),
      ...facts.misconceptions.flatMap((m) => [m.belief, m.correction]),
      ...facts.vocabulary.flatMap((v) => [v.term, v.definition]),
      ...facts.workedExamples.flatMap((x) => [x.problem, ...x.steps, x.answer]),
    ].join(" "),
  );
}

export type FactsFeedContext = {
  deps: PipelineDeps;
  cls: "frontier" | "standard";
  topic: string;
  shape: LessonShape;
  audience: Audience;
  objectives: readonly Objective[];
  durationMin: number;
  priorKnowledge?: string | undefined;
  sources?: Parameters<PipelineDeps["sources"]>[0] | undefined;
  retrieval?: { question: string; answer: string }[] | undefined;
  /** When the design step began, for the timings. */
  startedAt: number;
  verifyEffort: "low" | "medium" | "high";
};

export type ObjectiveFeed = {
  /** The teach call's facts; `undefined` when it failed (the cycle runs without facts). */
  facts: Promise<FedFacts | undefined>;
  /** Verify over them: the corrected facts and the corrections with the text each replaced. */
  verified: Promise<
    { facts: FedFacts; corrections: { before: string; after: string }[] } | undefined
  >;
  timing: FactsFeedTiming;
};

/**
 * Start the feed: the curriculum extract read once (as the facts step reads it), then per
 * objective the teach call and, the moment it returns, Verify over its facts. Nothing is awaited
 * here; a failed teach call logs and resolves `undefined`, and an abort rejects.
 */
export function startFactsFeed(ctx: FactsFeedContext): ObjectiveFeed[] {
  const { deps, objectives } = ctx;
  const curriculum = (async () => {
    const loaded = ctx.sources ? await deps.sources(ctx.sources) : [];
    const { selected } = selectSourceTexts(loaded, { maxChars: SOURCE_TEXT_MAX_CHARS });
    return selected.length > 0 ? { text: selected.map((s) => s.text).join("\n\n") } : undefined;
  })();
  return objectives.map((_, target) => {
    const timing: FactsFeedTiming = { objective: target, corrections: 0, refilled: [] };
    const facts = (async (): Promise<FedFacts | undefined> => {
      const input: PlanTeachObjectiveInput = {
        topic: ctx.topic,
        shape: ctx.shape,
        audience: ctx.audience,
        objectives: objectives.map((o) => ({ text: o.text })),
        target,
        priorKnowledge: ctx.priorKnowledge,
        curriculum: await curriculum,
        ...retrievalInput({ retrieval: ctx.retrieval }),
      };
      deps.logger.info({ stage: "generate", call: "teach", target }, "plan call");
      try {
        const call = await callStructured({
          deps,
          stage: "plan",
          cls: ctx.cls,
          effort: plannerEffort(undefined, "facts"),
          prompt: planTeachObjectivePrompt,
          input,
          schema: planTeachObjectiveOutputSchemaFor(input),
          soft: planTeachObjectiveOutputSchemaFor(input, { soft: true }),
          maxOutputTokens: MAX_OUTPUT_TOKENS_TEACH,
        });
        timing.teachMs = Date.now() - ctx.startedAt;
        const lesson = taughtAsLessonFacts(call.output, objectives, target, ctx.durationMin);
        return { cycle: cycleFactsOf(lesson), lesson };
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
        timing.failed = true;
        deps.logger.warn(
          {
            stage: "generate",
            call: "teach",
            target,
            err: error instanceof Error ? error.message : String(error),
          },
          "facts feed: teach call failed; the cycle runs without facts",
        );
        return undefined;
      }
    })();
    const verified = facts.then(async (fed) => {
      if (!fed) return undefined;
      const result = await runVerify(
        fed.lesson,
        { topic: ctx.topic, audience: ctx.audience },
        deps,
        ctx.cls,
        ctx.verifyEffort,
      );
      timing.verifyMs = Date.now() - ctx.startedAt;
      timing.corrections = result.applied.length;
      const corrections = result.applied.map((c) => ({
        before: correctedText(fed.lesson, c) ?? "",
        after: c.value,
      }));
      return {
        facts: { cycle: cycleFactsOf(result.facts), lesson: result.facts },
        corrections,
      };
    });
    // Neither promise may reject unobserved while the design step is busy elsewhere.
    facts.catch(() => undefined);
    verified.catch(() => undefined);
    return { facts, verified, timing };
  });
}
