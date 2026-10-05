// lab: render old (plan-objectives.v25, T3 path inputs) and new (lesson-objectives.v1) prompts for the 6 ABLATE briefs.
import { readFileSync, writeFileSync } from "node:fs";
import { lessonObjectivesPrompt } from "./prompts/lesson-objectives";
import { planObjectivesPrompt } from "./prompts/plan-objectives";
import { lessonShapeOf } from "./shapes";

const V = "/Users/gregwallace/Documents/experiments/ai-teacher/scratchpad/quality-prd/lab";
const OUT = `${V}/rounds/T3-CAND/obj-bench/prompts.json`;
const briefs = [
  "y1-science-animals-young",
  "y5-maths-fractions-of-amounts",
  "y7-particle-model-new",
  "y9-weimar",
  "y10-english-tempest-prospero",
  "y11-chemistry-rates-of-reaction",
];
const band = (y: number) => (y <= 2 ? "ks1" : y <= 6 ? "ks2" : y <= 9 ? "ks3" : "ks4");
const out: Record<string, unknown> = {};
for (const b of briefs) {
  const f = b === "y9-weimar" ? `${V}/rounds/JEV/briefs/${b}.json` : `${V}/visual/briefs/${b}.json`;
  const j = JSON.parse(readFileSync(f, "utf8"));
  const y = Number(String(j.yearGroup).replace(/\D/g, ""));
  const audience = {
    subject: j.subject,
    yearGroup: j.yearGroup,
    ageBand: band(y),
    readingLevel: j.yearGroup,
    language: "en-GB",
  } as never;
  const shape = lessonShapeOf(j.brief.answers, {
    yearGroup: j.yearGroup,
    ageBand: band(y),
  } as never);
  out[b] = {
    old: {
      system: planObjectivesPrompt.system,
      user: planObjectivesPrompt.user({ topic: j.brief.topic, shape, audience }),
    },
    new: {
      system: lessonObjectivesPrompt.system,
      user: lessonObjectivesPrompt.user({
        topic: j.brief.topic,
        audience,
        answers: j.brief.answers,
        slideCount: j.brief.slideCount,
      }),
    },
  };
}
writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log("wrote", OUT);
