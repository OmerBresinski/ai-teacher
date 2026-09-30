// Standalone bench for the objectives + structure call (plan-structure-codes). Streams each call
// against OpenAI direct (key from ~/.dayback-openai-key, never printed) and records tokens (input,
// cached, output, reasoning), time to first token, time to objectives (the `"slides"` key arriving),
// total time, cost and validity (JSON, Zod, and checkStructure's code checks).
//
// Usage: bun eval/structure-bench.ts --briefs dir --ids a,b --n 10,15 [--effort low] [--model gpt-6.1-sol]
//        [--cap 0.08] [--spend file.json] [--out dir] [--suffix ""] [--conc 2] [--dry]
// The cap is hard: a call starts only if spent + in-flight reserve + its own reserve fits under it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import {
  checkStructure,
  planStructureCodesPrompt as P,
  PlanStructureOutputSchema,
  planStructureJsonSchema,
} from "../src/prompts/plan-structure-codes";
import { shapeBlock } from "../src/prompts/shape";
import { lessonShapeOf } from "../src/shapes";

const arg = (k: string, d?: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const briefsDir = arg("briefs")!;
const ids = arg("ids")!.split(",");
const counts = arg("n", "10")!.split(",").map(Number);
const effort = arg("effort", "low")!;
const model = arg("model", "gpt-6.1-sol")!;
const cap = Number(arg("cap", "0.08"));
const spendFile = arg("spend");
const outDir = arg("out");
const suffix = arg("suffix", "")!;
const conc = Number(arg("conc", "2"));
const dry = process.argv.includes("--dry");
const PRICE = { in: 2, cached: 0.1, out: 10 }; // $ per 1M tokens, gpt-6.1-sol

type Spend = { cap: number; spent: number; calls: { id: string; cost: number; at: string }[] };
const spend: Spend =
  spendFile && existsSync(spendFile)
    ? JSON.parse(readFileSync(spendFile, "utf8"))
    : { cap, spent: 0, calls: [] };
spend.cap = cap;
const saveSpend = () => spendFile && writeFileSync(spendFile, JSON.stringify(spend, null, 1));

function inputOf(id: string, n: number) {
  const b = JSON.parse(readFileSync(`${briefsDir}/${id}.json`, "utf8"));
  const shape = lessonShapeOf(b.brief.answers, { yearGroup: b.yearGroup });
  return {
    topic: b.brief.topic,
    subject: b.subject,
    yearGroup: b.yearGroup,
    shapeLine: shapeBlock(shape)[0]!,
    slideCount: n,
    priorKnowledge: b.brief.classContext?.priorKnowledge,
  };
}

const key = dry ? "" : readFileSync(`${homedir()}/.dayback-openai-key`, "utf8").trim();

async function one(id: string, n: number) {
  const input = inputOf(id, n);
  const system = P.system(input.subject);
  const user = P.user(input);
  const t0 = performance.now();
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      reasoning_effort: effort,
      max_completion_tokens: 2500,
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
  if (!r.ok || !r.body) return { id, n, err: `${r.status} ${await r.text()}` };
  let text = "";
  let ttft: number | undefined;
  let tObj: number | undefined;
  let usage: any;
  let buf = "";
  const dec = new TextDecoder();
  for await (const chunk of r.body as any) {
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
  const inTok = usage?.prompt_tokens ?? 0;
  const outTok = usage?.completion_tokens ?? 0;
  const cost = ((inTok - cached) * PRICE.in + cached * PRICE.cached + outTok * PRICE.out) / 1e6;
  let parsed: any;
  let issues: string[] = [];
  try {
    parsed = JSON.parse(text);
  } catch {
    issues.push("json");
  }
  const z = PlanStructureOutputSchema.safeParse(parsed);
  if (parsed && !z.success)
    issues.push(`zod: ${z.error.issues.map((i) => i.path.join(".")).join(",")}`);
  if (z.success) issues = issues.concat(checkStructure(z.data, n, input.subject));
  return {
    id,
    n,
    model,
    effort,
    version: P.version,
    in: inTok,
    cached,
    out: outTok,
    reasoning: usage?.completion_tokens_details?.reasoning_tokens,
    visible: outTok - (usage?.completion_tokens_details?.reasoning_tokens ?? 0),
    ttftMs: ttft && Math.round(ttft),
    objMs: tObj && Math.round(tObj),
    totalMs: Math.round(total),
    cost,
    valid: issues.length === 0,
    issues,
    output: parsed ?? text,
    system,
    user,
    at: new Date().toISOString(),
  };
}

// Brief-major order: each brief's counts run together, so a cap cut still leaves paired rows.
const jobs = ids.flatMap((id) => counts.map((n) => [id, n] as const));
if (dry) {
  const [id, n] = jobs[0]!;
  const i = inputOf(id, n);
  console.log(`${P.system(i.subject)}\n\n--- user\n${P.user(i)}`);
  console.log(`\n--- schema\n${JSON.stringify(planStructureJsonSchema(i.subject))}`);
  process.exit(0);
}
let reserve = 0.012;
let inflight = 0;
const rows: any[] = [];
let next = 0;
let stopped = 0;
async function worker() {
  while (next < jobs.length) {
    if (spend.spent + (inflight + 1) * reserve > cap) {
      stopped = jobs.length - next;
      next = jobs.length;
      return;
    }
    const [id, n] = jobs[next++]!;
    inflight++;
    const row: any = await one(id, n);
    inflight--;
    rows.push(row);
    if (row.cost) {
      spend.spent += row.cost;
      spend.calls.push({ id: `${id}-${n}${suffix}`, cost: row.cost, at: row.at });
      reserve = Math.max(reserve, row.cost * 1.5);
      saveSpend();
    }
    if (outDir) {
      mkdirSync(outDir, { recursive: true });
      writeFileSync(`${outDir}/${id}-${n}${suffix}.json`, JSON.stringify(row, null, 1));
    }
    console.log(
      row.err
        ? `${id}-${n} ERR ${row.err.slice(0, 300)}`
        : `${id}-${n} in ${row.in}/${row.cached} out ${row.out} (r ${row.reasoning}) ttft ${row.ttftMs} obj ${row.objMs} total ${row.totalMs} $${row.cost.toFixed(4)} ${row.valid ? "OK" : JSON.stringify(row.issues)}`,
    );
  }
}
await Promise.all(Array.from({ length: conc }, worker));
console.log(`spent $${spend.spent.toFixed(4)} of $${cap}; not started ${stopped}`);
