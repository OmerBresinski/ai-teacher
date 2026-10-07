// Calibrates the picture library's thresholds (TEACH-84) on brief-pairs.json:
//   OPENAI_API_KEY=… bun apps/worker/calibration/library/calibrate.ts > apps/worker/calibration/library/result.txt
// Embeds every card once with the library's embedder (`@tj/ai`, text-embedding-3-small), scores
// each pair by cosine and, per threshold, reports with `numbersAgree` applied: precision (reused
// pairs that were "same") and recall (same pairs reused). The hit threshold is the lowest with
// precision 1.00; the miss threshold the highest with no "same" pair below it.
import { readFileSync } from "node:fs";
import { createOpenAiEmbedder } from "@tj/ai";
import { BANK_HIT_THRESHOLD, BANK_MISS_THRESHOLD, cosine, numbersAgree } from "@tj/images";

type Label = "same" | "near" | "different";
const set = JSON.parse(readFileSync(new URL("./brief-pairs.json", import.meta.url), "utf8")) as {
  pairs: [string, string, Label][];
};
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("OPENAI_API_KEY unset");
const embedder = createOpenAiEmbedder({ apiKey });
let cost = 0;
const vec = async (text: string) => {
  const r = await embedder.embed(text);
  cost += r.costUsd;
  return r.vector;
};
const scored: { a: string; b: string; label: Label; sim: number }[] = [];
for (const [a, b, label] of set.pairs) {
  scored.push({ a, b, label, sim: cosine(await vec(a), await vec(b)) });
}
scored.sort((x, y) => y.sim - x.sim);
for (const s of scored) {
  console.log(
    `${s.sim.toFixed(3)}  ${s.label.padEnd(9)} ${s.a.slice(0, 45)} | ${s.b.slice(0, 45)}`,
  );
}
const allSame = scored.filter((s) => s.label === "same").length;
console.log("\nthreshold  reused  same  precision  recall");
for (let t = 0.5; t <= 0.951; t += 0.025) {
  const reused = scored.filter((s) => s.sim >= t && numbersAgree(s.a, s.b));
  const same = reused.filter((s) => s.label === "same").length;
  const precision = reused.length ? same / reused.length : 1;
  console.log(
    `${t.toFixed(3)}      ${String(reused.length).padStart(2)}      ${String(same).padStart(2)}    ${precision.toFixed(2)}       ${(same / allSame).toFixed(2)}`,
  );
}
const lowestSame = Math.min(...scored.filter((s) => s.label === "same").map((s) => s.sim));
const highestWrong = Math.max(
  ...scored.filter((s) => s.label !== "same" && numbersAgree(s.a, s.b)).map((s) => s.sim),
);
console.log(
  `\nlowest "same" ${lowestSame.toFixed(3)}; highest non-"same" (numbers agreeing) ${highestWrong.toFixed(3)}`,
);
console.log(
  `in code: BANK_HIT_THRESHOLD ${BANK_HIT_THRESHOLD}, BANK_MISS_THRESHOLD ${BANK_MISS_THRESHOLD}`,
);
console.log(`embedding cost $${cost.toFixed(6)}`);
