// Round 9: the writer's requests compiled at $0 (armT.prompt + localise, as chat() sends them) for
// KS1, KS3, KS5 and an India brief, checked for what the round 9 prompts need from code:
// `look` in the strict flow schema, every Fits clause in characters, the currency symbol, no unfilled
// token, and a schema OpenAI's strict mode accepts. bun lab/bakeoff/r9-compile-check.ts [outDir]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { openaiSchemaFaults } from "../../packages/slides/src/diagrams/wire";
import { armT } from "./arm-t";
import { INDIA, localise, setLocale } from "./locale";
import { BAKEOFF } from "./services";

const out = process.argv[2];
const brief = (id: string) => JSON.parse(readFileSync(`${BAKEOFF}/briefs/${id}.json`, "utf8"));
const cases = [
  ["KS1", brief("y1-science-animals-young"), undefined],
  ["KS3", brief("y8-french-my-family"), undefined],
  ["KS5", brief("y12-psychology-multi-store-model"), undefined],
  ["INDIA", brief("y8-french-my-family"), INDIA],
] as const;
let bad = 0;
const fail = (m: string) => {
  bad++;
  console.log("FAIL", m);
};
for (const [name, b, loc] of cases) {
  setLocale(loc);
  const p = armT.prompt(b as never) as { system: string; schema: Record<string, unknown> };
  const system = localise(p.system);
  const flow = (p.schema.properties as Record<string, Record<string, unknown>>).flow;
  const item = (flow?.items as { properties?: Record<string, unknown>; required?: string[] }) ?? {};
  if (!item.properties?.look || !item.required?.includes("look"))
    fail(`${name}: no required look in the flow schema`);
  const fits = system
    .split("\n")
    .flatMap((l) => (/Fits: (.*)/.exec(l)?.[1] ? [/Fits: (.*)/.exec(l)?.[1] as string] : []));
  if (!fits.length) fail(`${name}: no Fits clauses`);
  for (const f of fits)
    if (/\b(lines?|words?)\b/.test(f.replace(/\bsubtitle\b/g, "")))
      fail(`${name}: a Fits clause in lines or words: ${f.slice(0, 120)}`);
  if (!/A heading is up to \d+ characters/.test(system))
    fail(`${name}: heading limit not in characters`);
  if (/\{\{/.test(system)) fail(`${name}: unfilled token`);
  if (/\bGBP\b|\bINR\b/.test(system)) fail(`${name}: an ISO currency code in the prompt`);
  if (name === "INDIA" ? !system.includes("₹") : !system.includes("£"))
    fail(`${name}: no currency symbol`);
  // Round 9: no length in the strict schema (the decoder would cut a sentence off at the limit).
  if (/"(pattern|maxLength)"/.test(JSON.stringify(p.schema)))
    fail(`${name}: a length limit in the schema`);
  if (!/ in all\b/.test(system)) fail(`${name}: no calibrated total ("N in all") in the Fits`);
  const faults = openaiSchemaFaults(p.schema, true);
  if (faults.length) fail(`${name}: strict schema faults: ${faults.slice(0, 3).join("; ")}`);
  if (out) {
    mkdirSync(out, { recursive: true });
    writeFileSync(`${out}/main.${name}.system.txt`, system);
    writeFileSync(
      `${out}/main.${name}.json`,
      JSON.stringify({ system: system.length, schema: p.schema }, null, 1),
    );
  }
  console.log(
    name,
    `system ${system.length} chars, ${fits.length} Fits clauses, schema ${JSON.stringify(p.schema).length} chars`,
  );
}
setLocale(undefined);
process.exit(bad ? 1 : 0);
