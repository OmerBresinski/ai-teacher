// Model checks for the bake-off: answerable, objectives, picture match, reader quiz (+ marking).
// usage:
//   bun llm/run.ts <run dir>...                 dry run (default): writes the exact requests and a cost estimate, no calls
//   EVAL_LIVE=1 EVAL_CAP_USD=0.05 bun llm/run.ts <run dir>...   paid: gpt-6-luna at effort low, cap per run
//   bun llm/run.ts --prompts-md <run dir>      regenerate PROMPTS.md (system prompts + this run's user messages)
//   bun llm/run.ts --only reader,mark <run>    run a subset (answerable, objectives, picq, picvqa, reader, mark, visualfit)
//   EVAL_CACHED=1 bun llm/run.ts --only objectives <run>   $0 re-score: reuse llm/<job>.json only when the new request is
//     byte-identical to the saved requests/<job>.txt; otherwise write requests/<job>.pending.txt, list it as needsLive
//     in cost-cached.json and leave the old output alone. The old objectives.json is kept as objectives.<old version>.json.
// Needs deck.py (deck.json + crops) first. Outputs in eval/out/<arm>/<brief>/: answerable.json, objectives.json,
// picmatch.json, reader.json, llm/<job>.json (raw), requests/<job>.txt, cost.json. Then gates/gates.py merges them.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import * as P from "./prompts.ts";
import { objectivesSlideText, slideText, summariseObjectives } from "./score.ts";

const WT =
  process.env.EVAL_WT ?? "/Users/gregwallace/Documents/experiments/ai-teacher/scratchpad/bake-eval";
const EVAL = resolve(import.meta.dir, "..");
const LIVE = process.env.EVAL_LIVE === "1";
const CACHED = !LIVE && process.env.EVAL_CACHED === "1";
const MODEL = "openai/gpt-6-luna",
  EFFORT = "low";
const PRICE = { in: 0.1 / 1e6, out: 0.5 / 1e6 }; // gpt-6-luna list price (KB openai.md, 25 Sep 2026)
const SLIDE_IMG_TOKENS = 1360; // measured per 1440x810 slide image on gpt-6-luna (KB openai.md, look check, 5 Oct)
const REASONING_GUESS = 700; // output tokens a low-effort call spends before its JSON (KB: 80-1,800 per call)

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
const promptsMd = args.includes("--prompts-md");
const runs = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--only");

let call: (
  job: string,
  system: string,
  user: string,
  schema: any,
  images: string[],
  maxOut: number,
) => Promise<{ output: any; cost: number }>;
if (LIVE) {
  const { createAi, createBudget, costUsd } = await import(`${WT}/packages/ai/src/index.ts`);
  const { callStructured } = await import(`${WT}/packages/generation/src/call.ts`);
  const key = readFileSync(`${homedir()}/.dayback-openai-key`, "utf8").trim();
  const ai = createAi({
    OPENAI_API_KEY: key,
    AI_MODEL_FRONTIER: MODEL,
    AI_MODEL_STANDARD: MODEL,
    AI_MODEL_SMALL: MODEL,
  });
  const budget = createBudget({
    capUsd: Number(process.env.EVAL_CAP_USD ?? 0.05) * Math.max(1, runs.length),
    capTokens: 50_000_000,
  });
  const noop = () => {};
  const logger: any = { info: noop, warn: noop, error: noop, debug: noop, child: () => logger };
  const deps = {
    ai,
    budget,
    signal: new AbortController().signal,
    logger,
    context: { lessonId: "bake-eval", jobId: "bake-eval" },
    effortFor: (_s: string, _n: string, a: string) => a,
  };
  call = async (job, system, user, schema, images, maxOut) => {
    const r = await callStructured({
      deps,
      stage: "generate",
      cls: "small",
      effort: EFFORT,
      prompt: { version: (P.VERSIONS as any)[job], system, user: () => user },
      input: {},
      schema,
      maxOutputTokens: maxOut,
      images: images.map((f, i) => ({
        id: `img${i}`,
        url: `data:image/png;base64,${readFileSync(f).toString("base64")}`,
      })),
    });
    return { output: r.output, cost: costUsd(r.modelId, r.usage) ?? 0 };
  };
}

const imgTokens = (f: string) => {
  // PNG header: width/height at bytes 16-23. Tile estimate scaled to the measured full-slide figure.
  const b = readFileSync(f);
  let w = b.readUInt32BE(16),
    h = b.readUInt32BE(20);
  const k = Math.min(1, 2048 / Math.max(w, h));
  w *= k;
  h *= k;
  const k2 = Math.min(1, 768 / Math.min(w, h));
  w *= k2;
  h *= k2;
  return Math.round(
    (Math.ceil(w / 512) * Math.ceil(h / 512) * 170 + 85) * (SLIDE_IMG_TOKENS / 1105),
  );
};
const est = (system: string, user: string, images: string[], outJson: number) => {
  const tin =
    Math.round((system.length + user.length) / 3.8) +
    400 /* schema */ +
    images.reduce((a, f) => a + imgTokens(f), 0);
  const tout = REASONING_GUESS + outJson;
  return { in: tin, out: tout, usd: tin * PRICE.in + tout * PRICE.out };
};

async function doRun(runArg: string) {
  const run = resolve(runArg);
  const out = `${EVAL}/out/${basename(dirname(run))}/${basename(run)}`;
  const d = JSON.parse(readFileSync(`${out}/deck.json`, "utf8"));
  mkdirSync(`${out}/requests`, { recursive: true });
  mkdirSync(`${out}/llm`, { recursive: true });
  const want = (j: string) => !only || only.includes(j);
  const costs: Record<string, any> = {};
  const md: string[] = [];
  const job = async (
    name: string,
    system: string,
    user: string,
    schema: any,
    images: string[],
    outJson: number,
    tag = name,
  ) => {
    const req = `SYSTEM\n${system}\n\nUSER\n${user}\n\nIMAGES\n${images.join("\n") || "(none)"}\n`;
    const e = est(system, user, images, outJson);
    if (CACHED) {
      const f = `${out}/requests/${tag}.txt`,
        c = `${out}/llm/${tag}.json`;
      if (existsSync(f) && existsSync(c) && readFileSync(f, "utf8") === req) {
        costs[tag] = { estimate: e, usd: 0, cached: true };
        return JSON.parse(readFileSync(c, "utf8"));
      }
      writeFileSync(`${out}/requests/${tag}.pending.txt`, req);
      costs[tag] = { estimate: e, needsLive: true };
      return null;
    }
    writeFileSync(`${out}/requests/${tag}.txt`, req);
    if (!LIVE) {
      costs[tag] = { estimate: e };
      return null;
    }
    const r = await call(name, system, user, schema, images, 8000);
    writeFileSync(`${out}/llm/${tag}.json`, JSON.stringify(r.output, null, 1));
    costs[tag] = { estimate: e, usd: r.cost };
    return r.output;
  };
  const qSlides = d.slides.filter((s: any) => s.questions.length);
  const allQs = qSlides.flatMap((s: any) => s.questions.map((q: any) => ({ ...q, slide: s.n })));

  // 1. answerable
  if (want("answerable") && allQs.length) {
    const user = P.answerableUser(d, slideText);
    md.push(
      `### 1. Answerable from its own slide (${P.VERSIONS.answerable})\n\nUSER (this run):\n\n\`\`\`\n${user}\n\`\`\``,
    );
    const o = await job(
      "answerable",
      P.answerableSystem,
      user,
      P.answerableSchema,
      [],
      allQs.length * 25,
    );
    if (o) {
      const by = Object.fromEntries(o.rows.map((r: any) => [r.id, r]));
      const rows = allQs.map((q: any) => ({
        id: q.id,
        slide: q.slide,
        question: q.text,
        material: by[q.id]?.material ?? "",
        onSlide: by[q.id]?.onSlide ?? "missing",
        givenAwayBy: by[q.id]?.givenAwayBy ?? "",
        givenAway: by[q.id]?.givenAway ?? "missing",
      }));
      writeFileSync(
        `${out}/answerable.json`,
        JSON.stringify({ version: P.VERSIONS.answerable, rows }, null, 1),
      );
    }
  }
  // 2. objectives
  if (want("objectives") && d.objectives.length) {
    const user = P.objectivesUser(d, objectivesSlideText);
    md.push(
      `### 2. Objectives taught and checked (${P.VERSIONS.objectives})\n\nUSER (this run):\n\n\`\`\`\n${user}\n\`\`\``,
    );
    const o = await job(
      "objectives",
      P.objectivesSystem,
      user,
      P.objectivesSchema,
      [],
      d.objectives.length * 120,
    );
    if (o) {
      const summary = summariseObjectives(d, o);
      const prev = `${out}/objectives.json`;
      if (CACHED && existsSync(prev)) {
        const v = JSON.parse(readFileSync(prev, "utf8")).version;
        if (v !== P.VERSIONS.objectives && !existsSync(`${out}/objectives.${v}.json`))
          writeFileSync(`${out}/objectives.${v}.json`, readFileSync(prev, "utf8"));
      }
      writeFileSync(
        `${out}/objectives.json`,
        JSON.stringify({ version: P.VERSIONS.objectives, summary }, null, 1),
      );
    }
  }
  // 3. picture match: questions from text, then answers from the cropped picture
  const pics = d.slides.flatMap((s: any) =>
    s.pictures.filter((p: any) => !p.background).map((p: any) => ({ ...p, slide: s.n })),
  );
  if ((want("picq") || want("picvqa")) && pics.length) {
    const user = P.picqUser(d, slideText);
    md.push(
      `### 3a. Picture questions (${P.VERSIONS.picq})\n\nUSER (this run):\n\n\`\`\`\n${user}\n\`\`\``,
    );
    let qs = want("picq")
      ? await job("picq", P.picqSystem, user, P.picqSchema, [], pics.length * 160)
      : null;
    if (!qs && existsSync(`${out}/llm/picq.json`))
      qs = JSON.parse(readFileSync(`${out}/llm/picq.json`, "utf8"));
    if (!LIVE) {
      // Dry: price one vision call per picture with a typical 4 questions.
      for (const p of pics)
        await job(
          "picvqa",
          P.picvqaSystem,
          P.picvqaUser([1, 2, 3, 4].map((i) => ({ id: `q${i}`, question: "(question from 3a)" }))),
          P.picvqaSchema,
          [`${out}/crops/${p.id}.png`],
          4 * 45,
          `picvqa-${p.id}`,
        );
      md.push(
        `### 3b. Picture answers (${P.VERSIONS.picvqa})\n\nUSER (one per picture; the image is the picture cropped from the 1440 render):\n\n\`\`\`\n${P.picvqaUser(
          [
            { id: "q1", question: "<question from 3a>" },
            { id: "q2", question: "<question from 3a>" },
          ],
        )}\n\`\`\``,
      );
    } else if (qs && want("picvqa")) {
      const rows = await Promise.all(
        pics.map(async (p: any) => {
          const q = (qs.pictures.find((x: any) => x.id === p.id)?.questions ?? []) as any[];
          if (!q.length)
            return {
              id: p.id,
              slide: p.slide,
              kind: p.kind,
              questions: [],
              pass: false,
              why: "no questions",
            };
          const a = await job(
            "picvqa",
            P.picvqaSystem,
            P.picvqaUser(q),
            P.picvqaSchema,
            [`${out}/crops/${p.id}.png`],
            q.length * 45,
            `picvqa-${p.id}`,
          );
          const ans = Object.fromEntries((a?.answers ?? []).map((x: any) => [x.id, x]));
          // Davidsonian scoring: a question whose parent subject is not "yes" counts as "no".
          const res = q.map((x: any) => ({
            ...x,
            seen: ans[x.id]?.seen ?? "",
            answer: ans[x.id]?.answer ?? "missing",
          }));
          const val = (x: any) =>
            x.answer === "yes" &&
            (!x.dependsOn || res.find((y: any) => y.id === x.dependsOn)?.answer === "yes");
          return {
            id: p.id,
            slide: p.slide,
            kind: p.kind,
            request: p.alt,
            questions: res.map((x: any) => ({ ...x, counted: val(x) })),
            pass: res.every(val),
          };
        }),
      );
      const n = rows.length,
        pass = rows.filter((r) => r.pass).length;
      writeFileSync(
        `${out}/picmatch.json`,
        JSON.stringify(
          {
            versions: [P.VERSIONS.picq, P.VERSIONS.picvqa],
            pictures: n,
            pass,
            rate: n ? pass / n : null,
            rows,
          },
          null,
          1,
        ),
      );
    }
  }
  // 4. reader quiz: teaching slides only; questions on question slides before the first teaching slide are excluded (retrieval of earlier lessons)
  const teach = d.slides.filter((s: any) => s.role === "teach");
  const firstTeach = teach[0]?.n ?? 1e9;
  const quizQs = allQs.filter((q: any) => q.slide > firstTeach);
  const shown = teach
    .map((s: any) => s.n)
    .filter((n: number) => existsSync(`${run}/render/slide-${String(n).padStart(2, "0")}.png`));
  if ((want("reader") || want("mark")) && quizQs.length && shown.length) {
    const user = P.readerUser(d, shown, quizQs);
    md.push(
      `### 4a. Reader quiz (${P.VERSIONS.reader})\n\nUSER (this run; images: slides ${shown.join(", ")}):\n\n\`\`\`\n${user}\n\`\`\``,
    );
    let rd = want("reader")
      ? await job(
          "reader",
          P.readerSystem,
          user,
          P.readerSchema,
          shown.map((n: number) => `${run}/render/slide-${String(n).padStart(2, "0")}.png`),
          quizQs.length * 70,
        )
      : null;
    if (!rd && existsSync(`${out}/llm/reader.json`))
      rd = JSON.parse(readFileSync(`${out}/llm/reader.json`, "utf8"));
    const sl = Object.fromEntries(d.slides.map((s: any) => [s.n, s]));
    const ra = Object.fromEntries((rd?.answers ?? []).map((a: any) => [a.id, a]));
    const items = quizQs.map((q: any) => {
      const s = sl[q.slide];
      const a = ra[q.id] ?? {
        slide: 0,
        seen: "",
        answer: LIVE ? "(no answer)" : "<reader's answer>",
      };
      const cited = a.slide && sl[a.slide] ? a.slide : 0;
      return {
        id: q.id,
        slide: q.slide,
        pos: s.questions.findIndex((x: any) => x.id === q.id) + 1,
        of: s.questions.length,
        text: q.text,
        options: q.options,
        notes: s.notes,
        revealed: s.revealed.join(" | "),
        answer: a.answer,
        cited,
        citedText: cited ? slideText(sl[cited]) : "",
        seen: a.seen,
      };
    });
    const mu = P.markUser(d, items);
    md.push(
      `### 4b. Marking (${P.VERSIONS.mark})\n\nUSER (this run, reader answers shown as placeholders in a dry run):\n\n\`\`\`\n${mu}\n\`\`\``,
    );
    const mk =
      want("mark") && (rd || !LIVE)
        ? await job("mark", P.markSystem, mu, P.markSchema, [], quizQs.length * 90)
        : null;
    if (mk) {
      const m = Object.fromEntries(mk.marks.map((x: any) => [x.id, x]));
      const rows = items.map((it: any) => ({
        id: it.id,
        slide: it.slide,
        question: it.text,
        answer: it.answer,
        cited: it.cited,
        ...(m[it.id] ?? { key: "none", matchesKey: "n/a", supported: "no" }),
      }));
      const scored = rows.filter((r: any) => r.key !== "none" && r.matchesKey !== "n/a");
      const taught = scored.filter(
        (r: any) => r.matchesKey === "yes" && r.supported === "yes",
      ).length;
      const lenient = scored.filter(
        (r: any) => r.matchesKey !== "no" && r.supported === "yes",
      ).length;
      writeFileSync(
        `${out}/reader.json`,
        JSON.stringify(
          {
            versions: [P.VERSIONS.reader, P.VERSIONS.mark],
            shown,
            excluded: allQs.length - quizQs.length,
            scored: scored.length,
            taught,
            score: scored.length ? taught / scored.length : null,
            lenientScore: scored.length ? lenient / scored.length : null,
            rows,
          },
          null,
          1,
        ),
      );
    }
  }
  // 5. visual fit (reported, not a gate)
  if (want("visualfit")) {
    const bare = d.slides
      .filter((s: any) => s.role === "teach" && !s.pictures.some((p: any) => !p.background))
      .map((s: any) => s.n);
    const vis = d.slides
      .filter((s: any) => s.role === "teach" || s.role === "question")
      .flatMap((s: any) =>
        s.pictures.filter((p: any) => !p.background).map((p: any) => ({ id: p.id, slide: s.n })),
      );
    const seen: Record<string, string[]> = {};
    for (const v of vis) {
      const f = `${out}/llm/picvqa-${v.id}.json`;
      if (existsSync(f))
        seen[v.id] = (JSON.parse(readFileSync(f, "utf8")).answers ?? [])
          .map((a: any) => a.seen)
          .filter(Boolean);
    }
    const user = P.visualfitUser(d, slideText, seen);
    md.push(
      `### 5. Visual fit (${P.VISUALFIT_VERSION})\n\nUSER (this run):\n\n\`\`\`\n${user}\n\`\`\``,
    );
    const o = await job(
      "visualfit",
      P.visualfitSystem,
      user,
      P.visualfitSchema,
      [],
      bare.length * 40 + vis.length * 45,
    );
    if (o) {
      const need = o.slides.filter((x: any) => bare.includes(x.slide));
      const deco = o.pictures.filter((x: any) => vis.some((v: any) => v.id === x.id));
      const missed = need.filter((x: any) => x.need === "yes").length,
        decorative = deco.filter((x: any) => x.role === "decorative").length;
      writeFileSync(
        `${out}/visualfit.json`,
        JSON.stringify(
          {
            version: P.VISUALFIT_VERSION,
            textOnlyTeach: bare.length,
            missed,
            missedRate: bare.length ? missed / bare.length : null,
            visuals: vis.length,
            decorative,
            decorativeRate: vis.length ? decorative / vis.length : null,
            slides: need,
            pictures: deco,
          },
          null,
          1,
        ),
      );
    }
  }
  const total = Object.values(costs).reduce(
    (a: number, c: any) => a + (c.usd ?? c.estimate.usd),
    0,
  );
  writeFileSync(
    `${out}/${CACHED ? "cost-cached.json" : "cost.json"}`,
    JSON.stringify(
      { live: LIVE, cached: CACHED, model: MODEL, effort: EFFORT, totalUsd: total, jobs: costs },
      null,
      1,
    ),
  );
  return { run: basename(run), total, costs, md };
}

const results = await Promise.all(runs.map(doRun));
for (const r of results) {
  const by: Record<string, number> = {};
  for (const [k, c] of Object.entries(r.costs) as any) {
    const g = k.replace(/-.*/, "");
    by[g] = (by[g] ?? 0) + (c.usd ?? c.estimate.usd);
  }
  console.log(
    r.run,
    LIVE ? "spent" : "estimate",
    `$${r.total.toFixed(4)}`,
    JSON.stringify(Object.fromEntries(Object.entries(by).map(([k, v]) => [k, +v.toFixed(5)]))),
  );
}
if (runs.length > 1)
  console.log(
    "mean per lesson",
    `$${(results.reduce((a, r) => a + r.total, 0) / results.length).toFixed(4)}`,
  );
if (promptsMd) {
  const sys = [
    ["1. Answerable from its own slide", P.VERSIONS.answerable, P.answerableSystem],
    ["2. Objectives taught and checked", P.VERSIONS.objectives, P.objectivesSystem],
    ["3a. Picture questions (text only)", P.VERSIONS.picq, P.picqSystem],
    ["3b. Picture answers (vision, cropped picture)", P.VERSIONS.picvqa, P.picvqaSystem],
    ["4a. Reader quiz (vision, teaching slides only)", P.VERSIONS.reader, P.readerSystem],
    ["4b. Marking the reader (text only)", P.VERSIONS.mark, P.markSystem],
    ["5. Visual fit (text only; reported, not a gate)", P.VISUALFIT_VERSION, P.visualfitSystem],
  ];
  const schemaOf: Record<string, any> = {
    [P.VERSIONS.answerable]: P.answerableSchema,
    [P.VERSIONS.objectives]: P.objectivesSchema,
    [P.VERSIONS.picq]: P.picqSchema,
    [P.VERSIONS.picvqa]: P.picvqaSchema,
    [P.VERSIONS.reader]: P.readerSchema,
    [P.VERSIONS.mark]: P.markSchema,
    [P.VISUALFIT_VERSION]: P.visualfitSchema,
  };
  const { z } = await import("zod");
  const body = sys
    .map(
      ([t, v, s]) =>
        `## ${t}: \`${v}\`\n\nSYSTEM (verbatim):\n\n\`\`\`\n${s}\n\`\`\`\n\nSCHEMA (strict JSON schema, generated from zod):\n\n\`\`\`json\n${JSON.stringify(z.toJSONSchema(schemaOf[v]))}\n\`\`\``,
    )
    .join("\n\n");
  const hdr = `# Bake-off eval prompts\n\nGenerated by \`bun llm/run.ts --prompts-md ${runs[0] ?? ""}\` from \`llm/prompts.ts\`; edit that file, never this one. Model \`${MODEL}\`, effort \`${EFFORT}\`, strict structured output via \`callStructured\` (the pipeline's own call). The judges for item 5 (content panel) are in-session subagents; their brief is \`panel/brief-template.txt\`.\n\n`;
  writeFileSync(
    `${EVAL}/PROMPTS.md`,
    hdr +
      body +
      `\n\n## User messages, as built for \`${results[0]?.run}\`\n\n` +
      (results[0]?.md.join("\n\n") ?? "") +
      "\n",
  );
  console.log("wrote PROMPTS.md");
}
