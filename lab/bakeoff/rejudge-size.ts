/**
 * BAKEOFF round 3 COST: re-judge the saved pictures of round2/runs/T/{y1,y7,y11} with the
 * production judge (`judgeMade`) at the current size and at reduced sizes, and report cost per
 * picture and every verdict that changes. Variants: auto (current: full bytes, no detail),
 * auto2 (repeat, the noise floor), low (OpenAI low detail), s512 / s256 (downscaled with sips).
 *
 *   bun lab/bakeoff/rejudge-size.ts <outDir> [variant,...]
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import pino from "../../apps/worker/node_modules/pino/pino.js";
import { createAi, createBudget } from "../../packages/ai/src/index";
import { judgeMade, plainSubject } from "../../packages/generation/src/stages/illustrate";
import { mustShowOf } from "../../packages/generation/src/stages/photo-bank";
import { pickerLesson, STORE } from "./services";

const ROOT =
  "/Users/gregwallace/Documents/experiments/ai-teacher/scratchpad/quality-prd/lab/rounds/BAKEOFF/round2/runs/T";
const LESSONS = [
  "y1-science-animals-young",
  "y7-particle-model-new",
  "y11-chemistry-rates-of-reaction",
];
const out = process.argv[2] ?? "/tmp/rejudge";
const variants = (process.argv[3] ?? "auto,auto2,low,s512,s256").split(",");
const CAP = Number(process.env.CAP_USD ?? "0.035");
mkdirSync(`${out}/img`, { recursive: true });
const aiLog = `${out}/ai.jsonl`;
const okey = readFileSync(`${process.env.HOME}/.dayback-openai-key`, "utf8").trim();
const MODEL = "openai/gpt-6-luna";
const ai = createAi(
  {
    OPENAI_API_KEY: okey,
    AI_MODEL_FRONTIER: MODEL,
    AI_MODEL_STANDARD: MODEL,
    AI_MODEL_SMALL: MODEL,
  },
  { logger: pino({ level: "info" }, pino.destination({ dest: aiLog, sync: true })) },
);
const spent = () =>
  existsSync(aiLog)
    ? readFileSync(aiLog, "utf8")
        .split("\n")
        .filter(Boolean)
        .reduce(
          (a, l) => a + ((JSON.parse(l) as { ai?: { costUsd?: number } }).ai?.costUsd ?? 0),
          0,
        )
    : 0;
const lastCall = () => {
  const ls = readFileSync(aiLog, "utf8").split("\n").filter(Boolean);
  return (JSON.parse(ls[ls.length - 1] ?? "{}") as { ai?: Record<string, number> }).ai ?? {};
};
const silent = pino({ level: "silent" });

type Pic = {
  lesson: string;
  slide: number;
  id: string;
  request: string;
  file: string;
  mustShow: string[];
  aspect: number;
  specific: boolean;
};
const pics: Pic[] = [];
for (const l of LESSONS) {
  const j = JSON.parse(readFileSync(`${ROOT}/${l}/lesson.json`, "utf8")) as {
    slides: { elements: Record<string, unknown>[] }[];
  };
  j.slides.forEach((s, slide) => {
    for (const e of s.elements) {
      const src = e.src as string | undefined;
      const request = e.request as string | undefined;
      if (e.type !== "image" || !src?.startsWith("/files/") || !request) continue;
      const parts = request.split(". ");
      const mustSee = parts.slice(1).filter(Boolean);
      const file = `${STORE}/${src.slice("/files/".length)}`;
      if (!existsSync(file)) continue;
      pics.push({
        lesson: l,
        slide,
        id: src.split("/").pop() ?? src,
        request,
        file,
        mustShow: mustSee.length ? mustSee : mustShowOf(request),
        aspect: Math.round((Number(e.w) / Number(e.h)) * 100) / 100,
        specific: (e.source as { provider?: string } | undefined)?.provider === "commons",
      });
    }
  });
}
console.log(`${pics.length} pictures`);

function dataUrl(p: Pic, variant: string): string {
  let file = p.file;
  const m = /^s(\d+)$/.exec(variant);
  if (m) {
    const ext = file.endsWith(".png") ? "png" : "jpg";
    const small = `${out}/img/${variant}-${p.id.replace(/\.\w+$/, "")}.${ext}`;
    if (!existsSync(small)) {
      writeFileSync(small, readFileSync(file));
      execFileSync("sips", ["-Z", m[1] ?? "512", small], { stdio: "ignore" });
    }
    file = small;
  }
  const mt = file.endsWith(".png") ? "image/png" : "image/jpeg";
  return `data:${mt};base64,${readFileSync(file).toString("base64")}`;
}

const rows: Record<string, unknown>[] = [];
for (const variant of variants) {
  process.env.JUDGE_IMAGE_DETAIL = variant.startsWith("low") ? "low" : "";
  for (const p of pics) {
    if (spent() > CAP) {
      console.log("cap reached");
      break;
    }
    const lesson = pickerLesson(
      {
        id: p.lesson,
        title: p.lesson,
        yearGroup: p.lesson.split("-")[0]?.toUpperCase().replace("Y", "Year ") ?? "",
        subject: p.lesson.split("-")[1] ?? "",
        base: {},
      },
      p.slide,
    );
    let verdict: { fits?: boolean; why?: string; visible?: string[] } = {};
    const deps = {
      ai,
      budget: createBudget({ capUsd: 0.05, capTokens: 2_000_000 }),
      effortFor: () => "low",
      signal: new AbortController().signal,
      logger: silent,
      now: () => new Date(),
      ids: () => crypto.randomUUID(),
      images: {},
      context: { lessonId: p.lesson, jobId: "rejudge" },
    };
    const brief = {
      subject: plainSubject(p.request.split(". ")[0] ?? p.request).slice(0, 60),
      request: p.request.slice(0, 400),
      mustShow: p.mustShow,
      purpose: "context",
      specific: p.specific,
      aspect: p.aspect,
    };
    const pass = await judgeMade({
      lesson: lesson as never,
      index: p.slide,
      brief: brief as never,
      deps: deps as never,
      dataUrl: dataUrl(p, variant),
      onVerdict: (v) => {
        verdict = v as typeof verdict;
      },
    }).catch((e) => `error: ${String(e).slice(0, 120)}`);
    const c = lastCall();
    const row = {
      variant,
      lesson: p.lesson,
      slide: p.slide,
      id: p.id,
      pass,
      fits: verdict.fits,
      visible: verdict.visible,
      why: verdict.why,
      inputTokens: c.inputTokens,
      cachedInputTokens: c.cachedInputTokens,
      outputTokens: c.outputTokens,
      costUsd: c.costUsd,
    };
    rows.push(row);
    appendFileSync(`${out}/rows.jsonl`, `${JSON.stringify(row)}\n`);
    console.log(variant, p.lesson.slice(0, 3), p.slide, pass, c.inputTokens, c.costUsd);
  }
}
console.log(`spent $${spent().toFixed(5)}`);
