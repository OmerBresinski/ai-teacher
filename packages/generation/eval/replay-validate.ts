// Replays recorded facts-call outputs (calls.jsonl) through the schemas that rejected them, to name the rule that failed.
import { readFileSync } from "node:fs";
import { planFactsObjectiveOutputSchemaFor } from "../src/prompts/plan-facts-objective";
import { lessonShapeOf } from "../src/shapes";
import { planFactsSchemaFor } from "../src/specs";

const R = "eval/results/lab";
const calls = (run: string) =>
  readFileSync(`${R}/${run}/calls.jsonl`, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
const brief = (f: string) => JSON.parse(readFileSync(`eval/briefs/${f}.json`, "utf8"));
// Recorded text can carry the reasoning summary before the answer: the answer is the last top-level JSON object.
const json = (t: string) => {
  for (let i = t.indexOf("{"); i >= 0; i = t.indexOf("{", i + 1)) {
    try {
      return JSON.parse(t.slice(i));
    } catch {}
  }
  throw new Error("no JSON");
};
const show = (label: string, r: { success: boolean; error?: { issues: unknown[] } }) =>
  console.log(label, r.success ? "OK" : JSON.stringify(r.error?.issues, null, 1).slice(0, 3000));

{
  // production: plan-facts.v11 against the skeleton that was accepted
  const c = calls("cb-y4-romans-P");
  const b = brief("cb-y4-romans");
  const shape = lessonShapeOf(b.brief.answers, { yearGroup: b.yearGroup });
  const skeleton = json(c.find((x) => x.promptVersion.startsWith("plan-skeleton")).text);
  for (const [i, x] of c.filter((x) => x.promptVersion.startsWith("plan-facts")).entries()) {
    const out = json(x.text);
    show(
      `romans-P facts attempt ${i + 1} strict:`,
      planFactsSchemaFor(skeleton, shape).safeParse(out),
    );
    show(
      `romans-P facts attempt ${i + 1} soft:`,
      planFactsSchemaFor(skeleton, shape, { soft: true }).safeParse(out),
    );
  }
}
{
  // lab: plan-facts-objective.v13 per call
  const c = calls("cb-y13-freud-L");
  const b = brief("cb-y13-freud");
  const shape = lessonShapeOf(b.brief.answers, { yearGroup: b.yearGroup });
  const objectives = json(
    c.find((x) => x.promptVersion.startsWith("plan-objectives")).text,
  ).objectives;
  for (const [i, x] of c
    .filter((x) => x.promptVersion.startsWith("plan-facts-objective"))
    .entries()) {
    const out = json(x.text);
    for (const target of objectives.keys())
      show(
        `freud-L call ${i + 1} target ${target} soft:`,
        planFactsObjectiveOutputSchemaFor({ shape, objectives, target }, { soft: true }).safeParse(
          out,
        ),
      );
  }
}
