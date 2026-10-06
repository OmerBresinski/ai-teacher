import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { fillTemplate } from "./harness";
import { OBJECTIVES_CONFIG } from "./objectives";

const T =
  "/Users/gregwallace/Documents/experiments/ai-teacher/scratchpad/quality-prd/lab/rounds/BAKEOFF/prompts/shared/pupil-objectives-user.txt";
const brief = JSON.parse(
  readFileSync(
    "/Users/gregwallace/Documents/experiments/ai-teacher/scratchpad/quality-prd/lab/rounds/BAKEOFF/briefs/y9-weimar.json",
    "utf8",
  ),
);

test.if(existsSync(T))("the pupil template fills, word limit by key stage", () => {
  const objectives = [{ teacher: "Explain hyperinflation.", pupil: "" }];
  const out = fillTemplate(readFileSync(T, "utf8"), brief, {
    objectives,
    maxWords: OBJECTIVES_CONFIG.pupilMaxWords[brief.keyStage as "ks3"],
  });
  expect(out).toContain("Word limit per line: 12");
  expect(out).toContain("1. Explain hyperinflation.");
  expect(out).not.toContain("{{");
});
