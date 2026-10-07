// Pre-launch diagram smoke gate (round 5; judges' point d). Exits 1, and the run must not launch,
// when (1) any kind's spec schema is one OpenAI would refuse (round 4: tuples gave every particles
// spec a 400), or (2) a saved spec (`<run>/diagrams.jsonl` from earlier runs, else the drawer's
// own samples) no longer parses or draws at the slide's figure panel or full width.
// Usage: bun lab/bakeoff/smoke-diagrams.ts [runDir ...]
import { existsSync, readFileSync } from "node:fs";
import { z } from "../../packages/generation/node_modules/zod";
import { drawDiagram } from "../../packages/slides/src/diagrams/draw";
import { DIAGRAM_SAMPLES } from "../../packages/slides/src/diagrams/samples";
import { DiagramSpecSchema } from "../../packages/slides/src/diagrams/schema";
import { getTheme } from "../../packages/slides/src/themes";
import { openaiSchema } from "./services";

export function schemaFaults(): string[] {
  const bad: string[] = [];
  const walk = (n: unknown, path: string) => {
    if (Array.isArray(n)) {
      n.forEach((x, i) => {
        walk(x, `${path}[${i}]`);
      });
      return;
    }
    if (!n || typeof n !== "object") return;
    const o = n as Record<string, unknown>;
    if (Array.isArray(o.items) || "prefixItems" in o) bad.push(`tuple at ${path}`);
    for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`);
  };
  for (const opt of DiagramSpecSchema.options as unknown as {
    shape: { kind: { value: string } };
  }[])
    walk(
      openaiSchema(z.toJSONSchema(opt as never, { target: "draft-7" } as never)),
      opt.shape.kind.value,
    );
  return bad;
}

export function drawFaults(specs: { key: string; spec: unknown }[]): string[] {
  const theme = getTheme("studio", "ks3");
  const bad: string[] = [];
  for (const { key, spec } of specs) {
    const side = drawDiagram(spec, theme, { x: 0, y: 0, w: 348, h: 284 });
    const wide = drawDiagram(spec, theme, { x: 0, y: 0, w: 788, h: 235 });
    if (!side.ok && !wide.ok)
      bad.push(`${key}: ${(wide.reasons ?? side.reasons ?? []).slice(0, 2).join("; ")}`);
  }
  return bad;
}

if (import.meta.main) {
  const specs: { key: string; spec: unknown }[] = [];
  for (const dir of process.argv.slice(2))
    if (existsSync(`${dir}/diagrams.jsonl`))
      for (const l of readFileSync(`${dir}/diagrams.jsonl`, "utf8").split("\n").filter(Boolean)) {
        const r = JSON.parse(l) as { key: string; spec: unknown };
        specs.push({ key: `${dir.split("/").pop()} ${r.key}`, spec: r.spec });
      }
  // The drawer's samples only warn (they are the diagram agent's fixtures); saved run specs block.
  const samples = Object.entries(DIAGRAM_SAMPLES).map(([k, v]) => ({
    key: `sample ${k}`,
    spec: v,
  }));
  const faults = [...schemaFaults(), ...drawFaults(specs)];
  const warn = drawFaults(samples);
  if (warn.length) console.log(`SMOKE-WARN (drawer samples)\n${warn.join("\n")}`);
  console.log(
    faults.length
      ? `SMOKE-FAIL\n${faults.join("\n")}`
      : `SMOKE-OK ${specs.length} saved specs, ${samples.length} samples, every kind's schema clean`,
  );
  process.exit(faults.length ? 1 : 0);
}
