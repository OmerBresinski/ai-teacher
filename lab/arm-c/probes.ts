// Arm C: probe_slide. Atomic yes/no vision checks on the latest render's 1440 screenshot.
// Real: one call to PROBE_MODEL (default gpt-6-luna) answering the asked probes. Stub: all pass, no call.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

export const PROBE_IDS = [
  "picture_matches_text",
  "diagram_matches_text",
  "one_focal_point",
  "not_too_blank",
  "readable_at_distance",
  "nothing_dangling",
] as const;
export interface ProbeAnswer {
  id: string;
  pass: boolean;
  reason: string;
}
export type Probe = (png: string, ids: string[]) => Promise<ProbeAnswer[]>;

export const stubProbe: Probe = async (png, ids) => {
  readFileSync(png); // the screenshot exists
  return ids.map((id) => ({ id, pass: true, reason: "stub: not judged" }));
};

const PRICES: Record<string, { in: number; cached: number; out: number }> = {
  "gpt-6-luna": { in: 0.1, cached: 0.01, out: 0.5 },
  "gpt-6.1-sol": { in: 2, cached: 0.1, out: 10 },
};

export function realProbe(costs: { probes: number }, log: (r: unknown) => void): Probe {
  const KEY = readFileSync(`${homedir()}/.dayback-openai-key`, "utf8").trim();
  const model = process.env.PROBE_MODEL ?? "gpt-6-luna";
  const q = JSON.parse(
    readFileSync(resolve(import.meta.dir, "prompts/probes.json"), "utf8"),
  ) as Record<string, string>;
  return async (png, ids) => {
    const b64 = readFileSync(png).toString("base64");
    const asked = ids.map((id) => `${id}: ${q[id]}`).join("\n");
    const schema = {
      type: "object",
      additionalProperties: false,
      required: ["answers"],
      properties: {
        answers: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "pass", "reason"],
            properties: {
              id: { type: "string", enum: ids },
              pass: { type: "boolean" },
              reason: { type: "string" },
            },
          },
        },
      },
    };
    const t0 = performance.now();
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        reasoning_effort: "low",
        messages: [
          { role: "system", content: q._system },
          {
            role: "user",
            content: [
              { type: "text", text: asked },
              { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
            ],
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "probes", strict: true, schema },
        },
      }),
    });
    const j: any = await r.json();
    if (!r.ok)
      return ids.map((id) => ({ id, pass: true, reason: `probe unavailable (${r.status})` }));
    const u = j.usage;
    const c = u.prompt_tokens_details?.cached_tokens ?? 0;
    const p = PRICES[model] ?? PRICES["gpt-6.1-sol"];
    const usd = ((u.prompt_tokens - c) * p.in + c * p.cached + u.completion_tokens * p.out) / 1e6;
    costs.probes += usd;
    const out = (JSON.parse(j.choices[0].message.content).answers ?? []) as ProbeAnswer[];
    log({ kind: "probe", model, ids, ms: Math.round(performance.now() - t0), usd, out });
    return ids.map((id) => out.find((a) => a.id === id) ?? { id, pass: true, reason: "no answer" });
  };
}
