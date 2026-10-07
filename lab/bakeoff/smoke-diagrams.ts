// Pre-launch diagram smoke gate (round 5; judges' point d). Exits 1, and the run must not launch,
// when (1) the schema the lab sends for any kind (`diagramJsonSchema`, lab/r5-diag wire form) has a
// tuple or another form OpenAI refuses (round 4: every particles spec got a 400), or (2) a saved
// lesson spec (lab/r5-diag fixture, plus `<run>/diagrams.jsonl` of any run given) no longer draws
// at the slide's figure panel or full width. The drawer's own samples only warn.
// Usage: bun lab/bakeoff/smoke-diagrams.ts [runDir ...]
import { existsSync, readFileSync } from "node:fs";
import { drawDiagram } from "../../packages/slides/src/diagrams/draw";
import { withLongLabels } from "../../packages/slides/src/diagrams/index";
import { DIAGRAM_SAMPLES } from "../../packages/slides/src/diagrams/samples";
import { DiagramSpecSchema } from "../../packages/slides/src/diagrams/schema";
import { diagramJsonSchema, openaiSchemaFaults } from "../../packages/slides/src/diagrams/wire";
import { getTheme, withKeyStage } from "../../packages/slides/src/themes";

const KINDS = (
  DiagramSpecSchema.options as unknown as { shape: { kind: { value: string } } }[]
).map((o) => o.shape.kind.value);

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
  for (const kind of KINDS) {
    const sent = diagramJsonSchema(kind as never);
    walk(sent, kind);
    for (const f of openaiSchemaFaults(sent)) bad.push(`${kind}: ${f}`);
  }
  return bad;
}

export function drawFaults(specs: { key: string; spec: unknown; ks?: string }[]): string[] {
  const bad: string[] = [];
  for (const { key, spec, ks } of specs) {
    const st = (ks ?? "ks3") as "ks1";
    const theme = getTheme("studio", st);
    const draw = (w: number, h: number) =>
      withKeyStage(st, () => withLongLabels(() => drawDiagram(spec, theme, { x: 0, y: 0, w, h })));
    const side = draw(348, 284);
    const wide = draw(788, 235);
    if (!side.ok && !wide.ok)
      bad.push(`${key}: ${(wide.reasons ?? side.reasons ?? []).slice(0, 2).join("; ")}`);
  }
  return bad;
}

export function savedSpecs(dirs: string[]): { key: string; spec: unknown; ks?: string }[] {
  const specs: { key: string; spec: unknown; ks?: string }[] = [];
  const FIX = `${import.meta.dir}/../../packages/generation/src/plan-write/fixtures/diagram-lesson-specs.json`;
  if (existsSync(FIX))
    // A fixture marked `refused` is one the drawer is meant to refuse: not a smoke failure.
    for (const r of JSON.parse(readFileSync(FIX, "utf8")) as {
      name: string;
      ks?: string;
      spec: unknown;
      refused?: boolean;
    }[])
      if (!r.refused) specs.push({ key: `fixture ${r.name}`, spec: r.spec, ks: r.ks });
  for (const dir of dirs)
    if (existsSync(`${dir}/diagrams.jsonl`))
      for (const l of readFileSync(`${dir}/diagrams.jsonl`, "utf8").split("\n").filter(Boolean)) {
        const r = JSON.parse(l) as { key: string; spec: unknown };
        specs.push({ key: `${dir.split("/").pop()} ${r.key}`, spec: r.spec });
      }
  return specs;
}

/**
 * Round 6: specs that must always draw. BC/AD timelines (y4 r5 failed both tries on a period given
 * as years), one with a period as years and one with no period.
 */
export const MUST_DRAW: { key: string; spec: unknown; ks?: string }[] = [
  {
    key: "r6 timeline BC/AD period as years",
    ks: "ks2",
    spec: {
      kind: "timeline",
      title: "Three important dates",
      alt: "Timeline from 55 BC to AD 43.",
      events: [
        { date: "55 BC", text: "Caesar's first expedition" },
        { date: "54 BC", text: "Caesar's second expedition" },
        { date: "AD 43", text: "Claudius's invasion" },
      ],
      period: { from: -55, to: 43, label: "55 BC to AD 43" },
    },
  },
  {
    key: "r6 timeline BC/AD no period",
    ks: "ks2",
    spec: {
      kind: "timeline",
      alt: "Timeline from 753 BC to AD 410.",
      events: [
        { date: "753 BC", text: "Rome founded" },
        { date: "27 BC", text: "Augustus becomes emperor" },
        { date: "AD 43", text: "Invasion of Britain" },
        { date: "AD 410", text: "Romans leave Britain" },
      ],
    },
  },
  {
    key: "r6 timeline period label missing",
    ks: "ks3",
    spec: {
      kind: "timeline",
      alt: "Timeline of 1923.",
      events: [
        { date: "Jan 1923", text: "Ruhr occupied" },
        { date: "Sep 1923", text: "Passive resistance ends" },
        { date: "Nov 1923", text: "Rentenmark introduced" },
      ],
      period: { from: 1, to: 3 },
    },
  },
];

if (import.meta.main) {
  const specs = [...savedSpecs(process.argv.slice(2)), ...MUST_DRAW];
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
      : `SMOKE-OK ${specs.length} saved specs, ${KINDS.length} kinds' sent schemas clean`,
  );
  process.exit(faults.length ? 1 : 0);
}
