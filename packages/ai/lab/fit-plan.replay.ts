// Lab replay: run the fit planner alone on a saved lesson's facts. bun src/planner/fit-plan.replay.ts <lesson.json>

import { readFileSync } from "node:fs";
import { createOpenAI } from "@ai-sdk/openai";
import { planFit } from "../../generation/src/planner/fit-plan";
import { measureDraft } from "../../generation/src/planner/measure-slide";

const lesson = JSON.parse(readFileSync(process.argv[2] as string, "utf8"));
const openai = createOpenAI({
  apiKey: readFileSync(`${process.env.HOME}/.dayback-openai-key`, "utf8").trim(),
});
let usd = 0;
const deps = {
  ai: { model: () => openai.chat("gpt-6-luna") },
  budget: {
    exceeded: () => undefined,
    reserve: () => ({ reservation: 1 }),
    settle: (
      _r: unknown,
      u: { inputTokens: number; outputTokens: number; cachedInputTokens: number },
    ) => {
      usd +=
        ((u.inputTokens - u.cachedInputTokens) * 0.1 +
          u.cachedInputTokens * 0.01 +
          u.outputTokens * 0.5) /
        1e6;
    },
    markUncertain: () => undefined,
  },
  signal: new AbortController().signal,
  logger: {
    info: (o: unknown, m: string) => console.log(m, JSON.stringify(o)),
    warn: (o: unknown, m: string) => console.log("WARN", m, JSON.stringify(o)),
  },
  context: {},
} as never;
const plans = await planFit(
  lesson.facts,
  {
    lessonTitle: lesson.title,
    audience: {
      yearGroup: lesson.yearGroup,
      ageBand: lesson.ageBand,
      language: lesson.language ?? "en-GB",
    },
    themeId: lesson.themeId,
  } as never,
  deps,
);
for (const [i, p] of plans)
  console.log(
    i + 1,
    JSON.stringify(p.planned),
    JSON.stringify(measureDraft(p.planned, lesson.themeId)),
    p.entry.factRefs.join(","),
    p.entry.callout?.kind ?? "-",
    "notes:",
    p.notes ?? "",
  );
console.log("usd", usd.toFixed(5));
