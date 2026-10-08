// Prints how the replay's slides differ from the saved run, slide by slide (`bun src/writer/replay-report.ts`).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { replayRun, savedSlides } from "./replay-fixture";

for (const b of [
  "y1-science-animals-young",
  "y2-maths-halves-quarters",
  "y5-maths-fractions-of-amounts",
  "y8-french-my-family",
  "y11-chemistry-rates-of-reaction",
  "y12-psychology-multi-store-model",
]) {
  const out = await replayRun(b);
  const saved = savedSlides(b);
  console.log(b, "slides", out.slides.length, saved.length);
  out.slides.forEach((s, i) => {
    const w = saved[i];
    if (!w) return;
    const a = s.elements as unknown as Record<string, unknown>[];
    const e = w.elements;
    const diffs: string[] = [];
    if (a.length !== e.length) diffs.push(`elements ${a.length} vs ${e.length}`);
    a.forEach((x, k) => {
      const y = e[k] ?? {};
      for (const f of new Set([...Object.keys(x), ...Object.keys(y)])) {
        if (["id", "source", "style", "period"].includes(f)) continue;
        if (JSON.stringify(x[f]) !== JSON.stringify(y[f]))
          diffs.push(
            `${k}.${String(x.name ?? x.type)}.${f}: ${JSON.stringify(x[f])?.slice(0, 60)} vs ${JSON.stringify(y[f])?.slice(0, 60)}`,
          );
      }
    });
    if (s.notes !== w.notes)
      diffs.push(
        `notes differ: ${JSON.stringify(s.notes).slice(0, 80)} vs ${JSON.stringify(w.notes).slice(0, 80)}`,
      );
    if (diffs.length) console.log(` s${i + 1} (${diffs.length}):`, diffs.join(" | "));
  });
}
void readFileSync;
void join;
