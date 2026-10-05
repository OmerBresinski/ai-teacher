import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  teacher3LessonSchema,
  teacher3Prompt,
} from "/Users/gregwallace/Documents/experiments/ai-teacher/scratchpad/ablate/packages/generation/src/plan-write/simple";

const A =
  "/Users/gregwallace/Documents/experiments/ai-teacher/scratchpad/quality-prd/lab/rounds/ABLATE";
const key = readFileSync(`${process.env.HOME}/.dayback-openai-key`, "utf8").trim();
const count = async (user: string) => {
  const r = await fetch("https://api.openai.com/v1/responses/input_tokens", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-6.1-sol", input: [{ role: "user", content: user }] }),
  });
  return ((await r.json()) as { input_tokens: number }).input_tokens;
};
const b = "y9-weimar";
const r = JSON.parse(
  readFileSync(`${A}/calls/T2/ABL-T2-${b}-generate.calls.jsonl`, "utf8").split("\n")[0],
);
const objectives = JSON.parse(readFileSync(`${A}/objectives-R3/${b}.json`, "utf8"));
const p = teacher3Prompt({
  slideCount: 10,
  topic: "x",
  context: r.context,
  yearGroup: "Year 9",
  subject: "History",
  ageBand: "ks3",
  objectives,
});
const base = await count("a");
const parts = [p.system, ...p.user.split("\n").filter(Boolean)];
const out: [string, number][] = [];
for (const l of parts) out.push([l, (await count("a " + l)) - base]);
const descs: string[] = [];
const walk = (v: unknown) => {
  if (Array.isArray(v)) v.forEach(walk);
  else if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v)) {
      if (k === "description") descs.push(String(x));
      else walk(x);
    }
};
for (const subj of ["History", "Maths", "Science"])
  walk(z.toJSONSchema(teacher3LessonSchema(subj)));
const uniq = [...new Set(descs)];
for (const d of uniq) out.push([`[schema] ${d}`, (await count("a " + d)) - base]);
for (const [l, t] of out) console.log(`${t}\t${l}`);
