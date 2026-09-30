/*
 * Design-cycle smoke (lesson designer plan, TEACH-201): plan-objectives (with the arc), then one
 * streamed design-cycle call per objective, in parallel, on gpt-6-luna at effort low, OpenAI
 * direct. No pipeline, no DB. Writes one JSON per brief with the objectives, every call's output,
 * time to first complete slot, total time, tokens and cost. Refuses to start a brief once the
 * spend file's total plus a reserve passes the cap.
 *
 *   bun eval/design-cycle-smoke.ts --out <dir> --spend <file.json> --cap 0.10 [--effort low|medium] <brief.json>...
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename } from "node:path";
import { paletteMenu } from "@tj/slides";
import { Output, streamText } from "ai";
import { createOpenAI } from "../../ai/node_modules/@ai-sdk/openai";
import { allocate } from "../src/planner/cycles";
import { designCyclePrompt, designCycleSchemaFor } from "../src/prompts/design-cycle";
import {
  type ObjectiveArc,
  planObjectivesOutputSchemaFor,
  planObjectivesPrompt,
} from "../src/prompts/plan-objectives";
import { lessonShapeOf } from "../src/shapes";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const out = flag("--out") ?? "runs/design-cycle";
const spendFile = flag("--spend") ?? `${out}/spend.json`;
const cap = Number(flag("--cap") ?? "0.10");
const only = flag("--objectives-from"); // reuse a previous run's objectives (dir)
const effort = flag("--effort") ?? "low"; // design-cycle calls only; objectives stay at low
mkdirSync(out, { recursive: true });

const openai = createOpenAI({
  apiKey: readFileSync(`${homedir()}/.dayback-openai-key`, "utf8").trim(),
});
const model = openai("gpt-6-luna");
const providerOptions = { openai: { reasoningEffort: "low", strictJsonSchema: false } };
const cycleOptions = { openai: { reasoningEffort: effort, strictJsonSchema: false } };
const PRICE = { in: 0.1e-6, cached: 0.01e-6, out: 0.5e-6 };
const RESERVE = 0.02;

type Usage = {
  inputTokens?: number;
  outputTokens?: number;
  inputTokenDetails?: { cacheReadTokens?: number };
};
function cost(u: Usage): number {
  const cached = u.inputTokenDetails?.cacheReadTokens ?? 0;
  return (
    ((u.inputTokens ?? 0) - cached) * PRICE.in +
    cached * PRICE.cached +
    (u.outputTokens ?? 0) * PRICE.out
  );
}
const readSpend = (): number => {
  try {
    return JSON.parse(readFileSync(spendFile, "utf8")).total_usd as number;
  } catch {
    return 0;
  }
};
const addSpend = (usd: number) => {
  const total = readSpend() + usd;
  writeFileSync(spendFile, JSON.stringify({ cap_usd: cap, total_usd: total }, null, 1));
};

async function call<T>(
  system: string,
  prompt: string,
  schema: import("zod").ZodType<T>,
  firstUnit?: (p: unknown) => boolean,
  options = providerOptions,
) {
  const t0 = performance.now();
  let tFirst: number | undefined;
  const result = streamText({
    model,
    system,
    prompt,
    output: Output.object({ schema }),
    providerOptions: options,
    maxOutputTokens: 12000,
  });
  for await (const partial of result.partialOutputStream) {
    if (tFirst === undefined && firstUnit?.(partial)) tFirst = performance.now() - t0;
  }
  const text = await result.text;
  const usage = (await result.usage) as Usage;
  const totalMs = performance.now() - t0;
  let output: T | undefined;
  let error: string | undefined;
  try {
    output = (await result.output) as T;
  } catch (e) {
    const raw = (() => {
      try {
        return JSON.parse(text);
      } catch {
        return undefined;
      }
    })();
    const parsed = raw === undefined ? undefined : schema.safeParse(raw);
    error =
      parsed && !parsed.success
        ? JSON.stringify(parsed.error.issues).slice(0, 1500)
        : String(e).slice(0, 500);
  }
  const usd = cost(usage);
  addSpend(usd);
  return {
    output,
    error,
    raw: output ? undefined : text,
    usage,
    usd,
    totalMs,
    firstMs: tFirst ?? totalMs,
  };
}

for (const file of args) {
  const id = basename(file, ".json");
  if (readSpend() + RESERVE > cap) {
    console.error(`REFUSED ${id}: spend ${readSpend().toFixed(4)} + ${RESERVE} > cap ${cap}`);
    continue;
  }
  const b = JSON.parse(readFileSync(file, "utf8"));
  const audience = { subject: b.subject, yearGroup: b.yearGroup };
  const shape = lessonShapeOf(undefined, { yearGroup: b.yearGroup });
  const topic: string = b.brief.topic;
  const slideCount: number = b.brief.slideCount;

  let objectivesCall: Awaited<ReturnType<typeof call>> | { output: unknown; reused: string };
  if (only) {
    const prev = JSON.parse(readFileSync(`${only}/${id}.json`, "utf8"));
    objectivesCall = { output: prev.objectives.output, reused: only };
  } else {
    objectivesCall = await call(
      planObjectivesPrompt.system,
      planObjectivesPrompt.user({ topic, shape, audience }),
      planObjectivesOutputSchemaFor(false),
    );
  }
  const objectives = (
    objectivesCall.output as
      | { objectives: { text: string; arc?: ObjectiveArc | undefined }[] }
      | undefined
  )?.objectives;
  if (!objectives) {
    writeFileSync(`${out}/${id}.json`, JSON.stringify({ id, objectives: objectivesCall }, null, 1));
    console.log(`${id}: objectives failed`);
    continue;
  }
  const palette = paletteMenu(b.subject);
  // The production allocator (planner/cycles.ts): minimums first, the rest by arc weight.
  const allocation = allocate(
    slideCount,
    objectives.map((o) => o.arc),
  ).cycles;
  const cycles = await Promise.all(
    objectives.map((_, i) => {
      const cycle = allocation[i] as (typeof allocation)[number];
      const input = {
        topic,
        shape,
        audience,
        objectives,
        objectiveIndex: i,
        slots: {
          count: cycle.count,
          first: cycle.first,
          slideCount,
          roles: cycle.roles,
        },
        palette,
      };
      return call(
        designCyclePrompt.system,
        designCyclePrompt.user(input),
        designCycleSchemaFor(b.subject, cycle.count),
        (p) => {
          const slots = (p as { slots?: unknown[] } | undefined)?.slots;
          return Array.isArray(slots) && (slots.length >= 2 || "exitQuestion" in (p as object));
        },
        cycleOptions,
      ).then((r) => ({
        objectiveIndex: i,
        slots: cycle,
        roles: cycle.roles,
        ...r,
      }));
    }),
  );
  const row = {
    id,
    versions: { objectives: planObjectivesPrompt.version, cycle: designCyclePrompt.version },
    effort,
    objectives: objectivesCall,
    cycles,
  };
  writeFileSync(`${out}/${id}.json`, JSON.stringify(row, null, 1));
  const usd =
    ("usd" in objectivesCall ? objectivesCall.usd : 0) + cycles.reduce((s, c) => s + c.usd, 0);
  console.log(
    `${id}: ${objectives.length} obj; cycles ${cycles.map((c) => `${c.error ? "INVALID" : "ok"} first ${(c.firstMs / 1000).toFixed(1)}s total ${(c.totalMs / 1000).toFixed(1)}s`).join(" | ")}; $${usd.toFixed(4)}; spend ${readSpend().toFixed(4)}`,
  );
}
