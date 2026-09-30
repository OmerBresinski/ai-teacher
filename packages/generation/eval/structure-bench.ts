// Standalone bench for plan-structure-stream-two-part: one streamed call per (brief, slide count),
// direct to OpenAI Chat Completions with a strict JSON schema. Records tokens (input, cached,
// output, reasoning), time to first token, time to objectives (the "slides" key opens), total
// time, cost, schema validity and the code checks. A hard spend cap is enforced before each call.
//
//   bun eval/structure-bench.ts --runs cb-y5-fractions:10,cb-y11-rates:15 --effort low \
//     --briefs-dir <dir> --out <dir> --spend <file.json> --cap 0.08 [--max-out 2400]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import {
  checkStructure,
  type PlanStructureOutput,
  planStructureJsonSchema,
  planStructurePrompt,
  planStructureSchemaFor,
} from "../src/prompts/plan-structure-stream-two-part";

const arg = (k: string, d?: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const MODEL = arg("model", "gpt-6.1-sol")!;
const EFFORT = arg("effort", "low")!;
const MAX_OUT = Number(arg("max-out", "2400"));
const CAP = Number(arg("cap", "0.08"));
const OUT = arg("out")!;
const SPEND = arg("spend")!;
const BRIEFS = arg("briefs-dir")!;
const SUFFIX = arg("suffix", "")!;
const runs = arg("runs")!
  .split(",")
  .map((r) => {
    const [id, n] = r.split(":");
    return { id: id!, n: Number(n) };
  });
// $ per 1M tokens: input, cached input, output (RESEARCH-model.md, 30 Sep 2026).
const PRICE = { in: 2, cached: 0.1, out: 10 };
const key = readFileSync(`${homedir()}/.dayback-openai-key`, "utf8").trim();
mkdirSync(OUT, { recursive: true });
const spend = existsSync(SPEND)
  ? JSON.parse(readFileSync(SPEND, "utf8"))
  : { cap_usd: CAP, total_usd: 0, calls: [] as unknown[] };

async function one(id: string, n: number) {
  const b = JSON.parse(readFileSync(`${BRIEFS}/${id}.json`, "utf8"));
  const cc = b.brief.classContext;
  const input = {
    topic: b.brief.topic,
    subject: b.subject,
    yearGroup: b.yearGroup,
    durationMin: b.brief.durationMin,
    classNotes: [cc?.priorKnowledge, cc?.notes].filter(Boolean).join(" ") || undefined,
    slideCount: n,
  };
  const system = planStructurePrompt.system;
  const user = planStructurePrompt.user(input);
  const reserve =
    ((system.length + user.length) / 3) * (PRICE.in / 1e6) + MAX_OUT * (PRICE.out / 1e6);
  if (spend.total_usd + reserve > CAP)
    return {
      id,
      n,
      skipped: `cap: ${spend.total_usd.toFixed(4)} + reserve ${reserve.toFixed(4)} > ${CAP}`,
    };
  const t0 = performance.now();
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      reasoning_effort: EFFORT,
      max_completion_tokens: MAX_OUT,
      stream: true,
      stream_options: { include_usage: true },
      response_format: { type: "json_schema", json_schema: planStructureJsonSchema(input.subject) },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok || !res.body) return { id, n, error: `${res.status} ${await res.text()}` };
  let text = "";
  let ttft: number | undefined;
  let tObj: number | undefined;
  let usage: any;
  let buf = "";
  const dec = new TextDecoder();
  for await (const chunk of res.body as any) {
    buf += dec.decode(chunk, { stream: true });
    for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      const j = JSON.parse(data);
      if (j.usage) usage = j.usage;
      const d = j.choices?.[0]?.delta?.content;
      if (d) {
        ttft ??= performance.now() - t0;
        text += d;
        if (tObj === undefined && text.includes('"slides"')) tObj = performance.now() - t0;
      }
    }
  }
  const total = performance.now() - t0;
  const cached = usage?.prompt_tokens_details?.cached_tokens ?? 0;
  const cost =
    ((usage.prompt_tokens - cached) * PRICE.in +
      cached * PRICE.cached +
      usage.completion_tokens * PRICE.out) /
    1e6;
  spend.total_usd += cost;
  spend.calls.push({ id, n, effort: EFFORT, cost });
  writeFileSync(SPEND, JSON.stringify(spend, null, 1));
  let parsed: PlanStructureOutput | undefined;
  let schemaError: string | undefined;
  try {
    const r = planStructureSchemaFor(input.subject).safeParse(JSON.parse(text));
    if (r.success) parsed = r.data as PlanStructureOutput;
    else schemaError = r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  } catch (e) {
    schemaError = String(e);
  }
  const issues = parsed ? checkStructure(parsed, input) : [];
  const row = {
    id,
    n,
    model: MODEL,
    effort: EFFORT,
    version: planStructurePrompt.version,
    tokens: {
      input: usage.prompt_tokens,
      cached,
      output: usage.completion_tokens,
      reasoning: usage.completion_tokens_details?.reasoning_tokens ?? 0,
    },
    ms: {
      ttft: Math.round(ttft ?? total),
      objectives: Math.round(tObj ?? total),
      total: Math.round(total),
    },
    cost,
    valid: { schema: !schemaError, checks: parsed ? issues.length === 0 : false },
    schemaError,
    issues,
    user,
    output: parsed ?? text,
  };
  writeFileSync(`${OUT}/${id}-${n}${SUFFIX}.json`, JSON.stringify(row, null, 1));
  return row;
}

const rows: any[] = [];
for (const r of runs) {
  const row = await one(r.id, r.n);
  rows.push(row);
  const x: any = row;
  console.log(
    x.skipped || x.error
      ? `${r.id}-${r.n}: ${x.skipped ?? x.error}`
      : `${r.id}-${r.n}: in ${x.tokens.input} (cached ${x.tokens.cached}) out ${x.tokens.output} (reasoning ${x.tokens.reasoning}) ttft ${x.ms.ttft} obj ${x.ms.objectives} total ${x.ms.total} ms $${x.cost.toFixed(4)} schema ${x.valid.schema} checks ${x.valid.checks} ${x.issues.join(" | ")}`,
  );
  if (x.skipped) break;
}
console.log(`spent ${spend.total_usd.toFixed(4)} of ${CAP}`);
