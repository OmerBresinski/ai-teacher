// @ts-nocheck lab script: why a T3 drawing failed the renderer's parse
import { readFileSync } from "node:fs";
import { DiagramSpecSchema } from "@tj/slides/diagrams";
import { expandDrawing } from "./simple";

const A =
  "/Users/gregwallace/Documents/experiments/ai-teacher/scratchpad/quality-prd/lab/rounds/ABLATE";
let n = 0,
  ok = 0;
for (const f of process.argv.slice(2)) {
  for (const line of readFileSync(f, "utf8").split("\n").filter(Boolean)) {
    const c = JSON.parse(line);
    if (c.version?.endsWith("-gap")) continue;
    for (const s of c.output.slides ?? []) {
      const p = s.picture;
      if (!p || p.kind === "photo" || p.kind === "figure") continue;
      n++;
      const r = DiagramSpecSchema.safeParse(expandDrawing(p));
      if (r.success) {
        ok++;
        continue;
      }
      console.log(
        f.split("/").pop(),
        s.form,
        p.kind,
        JSON.stringify(r.error.issues.map((i) => [i.path.join("."), i.message])).slice(0, 300),
      );
    }
  }
}
console.log({ n, ok });
