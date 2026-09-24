// Replays recorded facts-call answers (calls.jsonl) through callStructured with a scripted fake model: no API calls.
// bun eval/replay-callstructured.ts [resultsDir] — defaults to eval/results/lab; briefs are read beside it (../../briefs).
import { readFileSync } from "node:fs";
import { createBudget } from "@tj/ai";
import { createFakeAi } from "@tj/ai/testing";
import pino from "pino";
import { callStructured } from "../src/call";
import { planFactsObjectiveOutputSchemaFor } from "../src/prompts/plan-facts-objective";
import { lessonShapeOf } from "../src/shapes";
import { assignFactIds, planFactsSchemaFor } from "../src/specs";

const R = process.argv[2] ?? "eval/results/lab";
const calls = (run: string) =>
  readFileSync(`${R}/${run}/calls.jsonl`, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
const brief = (f: string) => JSON.parse(readFileSync(`${R}/../../briefs/${f}.json`, "utf8"));
// The answer is the last top-level JSON object in the recorded text.
const json = (t: string) => {
  for (let i = t.indexOf("{"); i >= 0; i = t.indexOf("{", i + 1)) {
    try {
      return JSON.parse(t.slice(i));
    } catch {}
  }
  throw new Error("no JSON");
};
const replay = async <T>(label: string, answers: unknown[], schema: never, soft: never) => {
  const ai = createFakeAi({ script: answers.map((a) => JSON.stringify(a)) });
  const deps = {
    ai,
    budget: createBudget({ capUsd: 1, capTokens: 1_000_000 }),
    signal: new AbortController().signal,
    logger: pino({ level: "silent" }),
    context: { lessonId: "replay", jobId: "replay" },
  };
  try {
    const r = await callStructured<string, T>({
      deps,
      stage: "plan",
      cls: "standard",
      effort: "medium",
      prompt: { version: "replay.v1", system: "", user: () => "" },
      input: "",
      schema,
      soft,
      maxOutputTokens: 7000,
    });
    console.log(
      `${label}: OK, attempts ${r.attempts}, ${r.editorialMisses.length} editorial misses`,
    );
    for (const m of r.editorialMisses) console.log(`   ${m.path.join(".")}: ${m.message}`);
    return r.output;
  } catch (e) {
    console.log(`${label}: FAILED ${(e as Error).message}`);
    return undefined;
  }
};

{
  const c = calls("cb-y4-romans-P");
  const b = brief("cb-y4-romans");
  const shape = lessonShapeOf(b.brief.answers, { yearGroup: b.yearGroup });
  const skeleton = json(c.find((x) => x.promptVersion.startsWith("plan-skeleton")).text);
  const [a1, a2] = c
    .filter((x) => x.promptVersion.startsWith("plan-facts"))
    .map((x) => json(x.text));
  const strict = planFactsSchemaFor(skeleton, shape) as never;
  const soft = planFactsSchemaFor(skeleton, shape, { soft: true }) as never;
  for (const [label, script] of [
    ["romans-P attempts 1 then 2 (as recorded)", [a1, a2]],
    ["romans-P attempt 1 alone (retry repeats it)", [a1, a1]],
    ["romans-P attempt 2 alone (retry repeats it)", [a2, a2]],
  ] as const) {
    const out = (await replay(label, [...script], strict, soft)) as
      | { outlineFactRefs: { index: number; callout?: unknown }[] }
      | undefined;
    if (out) {
      const withCallout = out.outlineFactRefs.filter((e) => e.callout).map((e) => e.index);
      console.log(`   callouts kept on outline positions: ${withCallout.join(", ") || "none"}`);
      // What Plan does next: the ordinal answer becomes the lesson's facts (throws on a dangling id).
      const facts = assignFactIds(skeleton, out as never, b.brief.durationMin ?? 60);
      console.log(
        `   plan: ${facts.outline.length} outline entries, ${facts.keyIdeas?.length ?? 0} key ideas`,
      );
    }
  }
}
{
  const c = calls("cb-y13-freud-L");
  const b = brief("cb-y13-freud");
  const shape = lessonShapeOf(b.brief.answers, { yearGroup: b.yearGroup });
  const objectives = json(
    c.find((x) => x.promptVersion.startsWith("plan-objectives")).text,
  ).objectives;
  const f = c
    .filter((x) => x.promptVersion.startsWith("plan-facts-objective"))
    .map((x) => json(x.text));
  // Facts calls 1 and 5 were objective 1 and its retry; 3 and 4 objective 2 and its retry.
  for (const [label, target, first, retry] of [
    ["freud-L objective 1 (calls 1 then 5)", 0, f[0], f[4]],
    ["freud-L objective 2 (calls 3 then 4)", 1, f[2], f[3]],
  ] as const) {
    const input = { shape, objectives, target };
    await replay(
      label,
      [first, retry],
      planFactsObjectiveOutputSchemaFor(input as never) as never,
      planFactsObjectiveOutputSchemaFor(input as never, { soft: true }) as never,
    );
  }
}
