import { BudgetReservationError, withGenerationBudget } from "@tj/ai";
import type { LessonFacts, OutlineEntry } from "@tj/domain/documents";
import { generateText, isStepCount, Output } from "ai";
import { z } from "zod";
import { providerOptionsFor } from "../call";
import { withCallDeadline } from "../call-deadline";
import { type Audience, audienceBlock } from "../prompts/shared";
import { BudgetExceeded, callContext, type PipelineDeps } from "../types";
import { measureDraft, type SlideDraft } from "./measure-slide";

/*
 * Fit planner (lab fit-5, "planner with a measure tool"). Before the teaching slides are written,
 * one model call drafts the words of every `content` and `worked-example` slide from its facts and
 * checks each draft with `measure` (`measure-slide.ts`: the real layout on every theme). A draft
 * that does not fit is reorganised, not shortened: the callout comes off, a key idea moves to a
 * content slide of the same objective with room, or a worked example drops its heading. The slide
 * count never changes. The drafts go to `generate-slide` as the slide's planned words; the moves
 * (key ideas, callouts) are applied to the outline entries in code, and only when they keep every
 * key idea on exactly one slide of its own objective.
 */

export const fitPlanPrompt = {
  version: "plan-fit.v1",
  system: [
    "You plan the words of a lesson's teaching slides so that each slide fits as planned.",
    "",
    "For each slide listed, draft what pupils read, from the facts given for it:",
    "- content: `heading` states the key idea (with two key ideas, what joins them); `body` gives, for each key idea, the reason it holds and then its example, one paragraph per idea, separated by a blank line.",
    "- worked-example: `question` is the problem; `steps` are its working in order, at most four, one line each, ending with the conclusion; `heading` is optional.",
    "- `callout`: one line for pupils, only on a slide listed with a callout; otherwise null.",
    "",
    "Check your drafts with the `measure` tool (send several slides in one call). It says whether each draft fits one slide on every theme, how many lines it runs over, and whether its callout found room.",
    "When a draft does not fit, reorganise the slide rather than shorten its words: take the callout off (null, and put its point in `notes`); move a key idea to another content slide listed under the same objective that has room; on a worked example, leave out the heading. Every key idea stays on a content slide. Measure again after a change.",
    "",
    'Answer with every listed slide: its position, the ids of the key ideas it teaches (content only, such as "k2"), its final draft, and `notes` for anything moved off it.',
  ].join("\n"),
  user(input: FitPlanInput): string {
    const parts = [`Lesson: ${input.lessonTitle}`, audienceBlock(input.audience), ""];
    for (const s of input.slides) {
      parts.push(
        `Slide ${s.position} (${s.kind}), objective ${s.objective}${s.callout ? `, callout "${s.callout.kind}"` : ""}:`,
      );
      for (const line of s.facts) parts.push(`  ${line}`);
    }
    return parts.join("\n");
  },
} as const;

export type FitPlanInput = {
  lessonTitle: string;
  audience: Audience;
  slides: {
    position: number;
    kind: "content" | "worked-example";
    objective: string;
    callout?: { kind: string } | undefined;
    facts: string[];
  }[];
};

const CALLOUT_KIND = z.enum(["watch-out", "key-words", "example", "tip"]);

const DraftInput = z.object({
  position: z.number().int(),
  heading: z.string().optional(),
  body: z.string().optional(),
  question: z.string().optional(),
  steps: z.array(z.string()).optional(),
  callout: z.string().nullable().optional(),
});

const PlanOutput = z.object({
  slides: z.array(
    DraftInput.extend({
      keyIdeas: z.array(z.string()).optional(),
      notes: z.string().optional(),
    }),
  ),
});
type PlanOutput = z.infer<typeof PlanOutput>;

export type PlannedSlide = { entry: OutlineEntry; planned: SlideDraft; notes?: string | undefined };

const TEACHING = new Set(["content", "worked-example"]);
const MAX_STEPS = 6;

/** The teaching entries' facts as plain lines, and the key ideas' objectives. */
function inputOf(facts: LessonFacts): {
  slides: FitPlanInput["slides"];
  positions: number[];
} {
  const byId = new Map<string, string>();
  const line = (id: string): string | undefined => {
    const k = (facts.keyIdeas ?? []).find((f) => f.id === id);
    if (k) return `${id} key idea: ${k.statement} Why: ${k.explanation} Example: ${k.example}`;
    const x = facts.workedExamples.find((f) => f.id === id);
    if (x)
      return `${id} worked example: ${x.problem} Steps: ${x.steps.map((s, n) => `(${n + 1}) ${s}`).join(" ")} Answer: ${x.answer}`;
    const v = facts.vocabulary.find((f) => f.id === id);
    if (v) return `${id} term: ${v.term}: ${v.definition}`;
    const m = facts.misconceptions.find((f) => f.id === id);
    if (m) return `${id} misconception: ${m.belief} Correction: ${m.correction}`;
    return byId.get(id);
  };
  const slides: FitPlanInput["slides"] = [];
  const positions: number[] = [];
  facts.outline.forEach((entry, i) => {
    if (!TEACHING.has(entry.kind)) return;
    const objective = entry.factRefs.find((r) => r.startsWith("o")) ?? "o1";
    const lines = entry.factRefs.filter((r) => !r.startsWith("o")).flatMap((r) => line(r) ?? []);
    const calloutRefs = (entry.callout?.factRefs ?? []).filter((r) => !entry.factRefs.includes(r));
    for (const r of calloutRefs) {
      const l = line(r);
      if (l) lines.push(`for the callout: ${l}`);
    }
    slides.push({
      position: i + 1,
      kind: entry.kind as "content" | "worked-example",
      objective,
      callout: entry.callout ? { kind: entry.callout.kind } : undefined,
      facts: lines,
    });
    positions.push(i);
  });
  return { slides, positions };
}

/**
 * The plan applied to the outline: per outline index, the entry to write (key ideas and callout
 * as planned) and its planned words. A content slide's key-idea moves are kept only when every
 * key idea the teaching slides started with is still on exactly one of them, under its own
 * objective, and no content slide is left without one; otherwise each keeps its own.
 */
export function applyFitPlan(
  facts: LessonFacts,
  plan: PlanOutput,
  input: FitPlanInput,
): Map<number, PlannedSlide> {
  const out = new Map<number, PlannedSlide>();
  const objectiveOf = new Map((facts.keyIdeas ?? []).map((k) => [k.id, k.objectiveRefs ?? []]));
  const drafts = new Map(plan.slides.map((s) => [s.position - 1, s]));
  const content = input.slides.filter((s) => s.kind === "content").map((s) => s.position - 1);
  const before = content.flatMap((i) =>
    (facts.outline[i]?.factRefs ?? []).filter((r) => r.startsWith("k")),
  );
  const after = content.flatMap((i) => drafts.get(i)?.keyIdeas ?? []);
  const movesOk =
    before.length === after.length &&
    new Set(after).size === after.length &&
    before.every((k) => after.includes(k)) &&
    content.every((i) => {
      const ks = drafts.get(i)?.keyIdeas ?? [];
      const entry = facts.outline[i];
      return (
        ks.length > 0 &&
        ks.length <= 2 &&
        ks.every((k) => (objectiveOf.get(k) ?? []).some((o) => entry?.factRefs.includes(o)))
      );
    });
  for (const s of input.slides) {
    const i = s.position - 1;
    const entry = facts.outline[i];
    const d = drafts.get(i);
    if (!entry || !d) continue;
    let factRefs = entry.factRefs;
    let brief = entry.brief;
    if (entry.kind === "content") {
      const own = entry.factRefs.filter((r) => r.startsWith("k"));
      const ks = movesOk ? (d.keyIdeas ?? own) : own;
      const changed = ks.length !== own.length || ks.some((k) => !own.includes(k));
      // A draft written for other key ideas than the slide keeps is not its words.
      const drafted = d.keyIdeas ?? own;
      if (!movesOk && (drafted.length !== own.length || drafted.some((k) => !own.includes(k))))
        continue;
      if (changed) {
        factRefs = [...entry.factRefs.filter((r) => !r.startsWith("k")), ...ks];
        const statements = ks.map(
          (k) => (facts.keyIdeas ?? []).find((f) => f.id === k)?.statement ?? k,
        );
        brief = { ...entry.brief, adds: `Explains: ${statements.join(" Then: ")}`.slice(0, 160) };
      }
    }
    const keepCallout = entry.callout && d.callout ? entry.callout : undefined;
    const { callout: _drop, ...rest } = entry;
    const next: OutlineEntry = {
      ...rest,
      factRefs,
      ...(brief ? { brief } : {}),
      ...(keepCallout ? { callout: keepCallout } : {}),
    };
    const planned: SlideDraft = {
      kind: s.kind,
      heading: d.heading,
      body: d.body,
      question: d.question,
      steps: d.steps?.slice(0, MAX_STEPS),
      callout:
        keepCallout && d.callout
          ? { kind: CALLOUT_KIND.parse(keepCallout.kind), text: d.callout }
          : undefined,
    };
    out.set(i, { entry: next, planned, notes: d.notes });
  }
  return out;
}

/**
 * One tool-using call: the drafts are measured by `measure` as the model plans. Failure of any
 * kind returns an empty map and the slides are written as before.
 */
export async function planFit(
  facts: LessonFacts,
  meta: { lessonTitle: string; audience: Audience; themeId: string },
  deps: Pick<PipelineDeps, "ai" | "budget" | "signal" | "logger" | "context">,
): Promise<Map<number, PlannedSlide>> {
  const { slides } = inputOf(facts);
  if (slides.length === 0) return new Map();
  const input: FitPlanInput = { lessonTitle: meta.lessonTitle, audience: meta.audience, slides };
  const kindAt = new Map(slides.map((s) => [s.position, s]));
  // gpt-6-luna on Chat Completions (the direct route) takes tools only at effort "none".
  const effort = "none" as const;
  const exceeded = deps.budget.exceeded();
  if (exceeded) throw new BudgetExceeded(exceeded.by);
  const routed = deps.ai.model(
    "small",
    callContext(deps, "generate", fitPlanPrompt.version, effort),
  );
  const modelId = typeof routed === "string" ? routed : routed.modelId;
  const model = withGenerationBudget(routed, modelId, deps.budget);
  const trace: unknown[] = [];
  let measures = 0;
  let rounds = 0;
  const t0 = Date.now();
  try {
    const result = await withCallDeadline(deps.signal, 120_000, (abortSignal) =>
      generateText({
        model,
        system: fitPlanPrompt.system,
        prompt: fitPlanPrompt.user(input),
        tools: {
          measure: {
            description:
              "Measure drafts of teaching slides on the real slide layout, every theme. Returns per slide: fits, linesOver, calloutPlaced.",
            inputSchema: z.object({ slides: z.array(DraftInput) }),
            execute: async ({ slides: drafts }: { slides: z.infer<typeof DraftInput>[] }) => {
              rounds += 1;
              const out = drafts.map((d) => {
                measures += 1;
                const s = kindAt.get(d.position);
                if (!s) return { position: d.position, error: "not a listed slide" };
                const callout =
                  s.callout && d.callout
                    ? { kind: CALLOUT_KIND.catch("tip").parse(s.callout.kind), text: d.callout }
                    : undefined;
                return {
                  position: d.position,
                  ...measureDraft({ ...d, kind: s.kind, callout }, meta.themeId),
                };
              });
              trace.push(out);
              return out;
            },
          },
        },
        stopWhen: isStepCount(7),
        // The last step answers: no measure call left unanswered at the limit.
        prepareStep: ({ stepNumber }: { stepNumber: number }) =>
          stepNumber >= 6 ? { toolChoice: "none" as const } : {},
        output: Output.object({ schema: PlanOutput }),
        abortSignal,
        maxOutputTokens: 8000,
        maxRetries: 0,
        ...providerOptionsFor(modelId, effort),
      }),
    );
    const plan = result.output as PlanOutput;
    // Lab only: what the planner answered and what each round measured.
    deps.logger.info(
      {
        stage: "generate",
        call: "plan-fit",
        listed: slides.map((s) => s.position),
        answered: plan.slides.map((s) => ({
          p: s.position,
          k: s.keyIdeas,
          c: s.callout ? s.callout.length : null,
          h: s.heading?.length,
          b: s.body?.length,
          st: s.steps?.map((x) => x.length),
        })),
        trace,
      },
      "fit plan trace",
    );
    const applied = applyFitPlan(facts, plan, input);
    const fitted = [...applied.values()].map((p) => measureDraft(p.planned, meta.themeId).fits);
    deps.logger.info(
      {
        stage: "generate",
        call: "plan-fit",
        promptVersion: fitPlanPrompt.version,
        ms: Date.now() - t0,
        steps: result.steps.length,
        rounds,
        measures,
        slides: applied.size,
        fits: fitted.filter(Boolean).length,
        calloutsOff: [...applied.values()].filter(
          (p, n) => !p.entry.callout && facts.outline[[...applied.keys()][n] ?? -1]?.callout,
        ).length,
      },
      "fit plan written",
    );
    return applied;
  } catch (error) {
    if (error instanceof BudgetReservationError) throw new BudgetExceeded(error.by);
    deps.logger.warn(
      {
        stage: "generate",
        call: "plan-fit",
        ms: Date.now() - t0,
        rounds,
        error: String(
          (error as { cause?: { message?: string; responseBody?: string } }).cause?.responseBody ??
            (error as { cause?: { message?: string } }).cause?.message ??
            (error instanceof Error ? error.message : error),
        ).slice(0, 400),
      },
      "fit plan failed; slides written unplanned",
    );
    return new Map();
  }
}
