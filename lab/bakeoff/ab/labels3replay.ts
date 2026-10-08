// faults-3-6-8 #3 ($0, drawer stage): every diagram spec the four base4-era reps saved, drawn with the
// labels3 switch off and on. Counts the particles label faults before and after, checks each still
// draws, and checks every non-particles spec draws byte for byte the same.
// bun lab/bakeoff/ab/labels3replay.ts
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { drawDiagram } from "../../../packages/slides/src/diagrams/draw";
import {
  NON_PARTICLE,
  SHARED,
  setParticleLabelMend,
} from "../../../packages/slides/src/diagrams/labels3";
import { mendSpec } from "../../../packages/slides/src/diagrams/normalise";
import { THEMES } from "../../../packages/slides/src/themes";
import { AB } from "./arms";

export const REPS = ["b3-r2-1", "b3-r2-2", "base4-3", "base4-4"];
const theme = THEMES.find((t) => t.id === "studio") as (typeof THEMES)[number];
const accent2 = theme.colors.accent2;
let n = 0;
/** The live drawing path (drawDiagram mends, then lays out): its SVG, or undefined if it cannot draw. */
const draw = (spec: unknown): string | undefined => {
  const d = drawDiagram(spec, theme, { x: 0, y: 0, w: 560, h: 420 }, () => `id${n++}`);
  return d.ok ? decodeURIComponent(String(d.element.src)) : undefined;
};

/** The fault-3 label faults of one (mended) particles spec and its drawing. */
export function labelFaults(s: Record<string, any>, svg?: string): string[] {
  const v: string[] = [];
  if (s?.kind !== "particles") return v;
  const k = s.panels?.length ?? s.states?.length ?? 0;
  const anyExtra = (s.panels ?? []).some((p: any) => (p.extra ?? 0) > 0);
  if (s.show === "compare" && s.arrows?.length)
    v.push(`arrow words on compare ${JSON.stringify(s.arrows)}`);
  if (s.key && NON_PARTICLE.test(s.key[1]) && !/particle/i.test(s.key[1]))
    v.push(`key[1] "${s.key[1]}" is not a particle but drawn as a particle swatch`);
  else if (s.key && s.show === "compare" && !anyExtra)
    v.push(`key[1] "${s.key[1]}" has the 2nd-kind colour but no panel draws a 2nd kind`);
  if (s.key && /arrow/i.test(s.key[0])) v.push(`key[0] "${s.key[0]}" names a drawing element`);
  if (s.notes && s.show === "compare" && s.notes.length !== k)
    v.push(`notes ${s.notes.length} for ${k} panels ${JSON.stringify(s.notes)}`);
  else if (s.notes && s.show === "compare" && s.notes.some((x: string) => SHARED.test(x)))
    v.push(`a shared fact in a per-panel note ${JSON.stringify(s.notes)} (not in f3.ts's 13)`);
  if (svg && s.key && svg.split(accent2).length - 1 <= 1)
    v.push(`${accent2} drawn only in the key`);
  return v;
}

if (import.meta.main) {
  const R = `${AB}/runs`;
  let before = 0;
  let after = 0;
  let drawnB = 0;
  let drawnA = 0;
  let parts = 0;
  let others = 0;
  let otherSame = 0;
  for (const rep of REPS)
    for (const b of readdirSync(`${R}/${rep}/T`).sort()) {
      const f = `${R}/${rep}/T/${b}/diagrams.jsonl`;
      if (!existsSync(f)) continue;
      for (const line of readFileSync(f, "utf8").split("\n").filter(Boolean)) {
        const d = JSON.parse(line);
        if (!d.spec) continue;
        setParticleLabelMend(false);
        const sB = mendSpec(d.spec) as Record<string, any>;
        n = 0;
        const svgB = draw(d.spec);
        setParticleLabelMend(true);
        const sA = mendSpec(d.spec) as Record<string, any>;
        n = 0;
        const svgA = draw(d.spec);
        if (d.spec.kind !== "particles") {
          others++;
          if (svgA === svgB) otherSame++;
          else console.log(`CHANGED non-particles ${rep}/${b} ${d.key}`);
          continue;
        }
        parts++;
        const vb = labelFaults(sB, svgB);
        const va = labelFaults(sA, svgA);
        before += vb.length;
        after += va.length;
        drawnB += svgB ? 1 : 0;
        drawnA += svgA ? 1 : 0;
        const junk = (s?: string) => /short, medium/.test(s ?? "");
        console.log(
          `${rep}/${b.slice(0, 3)} ${d.key}  drawn ${!!svgB}->${!!svgA}  same ${svgA === svgB}  "short, medium" ${junk(svgB)}->${junk(svgA)}  lump ${JSON.stringify(sB.lump)}->${JSON.stringify(sA.lump)}`,
        );
        for (const x of vb) console.log(`   BEFORE ${x}`);
        for (const x of va) console.log(`   AFTER  ${x}`);
      }
    }
  setParticleLabelMend(false);
  console.log(
    `particles specs ${parts}: violations ${before} -> ${after}; drawn ${drawnB} -> ${drawnA}. Other specs ${otherSame}/${others} identical.`,
  );
}
