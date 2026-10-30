// TEACH-110 part ad: which diagram kinds draw cleanly at a split compare side, by kind sample. Since
// TEACH-247 part cg the template checks each spec itself (`splitSideDrawn`); this is a survey only.
// Run: bun scripts/split-side-kinds.ts (W, H override the 360 x 230 side box).
import { readFileSync } from "node:fs";
import { drawDiagram } from "../src/diagrams";
import { DIAGRAM_SAMPLES } from "../src/diagrams/samples";
import { atKeyStage, getTheme } from "../src/themes";

const fx = JSON.parse(
  readFileSync("../generation/src/writer/fixtures/split-side-diagrams.json", "utf8"),
);
const specs: [string, any][] = Object.entries(DIAGRAM_SAMPLES).map(([k, v]) => [k, v]);
for (const [k, s] of Object.entries<any>(fx))
  for (const [n, d] of (s.sides as any[]).entries())
    specs.push([`forces-${k}-${n}`, d.picture.diagram]);
const box = { x: 0, y: 0, w: Number(process.env.W ?? 360), h: Number(process.env.H ?? 230) };
const by: Record<string, { pass: number; fail: string[] }> = {};
for (const [name, spec] of specs)
  for (const ks of ["ks2", "ks3", "ks4"]) {
    const t = atKeyStage(getTheme("paper"), ks);
    const r: any = drawDiagram(spec, t, { ...box });
    const kind = String((spec as any).kind);
    by[kind] ??= { pass: 0, fail: [] };
    if (r.ok && !r.warnings && r.rung === 0) by[kind].pass++;
    else
      by[kind].fail.push(
        `${name}@${ks}: ${r.ok ? (r.warnings ? r.warnings[0] : `rung ${r.rung}`) : r.reasons[0]}`.slice(
          0,
          140,
        ),
      );
  }
for (const [k, v] of Object.entries(by))
  console.log(v.fail.length ? "FAIL" : "PASS", k, v.pass, v.fail.slice(0, 2).join(" || "));
// Max labels: every label-like string padded to the writer's 24-character label cap.
const pad = (o: any, key = ""): any =>
  typeof o === "string" &&
  !["kind", "alt", "state", "type", "fill", "side", "canvas", "shape", "color", "subject"].includes(
    key,
  ) &&
  !/^-?[\d.]+$/.test(o)
    ? `${o} matter flows`.slice(0, 24).trim()
    : Array.isArray(o)
      ? o.map((x) => pad(x, key))
      : o && typeof o === "object"
        ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, pad(v, k)]))
        : o;
console.log("--- max labels (24 chars)");
for (const kind of [
  "cycle",
  "equal-groups",
  "fraction-shapes",
  "layers",
  "number-line",
  "particles",
  "timeline",
  "venn",
])
  for (const [name, spec] of specs.filter(([, s]) => s.kind === kind)) {
    const bad = ["ks2", "ks3", "ks4"].flatMap((ks) => {
      const r: any = drawDiagram(pad(spec), atKeyStage(getTheme("paper"), ks), { ...box });
      return r.ok && !r.warnings && r.rung === 0
        ? []
        : [`${ks}: ${r.ok ? (r.warnings?.[0] ?? `rung ${r.rung}`) : r.reasons[0]}`];
    });
    console.log(bad.length ? "FAIL" : "PASS", kind, name, bad.slice(0, 1).join("").slice(0, 120));
  }
