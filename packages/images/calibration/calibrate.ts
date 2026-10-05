// Calibrates the picture library's reuse threshold (TEACH-84) on reuse-pairs.json:
//   OPENAI_API_KEY=… bun packages/images/calibration/calibrate.ts > packages/images/calibration/result.txt
// Embeds every request once (text-embedding-3-small), scores each pair by cosine, and for each
// threshold reports, with numbersAgree applied, precision (reused pairs that were "same") and recall (same pairs reused).
import { readFileSync } from "node:fs";
import { cosine, createOpenAiEmbedder, numbersAgree, REUSE_THRESHOLD } from "../src/bank";

const set = JSON.parse(readFileSync(new URL("./reuse-pairs.json", import.meta.url), "utf8")) as {
  pairs: [string, string, "same" | "near" | "different"][];
};
const key = process.env.OPENAI_API_KEY;
if (!key) throw new Error("OPENAI_API_KEY unset");
const embedder = createOpenAiEmbedder({ apiKey: key });
let cost = 0;
const vec = async (t: string) => {
  const r = await embedder.embed(t);
  cost += r.costUsd;
  return r.vector;
};
const scored = [];
for (const [a, b, label] of set.pairs)
  scored.push({ a, b, label, sim: cosine(await vec(a), await vec(b)) });
scored.sort((x, y) => y.sim - x.sim);
for (const s of scored)
  console.log(
    `${s.sim.toFixed(3)}  ${s.label.padEnd(9)} ${s.a.slice(0, 50)} | ${s.b.slice(0, 50)}`,
  );
console.log("\nthreshold  reused  same  precision  recall");
for (let t = 0.6; t <= 0.951; t += 0.025) {
  const reused = scored.filter((s) => s.sim >= t && numbersAgree(s.a, s.b));
  const same = reused.filter((s) => s.label === "same").length;
  const allSame = scored.filter((s) => s.label === "same").length;
  console.log(
    `${t.toFixed(3)}      ${String(reused.length).padStart(2)}      ${String(same).padStart(2)}    ${(reused.length ? same / reused.length : 1).toFixed(2)}       ${(same / allSame).toFixed(2)}`,
  );
}
console.log(`\nREUSE_THRESHOLD in code: ${REUSE_THRESHOLD} (numbers must agree)`);
console.log(`\nembedding cost $${cost.toFixed(6)}`);
