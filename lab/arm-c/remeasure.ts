// Arm C: re-run the geometry check on a finished run's submitted renders (no calls).
// Usage: bun lab/arm-c/remeasure.ts <runDir>
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Renderer } from "./renderer.ts";

const dir = process.argv[2]!;
const L = JSON.parse(readFileSync(join(dir, "lesson.json"), "utf8"));
const minFont = parseFloat(L.tokens["--fs-caption"]);
const r = new Renderer();
await r.start();
for (const s of L.slides) {
  if (!s.html) continue;
  const n = s.renders;
  const f = join(dir, "work", `slide-${String(s.slide).padStart(2, "0")}-r${n}.html`);
  const g = await r.measure(f, minFont);
  console.log(
    s.slide,
    `was ${s.violationsFinal?.total ?? "?"} now ${g.total}`,
    JSON.stringify(Object.fromEntries(Object.entries(g.counts).filter(([, v]) => v))),
    g.violations
      .slice(0, 4)
      .map((v) => `${v.type}:${v.element}:${v.px}`)
      .join(" | "),
  );
}
await r.stop();
process.exit(0);
