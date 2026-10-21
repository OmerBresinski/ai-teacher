import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ConfiguredAi } from "@tj/ai";
import { DEFAULT_MODEL_IDS, DEFAULT_REGION } from "@tj/ai";
import { createFakeAi, type FakeCall, type FakeReply, type FakeScriptEntry } from "@tj/ai/testing";
import { FIXTURES, scriptedWorksheetAi } from "@tj/generation/testing";
import type { Env } from "./env";

/*
 * `AI_FAKE_SCRIPT=pipeline` (ADR 0025 §22): the e2e worker runs the real handlers over the
 * scripted fake instead of Bedrock, so a browser test can create a lesson and watch it arrive,
 * edit a fact and watch the cascade land. One script per job — keyed on the `jobId` the pipeline
 * puts in every call's context — because a `FakeAi` consumes its answers in call order and two
 * jobs would otherwise share one run. `lesson.plan` gets the fixture run (the review answer
 * carries one lesson-level warning, so the finished editor has a residual to show); a
 * `lesson.cascade` / `lesson.regenerate` call is answered from the prompt's `kind "…"` /
 * `type "…"` with the fixture spec of that kind, with the teacher's instruction (when any) echoed
 * into the first text so the change is visible. `AI_FAKE_DELAY_MS` paces the answers so slides
 * are visibly written one at a time. Never constructed in production (`env.ts` refuses it).
 */

/**
 * The residual the fake's Evaluate answer reports: a lesson-level `pitch` warning that
 * `knownTargetsWithEvidence` keeps — its evidence is a term from the fixture facts (TEACH-216).
 */
export const FAKE_REVIEW_WARNING = {
  check: "pitch",
  severity: "warning" as const,
  target: {},
  evidence: FIXTURES.planFacts.vocabulary[0]?.term ?? "Particle",
  message: "Consider a diagram for this age group.",
};

/** What the fake writes into a re-derived slide's first text so a test can see the cascade landed. */
export const FAKE_PROPOSAL_MARK = "Updated to match";

/** A proposal answer: the fixture spec for the kind named in the prompt, marked as re-derived. */
export function proposalAnswer(call: FakeCall): string {
  const slideKind = /kind "([a-z-]+)"/.exec(call.promptText)?.[1];
  const blockType = /type "([a-z-]+)"/.exec(call.promptText)?.[1];
  const instruction = /The teacher asks: (.+)/.exec(call.promptText)?.[1]?.trim();
  const mark = instruction ? `${FAKE_PROPOSAL_MARK} (${instruction})` : FAKE_PROPOSAL_MARK;
  if (slideKind) {
    const spec = FIXTURES.slides[slideKind as keyof typeof FIXTURES.slides];
    if (spec) return JSON.stringify(markSpec(spec as Record<string, unknown>, mark));
  }
  if (blockType) {
    const spec = FIXTURES.worksheet.blocks.find((b) => b.type === blockType);
    if (spec) return JSON.stringify(markSpec(spec as unknown as Record<string, unknown>, mark));
  }
  return JSON.stringify({});
}

/**
 * Prefix the first text a spec exposes (title, heading, stem, … or the first `items` entry) with
 * `mark`, cut to the tightest spec limit (60) so the answer still validates.
 */
function markSpec(spec: Record<string, unknown>, mark: string): Record<string, unknown> {
  const marked = (value: string) => `${mark}: ${value}`.slice(0, 60);
  for (const key of ["title", "heading", "stem", "statement", "prompt", "question"]) {
    const value = spec[key];
    if (typeof value === "string") return { ...spec, [key]: marked(value) };
  }
  const items = spec.items;
  if (Array.isArray(items) && typeof items[0] === "string") {
    return { ...spec, items: [marked(items[0]), ...items.slice(1)] };
  }
  return spec;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A topic carrying this phrase holds its lesson's review (TEACH-202 part j): every slide is
 * written, then the generate job's `evaluate` call waits until the job is cancelled. A spec that
 * clicks Stop after the slides arrive would otherwise race the paced run, which finishes about two
 * seconds after its first slide; a cancel that lands after the job completed rightly reports
 * `completed`, so the spec failed whenever CI was slow to deliver the click.
 */
export const FAKE_HOLD_TOPIC = "held at review";
/** How long a held review waits for its cancel before answering, so no job is stuck forever. */
export const FAKE_HOLD_MAX_MS = 60_000;

/** Resolves when `signal` aborts or `maxMs` passes, whichever is first. */
function waitForAbort(signal: AbortSignal | undefined, maxMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, maxMs);
    signal?.addEventListener("abort", done, { once: true });
  });
}

const OUTLINE_INDICES_BY_COUNT = {
  6: [0, 1, 2, 4, 7, 9],
  8: [0, 1, 2, 4, 5, 6, 7, 9],
  10: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
} as const;
const MINUTES_BY_COUNT = {
  6: [3, 4, 8, 20, 18, 7],
  8: [2, 3, 5, 12, 8, 10, 15, 5],
  10: [2, 3, 4, 5, 10, 6, 8, 9, 9, 4],
} as const;

/** The e2e fake follows the call's prompt version, so split plan/generate jobs never drift. */
function pipelineAnswer(
  call: FakeCall,
  selectedOutlineByJob: Map<string, readonly number[]>,
): string {
  const version = call.context?.promptVersion ?? "";
  if (version.startsWith("check-input"))
    return JSON.stringify({ findings: [], historical_period: null, fiction_in_period: false });
  if (version.startsWith("plan-skeleton")) {
    const requested = Number(/outline has exactly (\d+) slides/.exec(call.promptText)?.[1] ?? 10);
    const indices = OUTLINE_INDICES_BY_COUNT[requested as keyof typeof OUTLINE_INDICES_BY_COUNT];
    const skeleton = FIXTURES.planSkeleton;
    if (indices) selectedOutlineByJob.set(call.context?.jobId ?? "", indices);
    const outline = indices
      ? indices.map((index, position) => ({
          ...skeleton.outline[index],
          minutes: MINUTES_BY_COUNT[requested as keyof typeof MINUTES_BY_COUNT][position],
        }))
      : skeleton.outline;
    return JSON.stringify({
      ...skeleton,
      outline,
    });
  }
  if (version.startsWith("plan-facts")) {
    const indices = selectedOutlineByJob.get(call.context?.jobId ?? "");
    if (!indices) return JSON.stringify(FIXTURES.planFacts);
    return JSON.stringify({
      ...FIXTURES.planFacts,
      outlineFactRefs: FIXTURES.planFacts.outlineFactRefs
        .filter((entry) => indices.includes(entry.index))
        .map((entry) => ({ ...entry, index: indices.indexOf(entry.index) })),
    });
  }
  if (version.startsWith("verify-facts")) return JSON.stringify(FIXTURES.verify);
  if (version.startsWith("generate-slide")) {
    const kind = /kind "([a-z-]+)"/.exec(call.promptText)?.[1];
    const spec = kind ? FIXTURES.slides[kind as keyof typeof FIXTURES.slides] : undefined;
    return JSON.stringify(spec ?? {});
  }
  if (version.startsWith("evaluate")) {
    return JSON.stringify({ findings: [FAKE_REVIEW_WARNING] });
  }
  if (version.startsWith("repair")) return JSON.stringify(FIXTURES.repair);
  return JSON.stringify({});
}

/** The writer planner's calls carry `lesson-writer.v1/<name>` (`aiWriterServices`). */
const WRITER_PREFIX = "lesson-writer.v1/";
/** About three tokens a piece: the size of a streamed model delta. */
const REPLAY_PIECE_CHARS = 12;

/**
 * A recorded writer run (live writing P0, TEACH-202 part d): a replay fixture folder
 * (`packages/generation/src/writer/fixtures/replay/<lesson>`) whose `main.json` holds the writer's
 * text, its time to first token and its whole time, plus the run's objectives and notes.
 */
export type WriterReplay = {
  main: { text: string; ms: number; firstTokenMs?: number; finishReason?: string | null };
  objectives: string[];
  notes: unknown;
};

export function loadWriterReplay(dir: string): WriterReplay {
  const read = (f: string) => readFileSync(join(dir, f), "utf8");
  const main = JSON.parse(read("main.json")) as WriterReplay["main"];
  const objectives = (
    JSON.parse(read("objectives.json")) as { objectives: { teacher: string }[] }
  ).objectives.map((o) => o.teacher);
  let notes: unknown = null;
  try {
    const text = read("notes.json").trim();
    notes = text ? JSON.parse(text) : null;
  } catch {
    notes = null;
  }
  return { main, objectives, notes };
}

/**
 * The replay's answer to a writer-planner call, or `undefined` for any other call. The writer's
 * own call streams the recorded text at the recorded pace: nothing for `firstTokenMs`, then pieces
 * of about three tokens spread over the rest of the recorded time, so the local stack sees the
 * stream a real lesson made. The objectives and notes calls get the run's own answers; any other
 * writer call (pupil wording, a drawer, a repair) gets `{}`, which the stage survives.
 */
export function writerReplayAnswer(call: FakeCall, replay: WriterReplay): FakeReply | undefined {
  const version = call.context?.promptVersion ?? "";
  if (!version.startsWith(WRITER_PREFIX)) return undefined;
  const name = version.slice(WRITER_PREFIX.length);
  if (name === "lesson") {
    const { text, ms, firstTokenMs = 0 } = replay.main;
    const pieces = Math.max(1, Math.ceil(text.length / REPLAY_PIECE_CHARS));
    const finish = replay.main.finishReason;
    return {
      text,
      ...(finish === "length" || finish === "stop" ? { finishReason: finish } : {}),
      stream: {
        pieceChars: REPLAY_PIECE_CHARS,
        paceMs: Math.max(1, Math.round(Math.max(0, ms - firstTokenMs) / pieces)),
        firstMs: firstTokenMs,
      },
    };
  }
  if (name === "objectives") return { text: JSON.stringify({ objectives: replay.objectives }) };
  if (name === "notes" && replay.notes) return { text: JSON.stringify(replay.notes) };
  return { text: "{}" };
}

export function createPerJobFakeAi(
  env: Pick<Env, "AI_FAKE_DELAY_MS"> & Partial<Pick<Env, "AI_FAKE_WRITER_REPLAY">>,
  opts: { holdMaxMs?: number } = {},
): ConfiguredAi {
  const replay = env.AI_FAKE_WRITER_REPLAY
    ? loadWriterReplay(env.AI_FAKE_WRITER_REPLAY)
    : undefined;
  const byJob = new Map<string, ConfiguredAi>();
  const selectedOutlineByJob = new Map<string, readonly number[]>();
  // Lessons whose topic asked for a held review (`FAKE_HOLD_TOPIC`): the topic is in the plan
  // job's prompts, the review is in the generate job, and both carry the lesson id.
  const heldLessons = new Set<string>();
  const holdMaxMs = opts.holdMaxMs ?? FAKE_HOLD_MAX_MS;
  const delay = env.AI_FAKE_DELAY_MS;
  const proposal: FakeScriptEntry = async (call) => {
    if (delay > 0) await sleep(delay);
    return proposalAnswer(call);
  };
  const forJob = (jobId: string, stage: string | undefined): ConfiguredAi => {
    const existing = byJob.get(jobId);
    if (existing) return existing;
    const fake =
      stage === "cascade" || stage === "regenerate"
        ? createFakeAi({ fallback: proposal, usage: { inputTokens: 1000, outputTokens: 400 } })
        : stage === "worksheet"
          ? // The worksheet job (ADR 0030): the fixture fill for the knowledge-check frame, then
            // a block repair should the checks ask for one. Its first call is the fill.
            scriptedWorksheetAi({ repairs: 1, ...(delay > 0 ? { pace: delay } : {}) })
          : createFakeAi({
              fallback: async (call) => {
                const replayed = replay && writerReplayAnswer(call, replay);
                if (replayed) return replayed;
                const lessonId = call.context?.lessonId;
                if (lessonId && call.promptText.includes(FAKE_HOLD_TOPIC))
                  heldLessons.add(lessonId);
                if (
                  lessonId &&
                  heldLessons.has(lessonId) &&
                  call.context?.promptVersion?.startsWith("evaluate")
                ) {
                  await waitForAbort(call.abortSignal, holdMaxMs);
                  // Cancelled (or given up on): a later run of this lesson is not held.
                  heldLessons.delete(lessonId);
                }
                if (delay > 0) await sleep(delay);
                return pipelineAnswer(call, selectedOutlineByJob);
              },
              usage: { inputTokens: 1000, outputTokens: 400 },
            });
    byJob.set(jobId, fake);
    return fake;
  };
  return {
    kind: "bedrock",
    region: DEFAULT_REGION,
    model: (cls, context) => forJob(context?.jobId ?? "", context?.stage).model(cls, context),
    modelId: (cls) => DEFAULT_MODEL_IDS[cls],
  };
}
