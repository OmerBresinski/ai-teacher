/*
 * The designer's fit ladder over saved design-cycle outputs (no model calls): for each slot, the
 * rung that landed it and the time the gate took. `bun eval/designer-ladder.ts <run.json>...`
 */
import { readFileSync } from "node:fs";
import { fitSlot } from "../src/planner/slot-fit";
import type { DesignSlot } from "../src/prompts/design-cycle";

for (const file of process.argv.slice(2)) {
  const run = JSON.parse(readFileSync(file, "utf8"));
  for (const c of run.cycles ?? []) {
    for (const [i, slot] of ((c.output?.slots ?? []) as DesignSlot[]).entries()) {
      const t0 = performance.now();
      const fit = await fitSlot(slot, {
        seed: `${run.id}:${c.objectiveIndex}:${i}`,
        themeId: "chalk",
      });
      const ms = Math.round(performance.now() - t0);
      console.log(
        `${run.id} o${c.objectiveIndex} s${i} ${slot.form} -> ${fit.render.form} ${fit.rung} ${ms}ms ${fit.tried.map((t) => `${t.rung}:${t.form}${t.detail ? `(${t.detail})` : ""}:${t.ok ? "y" : "n"}`).join(" ")}`,
      );
    }
  }
}
