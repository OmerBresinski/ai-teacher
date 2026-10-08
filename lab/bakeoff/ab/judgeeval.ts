// Round 6 (8 Oct): live run of the picture-judge eval (arms3/judge/eval/cases.json: 3 hens must fail, 8 must pass),
// on v17 and v20, through the judge's own call shape (callStructured, gpt-6-luna standard, effort low, detail low).
// bun lab/bakeoff/ab/judgeeval.ts <reps> <out.jsonl>
import { appendFileSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import pino from "../../../apps/worker/node_modules/pino/pino.js";
import { createAi, createBudget } from "../../../packages/ai/src/index";
import { callStructured } from "../../../packages/generation/src/call";
import {
  pickOrRequeryPrompt,
  pickOrRequerySchemaFor,
} from "../../../packages/generation/src/prompts/pick-or-requery-photo";
import {
  pickOrRequeryPromptV20,
  pickOrRequerySchemaForV20,
} from "../../../packages/generation/src/prompts/pick-or-requery-photo-v20";
import { BAKEOFF } from "../services";
import { AB } from "./arms";

const E = `${AB}/arms3/judge/eval`;
const spec = JSON.parse(readFileSync(`${E}/${process.env.CASES ?? "cases.json"}`, "utf8"));
const DETAILS = (process.env.DETAILS ?? "low").split(",") as ("low" | "high")[];
const CAP = Number(process.env.CAP ?? "0.06");
const reps = Number(process.argv[2] ?? 3);
const out = process.argv[3] ?? `${E}/live.jsonl`;
const img = (p: string) => {
  const f = p.startsWith("ROOTCAUSE/")
    ? `${AB}/rootcause/y1-hen/${p.slice(10)}`
    : `${BAKEOFF}/base-pg/store/${p}`;
  const b = readFileSync(f);
  const mime = b[0] === 0x89 ? "image/png" : "image/jpeg";
  return `data:${mime};base64,${b.toString("base64")}`;
};
const key = readFileSync(`${homedir()}/.dayback-openai-key`, "utf8").trim();
const M = "openai/gpt-6-luna";
const aiFor = (detail: string) =>
  createAi(
    { OPENAI_API_KEY: key, AI_MODEL_FRONTIER: M, AI_MODEL_STANDARD: M, AI_MODEL_SMALL: M },
    {
      logger: pino(
        { level: "info" },
        pino.destination({ dest: `${out}.${detail}.ai.log`, sync: true }),
      ),
    },
  );
const AIS = Object.fromEntries(DETAILS.map((d) => [d, aiFor(d)]));
const spent = () =>
  DETAILS.reduce((sum, d) => {
    try {
      return (
        sum +
        readFileSync(`${out}.${d}.ai.log`, "utf8")
          .trim()
          .split("\n")
          .reduce((a, l) => a + (JSON.parse(l).ai?.costUsd ?? 0), 0)
      );
    } catch {
      return sum;
    }
  }, 0);
const quiet = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  child() {
    return quiet;
  },
};
let usd = 0;
const versions = [
  {
    v: pickOrRequeryPrompt.version,
    prompt: pickOrRequeryPrompt,
    schemaFor: pickOrRequerySchemaFor,
  },
  {
    v: pickOrRequeryPromptV20.version,
    prompt: pickOrRequeryPromptV20,
    schemaFor: pickOrRequerySchemaForV20,
  },
];
const tally: Record<string, { ok: number; n: number; miss: string[] }> = {};
for (let rep = 1; rep <= reps; rep++)
  for (const detail of DETAILS)
    for (const V of versions) {
      if (spent() > CAP) {
        console.log(`stopped: spent $${spent().toFixed(4)} > cap $${CAP}`);
        process.exit(3);
      }
      const ai = AIS[detail];
      await Promise.all(
        spec.cases.map(async (c: any) => {
          const cands = (c.candidates ?? [{ id: c.candidateId, alt: c.alt, image: c.image }]).map(
            (x: any) => ({
              id: x.id,
              alt: x.alt,
              url: img(x.image),
            }),
          );
          const deps = {
            ai,
            budget: createBudget({ capUsd: 0.05, capTokens: 2_000_000 }),
            effortFor: () => "low",
            signal: new AbortController().signal,
            logger: quiet,
            now: () => new Date(),
            ids: () => crypto.randomUUID(),
            context: { lessonId: "judge-eval", jobId: "judge-eval" },
          };
          let verdict: any;
          try {
            const call = await callStructured({
              deps: deps as never,
              stage: "illustrate",
              cls: "standard",
              effort: "low",
              prompt: V.prompt as never,
              input: {
                topic: spec.topic,
                lessonTitle: spec.lessonTitle,
                audience: spec.audience,
                objectives: [],
                vocabulary: [],
                slideBrief: c.request,
                subject: c.subject,
                mustShow: c.mustShow,
                needAll: c.needAll,
                purpose: "illustrate",
                ...(c.reuse ? { reuse: true } : {}),
                avoid: [],
                queries: [c.subject],
                candidates: cands.map((x: any) => ({ id: x.id, alt: x.alt, thumbnail: x.url })),
              } as never,
              schema: V.schemaFor({ mustShow: c.mustShow }) as never,
              maxOutputTokens: 1500,
              images: cands.map((x: any) => ({ id: x.id, url: x.url })),
              imageDetail: detail,
            } as never);
            verdict = (call as any).output;
            usd += (call as any).usage?.costUsd ?? 0;
          } catch (e) {
            verdict = { error: String(e).slice(0, 200) };
          }
          const seen = new Set((verdict.visible ?? []).map((s: string) => s.toLowerCase()));
          const gate =
            !!verdict.pick &&
            verdict.onSubject &&
            verdict.clear &&
            verdict.fits &&
            verdict.kindMatches !== false &&
            c.mustShow.every((m: string) => seen.has(m.toLowerCase()));
          const target =
            c.id === "H1b-hen-round2-six"
              ? verdict.pick !== "36524558"
              : c.id === "P2-hen-chicks-stock"
                ? ["adult hen", "downy chick"].every((m) => seen.has(m))
                : c.kind === "must-fail"
                  ? !gate
                  : gate;
          appendFileSync(
            out,
            `${JSON.stringify({ rep, detail, version: V.v, id: c.id, kind: c.kind, gate, target, verdict })}\n`,
          );
          const cell = `${V.v.slice(-3)} ${detail}`;
          if (!tally[cell]) tally[cell] = { ok: 0, n: 0, miss: [] };
          const t = tally[cell] as { ok: number; n: number; miss: string[] };
          t.n++;
          if (target) t.ok++;
          else t.miss.push(`r${rep}:${c.id}`);
        }),
      );
    }
console.log(JSON.stringify({ tally, usd: spent() }, null, 1));
