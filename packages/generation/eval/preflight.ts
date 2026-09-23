#!/usr/bin/env bun
// bun packages/generation/eval/preflight.ts --models <id,id,…> [--effort low|medium|high]
//
// One tiny structured call per model id with the Plan skeleton's real output schema, the pipeline's
// own provider options and the stage's effort — the same wire shape a bench call has, at ~1/50 of
// the tokens. Reports: HTTP ok, JSON parsed, provider that served it, output/reasoning tokens, cost.
// With --effort-check it also calls at low and high and says whether the setting changed the
// reasoning tokens (through the gateway it silently does not on some routes). Never a bench run.

import { createAi } from "@tj/ai";
import { generateText, jsonSchema, Output } from "ai";
import { z } from "zod";
import { isGoogleModelId, providerOptionsFor } from "../src/call";
import { PlanSkeletonSchema } from "../src/specs";

// The skeleton's JSON schema on the wire, without zod's lesson rules: the preflight judges transport
// and JSON shape; whether a three-slide toy lesson meets the lesson rules is reported, not required.
function wireOnly(modelId: string) {
  const strip = (node: unknown): unknown =>
    Array.isArray(node)
      ? node.map(strip)
      : node && typeof node === "object"
        ? Object.fromEntries(
            Object.entries(node as Record<string, unknown>)
              .filter(
                ([k]) => !(isGoogleModelId(modelId) && (k === "minItems" || k === "maxItems")),
              )
              .map(([k, v]) => [k, strip(v)]),
          )
        : node;
  return jsonSchema<unknown>(
    strip(
      z.toJSONSchema(PlanSkeletonSchema, { target: "draft-7", unrepresentable: "any" }),
    ) as never,
  );
}

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i === -1 ? undefined : process.argv[i + 1];
};
const flag = (n: string) => process.argv.includes(`--${n}`);
const ids = (arg("models") ?? "").split(",").filter(Boolean);
if (!ids.length) {
  console.error("usage: preflight.ts --models <id,…> [--effort low|medium|high] [--effort-check]");
  process.exit(2);
}
const ai = createAi(
  {
    AI_GATEWAY_API_KEY: process.env.AI_GATEWAY_API_KEY,
    AWS_BEARER_TOKEN_BEDROCK: process.env.AWS_BEARER_TOKEN_BEDROCK,
    AI_MODEL_SMALL: ids[0],
  },
  { route: (_c, ctx) => ctx?.stage },
);
const PROMPT =
  "A Year 4 history lesson, 20 minutes, on Roman roads. Give the skeleton: two objectives and an outline of exactly three slides (title, objectives, content) with minutes summing to 20, each with a one-sentence brief. photographable: no.";
type Row = {
  id: string;
  effort: string;
  ok: boolean;
  rules?: string;
  via?: string;
  ms: number;
  out?: number;
  reason?: number;
  cost?: number;
  note?: string;
};
async function one(id: string, effort: "low" | "medium" | "high"): Promise<Row> {
  const t = Date.now();
  try {
    const r = await generateText({
      model: ai.model("small", { stage: id }),
      prompt: PROMPT,
      output: Output.object({ schema: wireOnly(id) }),
      maxOutputTokens: 1200,
      maxRetries: 0,
      ...providerOptionsFor(id, effort),
    });
    const gw = (
      r.providerMetadata as { gateway?: { cost?: string; routing?: { finalProvider?: string } } }
    )?.gateway;
    const ot = r.usage.outputTokens as unknown as { total?: number; reasoning?: number } | number;
    return {
      id,
      effort,
      ok: r.output !== undefined,
      via: gw?.routing?.finalProvider,
      ms: Date.now() - t,
      out: typeof ot === "number" ? ot : ot?.total,
      reason: typeof ot === "number" ? undefined : ot?.reasoning,
      cost: Number(gw?.cost ?? 0),
      note: r.finishReason !== "stop" ? `finish=${r.finishReason}` : undefined,
    };
  } catch (e) {
    let x = e as { statusCode?: number; message?: string; cause?: unknown };
    const parts: string[] = [];
    for (let n = 0; x && n < 4; n++, x = x.cause as never)
      parts.push(`${x.statusCode ?? ""} ${String(x.message).slice(0, 80)}`);
    return { id, effort, ok: false, ms: Date.now() - t, note: parts.join(" ← ") };
  }
}
const rows: Row[] = [];
const effort = (arg("effort") ?? "medium") as "low" | "medium" | "high";
for (const id of ids) {
  rows.push(await one(id, effort));
  if (flag("effort-check")) {
    rows.push(await one(id, "low"));
    rows.push(await one(id, "high"));
  }
}
console.log(
  "| model | effort | transport+JSON | lesson rules | via | ms | out | reasoning | $ | note |",
  "\n|---|---|---|---|---|---:|---:|---:|---:|---|",
);
for (const r of rows)
  console.log(
    `| ${r.id} | ${r.effort} | ${r.ok ? "✓" : "✗"} | ${r.rules ?? "-"} | ${r.via ?? "-"} | ${r.ms} | ${r.out ?? "-"} | ${r.reason ?? "-"} | ${(r.cost ?? 0).toFixed(4)} | ${r.note ?? ""} |`,
  );
if (flag("effort-check"))
  for (const id of ids) {
    const lo = rows.find((r) => r.id === id && r.effort === "low"),
      hi = rows.find((r) => r.id === id && r.effort === "high");
    if (lo?.ok && hi?.ok)
      console.log(
        `effort ${id}: ${(lo.reason ?? lo.out ?? 0) < (hi.reason ?? hi.out ?? 0) ? "HONOURED" : "NOT HONOURED"} (low ${lo.reason ?? lo.out} vs high ${hi.reason ?? hi.out} reasoning/out tokens)`,
      );
  }
console.log(`total $${rows.reduce((s, r) => s + (r.cost ?? 0), 0).toFixed(4)}`);
