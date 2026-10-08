// Picture director routing eval (arm dir-stage, 9 Oct): replays ab/arms3/dir-stage/eval/cases.json
// through director v11 and v12 in the director's own call shape (callStructured, gpt-6-luna small,
// effort low, single-slot call). Scores route against each case's expect; writes every answer so the
// v12 stage image prompts can be read for their stated features, breed and scale.
// PAID: about $0.0003 per call, 2 versions x 39 cases x reps. Not run by the prompt engineer.
// Usage: CAP=0.10 bun lab/bakeoff/ab/direval.ts [reps=1] [out]
import { appendFileSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import pino from "../../../apps/worker/node_modules/pino/pino.js";
import { createAi, createBudget } from "../../../packages/ai/src/index";
import { callStructured } from "../../../packages/generation/src/call";
import {
  PICTURE_DIRECTOR_VERSION,
  PictureDirectorSchema,
  pictureDirectorPrompt,
} from "../../../packages/generation/src/prompts/picture-director";
import {
  PICTURE_DIRECTOR_VERSION_V12,
  pictureDirectorPromptV12,
} from "../../../packages/generation/src/prompts/picture-director-v12";
import { AB } from "./arms";

const E = `${AB}/arms3/dir-stage/eval`;
const spec = JSON.parse(readFileSync(`${E}/${process.env.CASES ?? "cases.json"}`, "utf8"));
const CAP = Number(process.env.CAP ?? "0.10");
const reps = Number(process.argv[2] ?? 1);
const out = process.argv[3] ?? `${E}/live.jsonl`;
const key = readFileSync(`${homedir()}/.dayback-openai-key`, "utf8").trim();
const M = "openai/gpt-6-luna";
const aiLog = `${out}.ai.log`;
const ai = createAi(
  { OPENAI_API_KEY: key, AI_MODEL_FRONTIER: M, AI_MODEL_STANDARD: M, AI_MODEL_SMALL: M },
  { logger: pino({ level: "info" }, pino.destination({ dest: aiLog, sync: true })) },
);
const spent = () => {
  try {
    return readFileSync(aiLog, "utf8")
      .trim()
      .split("\n")
      .reduce((a, l) => a + (JSON.parse(l).ai?.costUsd ?? 0), 0);
  } catch {
    return 0;
  }
};
const quiet = pino({ level: "silent" });
const versions = [
  { v: PICTURE_DIRECTOR_VERSION, build: pictureDirectorPrompt },
  { v: PICTURE_DIRECTOR_VERSION_V12, build: pictureDirectorPromptV12 },
];
const score: Record<string, Record<string, [number, number]>> = {};
for (let rep = 0; rep < reps; rep++)
  for (const V of versions) {
    if (spent() > CAP) {
      console.log(`stopped: spent $${spent().toFixed(4)} > cap $${CAP}`);
      process.exit(3);
    }
    await Promise.all(
      spec.cases.map(async (c: any) => {
        const built = V.build(c.input);
        let d: any;
        try {
          const call = await callStructured({
            deps: {
              ai,
              budget: createBudget({ capUsd: 0.05, capTokens: 2_000_000 }),
              effortFor: () => "low",
              signal: new AbortController().signal,
              logger: quiet,
              now: () => new Date(),
              ids: () => crypto.randomUUID(),
              context: { lessonId: "director-eval", jobId: "director-eval" },
            } as never,
            stage: "illustrate",
            cls: "small",
            effort: "low",
            prompt: { version: V.v, system: built.system, user: () => built.user },
            input: c.input,
            schema: PictureDirectorSchema,
            maxOutputTokens: 3000,
          });
          d = call.output;
        } catch (e) {
          d = { error: String(e).slice(0, 200) };
        }
        const ok = c.expect.includes(d.route);
        if (!score[V.v]) score[V.v] = {};
        const g = score[V.v];
        if (!g[c.group]) g[c.group] = [0, 0];
        const s = g[c.group];
        s[0] += ok ? 1 : 0;
        s[1] += 1;
        appendFileSync(
          out,
          `${JSON.stringify({ rep, version: V.v, id: c.id, group: c.group, expect: c.expect, route: d.route, ok, pictures: d.pictures, error: d.error })}\n`,
        );
      }),
    );
  }
for (const [v, g] of Object.entries(score))
  console.log(
    v,
    Object.entries(g)
      .map(([k, [a, n]]) => `${k} ${a}/${n}`)
      .join("  "),
  );
console.log(`spent $${spent().toFixed(4)}`);
