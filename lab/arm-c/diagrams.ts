// Arm C: draw_diagram. Real: one gpt-6-luna spec call (diagram-spec.txt + DIAGRAM_CONTRACT, JSON schema
// of the kind) then the repo's drawer. Stub: the drawer's own sample spec for the kind (no call).
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "../../packages/generation/node_modules/zod/index.js";
import {
  DIAGRAM_CONTRACT,
  DiagramSpecSchema,
} from "../../packages/generation/src/plan-write/diagram-spec.ts";
import { parseDiagram, renderDiagram } from "../../packages/slides/src/diagrams/index.ts";
import { DIAGRAM_SAMPLES } from "../../packages/slides/src/diagrams/samples.ts";
import { getTheme } from "../../packages/slides/src/themes.ts";
import type { Tokens } from "./tokens.ts";

export interface DiagramAsk {
  slide: number;
  kind: string;
  request: string;
  width: number;
  height: number;
}
export type DiagramResult =
  | {
      ok: true;
      diagram_id: string;
      src: string;
      width: number;
      height: number;
      alt: string;
      labels: string[];
    }
  | { ok: false; reason: string };
export type DrawDiagram = (ask: DiagramAsk, id: string, context: string) => Promise<DiagramResult>;

const KINDS: string[] = DiagramSpecSchema.options.map((o: any) => o.shape.kind.value);
const P = { in: 0.1, cached: 0.01, out: 0.5 }; // openai/gpt-6-luna, packages/ai/src/prices.ts

function labelsOf(spec: any): string[] {
  const out: string[] = [];
  const walk = (v: any, k?: string) => {
    if (typeof v === "string") {
      if (k && /label|caption|name|text|step|title|header/i.test(k) && v.length <= 40) out.push(v);
      return;
    }
    if (Array.isArray(v)) {
      for (const x of v) walk(x, k);
    } else if (v && typeof v === "object")
      for (const [kk, vv] of Object.entries(v)) if (kk !== "alt") walk(vv, kk);
  };
  walk(spec);
  return [...new Set(out)].slice(0, 24);
}

function draw(
  spec: unknown,
  ask: DiagramAsk,
  id: string,
  tk: Tokens,
  runDir: string,
): DiagramResult {
  const parsed = parseDiagram(spec);
  if (!parsed)
    return {
      ok: false,
      reason: `the spec did not fit the drawing's limits: ${(
        DiagramSpecSchema.safeParse(spec).error?.issues ?? []
      )
        .map((x: any) => `${x.path.join(".")}: ${x.message}`)
        .join("; ")
        .slice(0, 400)}`,
    };
  // The drawer works in slide points (960 wide); the canvas is 1920, so half size, scaled up by the SVG.
  const svg = renderDiagram(spec, getTheme(tk.themeId, tk.ks), {
    w: ask.width / 2,
    h: ask.height / 2,
  });
  if (!svg) return { ok: false, reason: "the drawer could not draw this spec at that size" };
  writeFileSync(join(runDir, "assets", `${id}.svg`), svg);
  return {
    ok: true,
    diagram_id: id,
    src: `assets/${id}.svg`,
    width: ask.width,
    height: ask.height,
    alt: (parsed as any).alt ?? "",
    labels: labelsOf(spec),
  };
}

const check = (ask: DiagramAsk): string | undefined =>
  !KINDS.includes(ask.kind)
    ? `unknown kind "${ask.kind}"; kinds: ${KINDS.join(", ")}`
    : !(ask.width >= 160 && ask.height >= 120)
      ? "width and height must be at least 160 x 120"
      : ask.width > 1920 || ask.height > 1080
        ? "larger than the canvas"
        : undefined;

export function stubDiagrams(tk: Tokens, runDir: string): DrawDiagram {
  return async (ask, id) => {
    const bad = check(ask);
    if (bad) return { ok: false, reason: bad };
    const spec = Object.values(DIAGRAM_SAMPLES).find((s: any) => s.kind === ask.kind);
    if (!spec) return { ok: false, reason: `stub has no sample for ${ask.kind}` };
    return draw(spec, ask, id, tk, runDir);
  };
}

export function realDiagrams(
  tk: Tokens,
  runDir: string,
  yearGroup: string,
  costs: { diagrams: number },
  log: (r: unknown) => void,
): DrawDiagram {
  const KEY = readFileSync(`${homedir()}/.dayback-openai-key`, "utf8").trim();
  const SYSTEM = `${readFileSync(resolve(import.meta.dir, "prompts/diagram-spec.txt"), "utf8").trim()}\n\n${DIAGRAM_CONTRACT}`;
  return async (ask, id, context) => {
    const bad = check(ask);
    if (bad) return { ok: false, reason: bad };
    const kindSchema = DiagramSpecSchema.options.find((o: any) => o.shape.kind.value === ask.kind)!;
    const schema = z.toJSONSchema(kindSchema as any, { target: "draft-7" });
    const user = `${yearGroup}\nKind: ${ask.kind}\nRequest: ${ask.request}\n\nThe slide:\n${context}`;
    const t0 = performance.now();
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-6-luna",
        reasoning_effort: "low",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: user },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "diagram", strict: false, schema },
        },
      }),
    });
    const j: any = await r.json();
    if (!r.ok) return { ok: false, reason: `diagram service error ${r.status}` };
    const u = j.usage;
    const c = u.prompt_tokens_details?.cached_tokens ?? 0;
    const usd = ((u.prompt_tokens - c) * P.in + c * P.cached + u.completion_tokens * P.out) / 1e6;
    costs.diagrams += usd;
    let spec: unknown;
    try {
      spec = JSON.parse(j.choices[0].message.content);
    } catch {
      spec = undefined;
    }
    log({ kind: "diagram-spec", id, ms: Math.round(performance.now() - t0), usd, user, spec });
    return draw(spec, ask, id, tk, runDir);
  };
}
