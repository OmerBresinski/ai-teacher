/*
 * Structure bench (Option A, arm "plain"): the objectives + structure call on its own, streamed
 * from OpenAI direct (Chat Completions, strict json_schema). Per call it records input, cached and
 * output (and reasoning) tokens, time to first token, time to objectives (the stream reaching the
 * "slides" key), total time, cost, schema validity and the code checks in `structureChecks`.
 * Calls run one at a time, so latency is not skewed by our own concurrency. A call is refused once
 * the spend file's total plus a reserve (1.5x the dearest call so far) would pass the cap.
 *
 *   bun eval/structure-bench.ts --out <dir> --spend <file.json> --cap 0.08 \
 *     [--model gpt-6.1-sol] [--effort low] [--counts 10,15] <brief.json>...
 *
 * A brief file is { brief: { topic, durationMin?, classContext? }, subject, yearGroup }.
 * Output: <out>/<brief>-<n>.json per call, <out>/summary.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename } from "node:path";
import {
  planStructureJsonSchema,
  planStructurePlainPrompt,
  planStructureSchemaFor,
  structureChecks,
} from "../src/prompts/plan-structure-plain";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const out = flag("--out") ?? "runs/structure-bench";
const spendFile = flag("--spend") ?? `${out}/spend.json`;
const cap = Number(flag("--cap") ?? "0.08");
const model = flag("--model") ?? "gpt-6.1-sol";
const effort = flag("--effort") ?? "low";
const counts = (flag("--counts") ?? "10,15").split(",").map(Number);
const tag = flag("--tag") ?? "";
const order = flag("--order") ?? "interleave"; // interleave: brief i at counts[i % k] first
const maxOut = Number(flag("--max-out") ?? "6000");
mkdirSync(out, { recursive: true });

const key = readFileSync(`${homedir()}/.dayback-openai-key`, "utf8").trim();
// Per 1M tokens, from developers.openai.com/api/docs/pricing (30 Sept 2026).
const PRICES: Record<string, { in: number; cached: number; out: number }> = {
  "gpt-6.1-sol": { in: 2, cached: 0.1, out: 10 },
  "gpt-6-luna": { in: 0.1, cached: 0.01, out: 0.5 },
};
const priceOf = PRICES[model];
if (!priceOf) throw new Error(`no price for ${model}`);
const price = priceOf;

const readSpend = (): { total_usd: number; calls: number } => {
  try {
    return JSON.parse(readFileSync(spendFile, "utf8"));
  } catch {
    return { total_usd: 0, calls: 0 };
  }
};
const addSpend = (usd: number) => {
  const s = readSpend();
  writeFileSync(
    spendFile,
    JSON.stringify({ cap_usd: cap, total_usd: s.total_usd + usd, calls: s.calls + 1 }, null, 1),
  );
};

type Brief = {
  brief: { topic: string; durationMin?: number; classContext?: Record<string, unknown> };
  subject: string;
  yearGroup: string;
};

async function run(file: string, slideCount: number) {
  const id = basename(file, ".json");
  const b: Brief = JSON.parse(readFileSync(file, "utf8"));
  const system = planStructurePlainPrompt.system(b.subject);
  const user = planStructurePlainPrompt.user({
    topic: b.brief.topic,
    durationMin: b.brief.durationMin,
    audience: {
      subject: b.subject,
      yearGroup: b.yearGroup,
      classContext: b.brief.classContext as never,
    },
    slideCount,
  });
  const t0 = performance.now();
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      reasoning_effort: effort,
      max_completion_tokens: maxOut,
      stream: true,
      stream_options: { include_usage: true },
      response_format: { type: "json_schema", json_schema: planStructureJsonSchema(b.subject) },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok || !res.body) {
    return { id, slideCount, error: `${res.status} ${await res.text()}` };
  }
  let text = "";
  // biome-ignore lint/suspicious/noExplicitAny: raw OpenAI usage block
  let usage: any;
  let ttft: number | undefined;
  let tObjectives: number | undefined;
  let buf = "";
  const decoder = new TextDecoder();
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true });
    let nl = buf.indexOf("\n");
    while (nl >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      nl = buf.indexOf("\n");
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      const j = JSON.parse(data);
      if (j.usage) usage = j.usage;
      const delta: string | undefined = j.choices?.[0]?.delta?.content;
      if (delta) {
        const now = performance.now() - t0;
        ttft ??= now;
        text += delta;
        if (tObjectives === undefined && text.includes('"slides"')) tObjectives = now;
      }
    }
  }
  const totalMs = Math.round(performance.now() - t0);
  const inTok = usage?.prompt_tokens ?? 0;
  const cached = usage?.prompt_tokens_details?.cached_tokens ?? 0;
  const outTok = usage?.completion_tokens ?? 0;
  const reasoning = usage?.completion_tokens_details?.reasoning_tokens ?? 0;
  const cost = ((inTok - cached) * price.in + cached * price.cached + outTok * price.out) / 1e6;
  addSpend(cost);

  let parsed: unknown;
  let schemaOk = false;
  let schemaError: string | undefined;
  let checks: ReturnType<typeof structureChecks> | undefined;
  try {
    parsed = JSON.parse(text);
    const r = planStructureSchemaFor(b.subject).safeParse(parsed);
    schemaOk = r.success;
    if (r.success) checks = structureChecks(r.data, slideCount, b.subject);
    else schemaError = r.error.message.slice(0, 400);
  } catch (e) {
    schemaError = String(e).slice(0, 200);
  }
  return {
    id,
    slideCount,
    model,
    effort,
    prompt: planStructurePlainPrompt.version,
    tokens: { input: inTok, cached, output: outTok, reasoning, visible: outTok - reasoning },
    ms: {
      ttft: ttft === undefined ? null : Math.round(ttft),
      objectives: tObjectives === undefined ? null : Math.round(tObjectives),
      total: totalMs,
    },
    cost,
    valid: schemaOk && !!checks?.valid,
    schemaOk,
    schemaError,
    checks,
    system,
    user,
    output: parsed ?? text,
  };
}

const files = args;
const jobs: [string, number][] = [];
if (order === "interleave") {
  // Each brief at its first count, alternating counts across briefs, then the other counts.
  for (let round = 0; round < counts.length; round++)
    for (const [i, f] of files.entries())
      jobs.push([f, counts[(i + round) % counts.length] as number]);
} else {
  for (const n of counts) for (const f of files) jobs.push([f, n]);
}

// Reserve before the first measured call: the worst case when --max-out bounds it.
let dearest = Math.min(0.02, (1000 * price.in + maxOut * price.out) / 1e6 / 1.5);
// biome-ignore lint/suspicious/noExplicitAny: bench rows (result or error)
const rows: any[] = [];
for (const [file, n] of jobs) {
  const spent = readSpend().total_usd;
  if (spent + dearest * 1.5 > cap) {
    console.log(
      `stop: spent $${spent.toFixed(4)} + reserve $${(dearest * 1.5).toFixed(4)} > cap $${cap}`,
    );
    break;
  }
  // biome-ignore lint/suspicious/noExplicitAny: bench row (result or error)
  const r: any = await run(file, n);
  if (r.cost) dearest = rows.length === 0 ? r.cost : Math.max(dearest, r.cost);
  rows.push(r);
  writeFileSync(`${out}/${r.id}-${n}${tag}.json`, JSON.stringify(r, null, 1));
  console.log(
    r.error
      ? `${r.id}-${n} ERROR ${r.error.slice(0, 200)}`
      : `${r.id}-${n} valid=${r.valid} in=${r.tokens.input} out=${r.tokens.output} (r ${r.tokens.reasoning}) ttft=${r.ms.ttft} obj=${r.ms.objectives} total=${r.ms.total} $${r.cost.toFixed(4)} ${r.checks?.problems.join("; ") ?? r.schemaError ?? ""}`,
  );
}

const ok = rows.filter((r) => !r.error);
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const summary = {
  model,
  effort,
  prompt: planStructurePlainPrompt.version,
  calls: rows.length,
  errors: rows.length - ok.length,
  valid: ok.filter((r) => r.valid).length,
  tokens: {
    inputMean: mean(ok.map((r) => r.tokens.input)),
    cachedMean: mean(ok.map((r) => r.tokens.cached)),
    outputMean: mean(ok.map((r) => r.tokens.output)),
    reasoningMean: mean(ok.map((r) => r.tokens.reasoning)),
  },
  ms: Object.fromEntries(
    (["ttft", "objectives", "total"] as const).map((k) => {
      const xs = ok.map((r) => r.ms[k]).filter((x): x is number => x != null);
      return [k, { p50: pct(xs, 50), p90: pct(xs, 90) }];
    }),
  ),
  costMean: mean(ok.map((r) => r.cost)),
  costTotal: ok.reduce((a, r) => a + r.cost, 0),
  byCount: Object.fromEntries(
    counts.map((n) => {
      const xs = ok.filter((r) => r.slideCount === n);
      return [
        n,
        {
          calls: xs.length,
          valid: xs.filter((r) => r.valid).length,
          outputMean: mean(xs.map((r) => r.tokens.output)),
          costMean: mean(xs.map((r) => r.cost)),
        },
      ];
    }),
  ),
};
writeFileSync(`${out}/summary${tag}.json`, JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
