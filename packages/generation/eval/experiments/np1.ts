import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PRICES } from "@tj/ai";
import { z } from "zod";
import { PROMPTS } from "../../src/prompts";
import { planFactsObjectivePrompt } from "../../src/prompts/plan-facts-objective";
import { planObjectivesPrompt } from "../../src/prompts/plan-objectives";
import { PACK_PROMPTS, type PackPromptName } from "../packs/prompts";
import { rubricJudgePrompt } from "../rubric-prompt";
import np1 from "./np1.json";

/*
 * The experiment file (np1) as typed data, the frozen prompt set and the dry-run spend. The JSON
 * is the committed record: briefs, pack topics and section outcomes fixed before any run; prompt
 * hashes recorded once (`--freeze`) and matched by every run. The hash is over the prompt's
 * `system` plus its `user(sample)`, as `prompts/hash.ts` does for the pinned production prompts.
 */

const SourceRequest = z.strictObject({
  kind: z.enum(["wikipedia", "html"]),
  ref: z.string().min(1),
  licence: z.enum(["CC-BY-SA-4.0", "CC-BY-4.0", "permission", "public-domain"]),
});

export const ExperimentSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  frozenAt: z.string().datetime(),
  rules: z.array(z.string()),
  models: z.record(z.string(), z.string()),
  lessonArms: z.array(z.enum(["live", "grounded", "packed"])),
  authoringArms: z.array(z.enum(["luna-rewrite", "sol-rewrite", "sol-knowledge"])),
  packArmForLessons: z.enum(["luna-rewrite", "sol-rewrite", "sol-knowledge"]),
  /** Which pack facts the lesson arms may use, read from the checkers' recorded verdicts. */
  packAdmission: z
    .strictObject({
      registeredAt: z.string().datetime(),
      rule: z.string(),
      checkers: z.array(z.enum(["luna", "sol"])).min(1),
      correct: z.literal("yes"),
      rejectSupportedByEvidence: z.literal("no"),
    })
    .optional(),
  repeats: z.number().int().positive(),
  briefs: z.strictObject({
    regression: z.array(z.string()),
    heldOut: z.array(z.string()),
    reserve: z.array(z.string()),
  }),
  windowMaxSentences: z.number().int().positive(),
  topics: z.array(
    z.strictObject({
      id: z.string(),
      brief: z.string(),
      subject: z.string(),
      yearGroup: z.string(),
      sources: z.array(SourceRequest).min(1),
      sourceNote: z.string().optional(),
      sections: z
        .array(
          z.strictObject({
            outcome: z.string().min(8).max(120),
            headings: z.array(z.string()).min(1),
          }),
        )
        .min(1),
    }),
  ),
  estimates: z.strictObject({
    note: z.string(),
    tokens: z.record(z.string(), z.strictObject({ in: z.number(), out: z.number() })),
    lessonStagesUsd: z.record(z.string(), z.number()),
    objectivesPerLesson: z.number().int().positive(),
    referenceTokensPerFactsCall: z.number(),
    fillRate: z.number().min(0).max(1),
  }),
  promptHashes: z.record(z.string(), z.string()),
});
export type Experiment = z.infer<typeof ExperimentSchema>;
export type ExperimentTopic = Experiment["topics"][number];
export type LessonArm = Experiment["lessonArms"][number];
export type AuthoringArm = Experiment["authoringArms"][number];

export const EXPERIMENT_PATH = join(import.meta.dir, "np1.json");

export function loadExperiment(): Experiment {
  return ExperimentSchema.parse(np1);
}

/** The briefs the run uses: regression + held-out, in that order; the reserve is not run. */
export function runBriefs(exp: Experiment): string[] {
  return [...exp.briefs.regression, ...exp.briefs.heldOut];
}

export function topicForBrief(exp: Experiment, briefId: string): ExperimentTopic | undefined {
  return exp.topics.find((t) => t.brief === briefId);
}

/* ------------------------------------ prompt hashes -------------------------------------- */

const sha256 = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("hex");

/** The sample inputs each prompt is hashed with: fixed values, so the hash is a function of the text. */
const SAMPLE_INPUTS: Record<string, unknown> = {
  "plan-objectives": {
    topic: "sample",
    shape: sampleShape(),
    audience: { subject: "History", yearGroup: "Year 4" },
  },
  "plan-facts-objective": {
    topic: "sample",
    shape: sampleShape(),
    audience: { subject: "History", yearGroup: "Year 4" },
    objectives: [{ text: "Explain why the Romans invaded Britain" }],
    target: 0,
    // v10: the reference line is part of the text the hash covers.
    reference: { text: "- Key idea: sample" },
  },
  "generate-slide": undefined,
  evaluate: undefined,
  repair: undefined,
};

function sampleShape() {
  return {
    verb: "Explain",
    confidence: "Some prior knowledge",
    requiredKinds: ["content", "worked-example"],
    tierWeights: { easy: 1, core: 1, stretch: 1 },
  };
}

function hashPrompt(
  prompt: { system: string; user: (input: never) => string },
  sample: unknown,
): string {
  let userText = "";
  try {
    userText = sample === undefined ? "" : prompt.user(sample as never);
  } catch {
    userText = "(user turn not rendered for this sample)";
  }
  return sha256(`${prompt.system}\n---\n${userText}`);
}

/** Every prompt the experiment can touch, by name, hashed over its current text. */
export function currentPromptHashes(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of Object.keys(PROMPTS)) {
    const prompt = PROMPTS[name as keyof typeof PROMPTS] as {
      system: string;
      user: (input: never) => string;
    };
    out[name] = hashPrompt(prompt, SAMPLE_INPUTS[name]);
  }
  // The lab plan path's two prompts are not in `PROMPTS` (production's registry): hashed by name.
  out["plan-objectives"] = hashPrompt(
    planObjectivesPrompt as never,
    SAMPLE_INPUTS["plan-objectives"],
  );
  out["plan-facts-objective"] = hashPrompt(
    planFactsObjectivePrompt as never,
    SAMPLE_INPUTS["plan-facts-objective"],
  );
  for (const name of Object.keys(PACK_PROMPTS) as PackPromptName[]) {
    out[name] = hashPrompt(PACK_PROMPTS[name] as never, undefined);
  }
  out["rubric-judge"] = hashPrompt(rubricJudgePrompt as never, undefined);
  return out;
}

/**
 * What the total becomes under levers the experiment could pull, each a design decision to take
 * before the run, none taken here: the numbers are the file's estimates re-summed.
 */
export function levers(exp: Experiment): { lever: string; total: number }[] {
  const { lines, total } = expectedSpend(exp);
  const without = (pred: (l: SpendLine) => boolean) =>
    total - lines.filter(pred).reduce((s, l) => s + l.usd, 0);
  const oneJudgeCall = without((l) => l.item.startsWith("judge addendum"));
  const solChecksLessonPackOnly = without(
    (l) =>
      l.item.startsWith("check ") &&
      l.item.includes(": sol") &&
      !l.item.includes(exp.packArmForLessons),
  );
  const both = oneJudgeCall - (total - solChecksLessonPackOnly);
  const oneRepeat =
    lines
      .filter((l) => !l.item.startsWith("lessons") && !l.item.startsWith("judge"))
      .reduce((s, l) => s + l.usd, 0) +
    lines
      .filter((l) => l.item.startsWith("lessons") || l.item.startsWith("judge"))
      .reduce((s, l) => s + l.usd, 0) /
      exp.repeats;
  return [
    {
      lever:
        "fold the addendum into the rubric call (one judge call per lesson; prompt-engineer decision)",
      total: oneJudgeCall,
    },
    {
      lever: `Sol checker only on the ${exp.packArmForLessons} pack (the one lessons use); Luna checker on all three`,
      total: solChecksLessonPackOnly,
    },
    { lever: "both of the above", total: both },
    {
      lever: "one repeat instead of two (halves lessons and judge; loses the repeat variance)",
      total: oneRepeat,
    },
  ];
}

export interface FreezeCheck {
  ok: boolean;
  /** Names whose hash differs from the frozen one. */
  changed: string[];
  /** Names present now but not in the frozen set (and the reverse). */
  added: string[];
  removed: string[];
}

export function checkFrozen(exp: Experiment, current = currentPromptHashes()): FreezeCheck {
  const frozen = exp.promptHashes;
  const changed = Object.keys(frozen).filter(
    (k) => current[k] !== undefined && current[k] !== frozen[k],
  );
  const added = Object.keys(current).filter((k) => frozen[k] === undefined);
  const removed = Object.keys(frozen).filter((k) => current[k] === undefined);
  return {
    ok: changed.length === 0 && added.length === 0 && removed.length === 0,
    changed,
    added,
    removed,
  };
}

/* ------------------------------------ dry-run spend -------------------------------------- */

export interface SpendLine {
  item: string;
  calls: number;
  model: string;
  usd: number;
}

const priced = (model: string, tokens: { in: number; out: number }, calls: number): number => {
  const p = PRICES[model];
  if (!p) throw new Error(`no price for ${model}`);
  return (calls * (tokens.in * p.inputPerMTok + tokens.out * p.outputPerMTok)) / 1e6;
};

/**
 * Expected spend of the whole experiment from the file's own estimates: pack authoring (three
 * arms over the run topics), checkers (two per section per authoring arm), lessons (briefs ×
 * lesson arms × repeats, priced by stage from the measured ledger), select and fill calls on the
 * packed arm, and the judge (rubric + addendum per lesson). Structural arithmetic only.
 */
export function expectedSpend(exp: Experiment): { lines: SpendLine[]; total: number } {
  const t = exp.estimates.tokens;
  const tok = (name: string) => {
    const v = t[name];
    if (!v) throw new Error(`no token estimate for ${name}`);
    return v;
  };
  const m = exp.models;
  const model = (key: string) => {
    const v = m[key];
    if (!v) throw new Error(`no model for ${key}`);
    return v;
  };
  const briefs = runBriefs(exp);
  const topics = exp.topics.filter((x) => briefs.includes(x.brief));
  const sections = topics.reduce((n, x) => n + x.sections.length, 0);
  const lines: SpendLine[] = [];
  const luna = model("writerLuna");
  const sol = model("writerSol");
  const priceOf = (id: string) => PRICES[id];
  const factsPrice = priceOf(model("lesson"));
  if (!factsPrice) throw new Error(`no price for ${model("lesson")}`);

  // A. authoring
  for (const arm of exp.authoringArms) {
    if (arm === "luna-rewrite")
      lines.push({
        item: `author ${arm}: rewrite × ${sections} sections`,
        calls: sections,
        model: luna,
        usd: priced(luna, tok("pack-rewrite"), sections),
      });
    if (arm === "sol-rewrite")
      lines.push({
        item: `author ${arm}: rewrite × ${sections} sections`,
        calls: sections,
        model: sol,
        usd: priced(sol, tok("pack-rewrite"), sections),
      });
    if (arm === "sol-knowledge") {
      lines.push({
        item: `author ${arm}: knowledge × ${sections}`,
        calls: sections,
        model: sol,
        usd: priced(sol, tok("pack-knowledge"), sections),
      });
      lines.push({
        item: `author ${arm}: link × ${sections}`,
        calls: sections,
        model: model("linker"),
        usd: priced(model("linker"), tok("pack-link"), sections),
      });
    }
    lines.push({
      item: `check ${arm}: luna × ${sections}`,
      calls: sections,
      model: model("checkerLuna"),
      usd: priced(model("checkerLuna"), tok("pack-check"), sections),
    });
    lines.push({
      item: `check ${arm}: sol × ${sections}`,
      calls: sections,
      model: model("checkerSol"),
      usd: priced(model("checkerSol"), tok("pack-check"), sections),
    });
  }

  // C. lessons
  const stages = exp.estimates.lessonStagesUsd;
  const stageSum = (keys: string[]) => keys.reduce((n, k) => n + (stages[k] ?? 0), 0);
  const perLive = stageSum(Object.keys(stages));
  const refExtra =
    (exp.estimates.referenceTokensPerFactsCall *
      factsPrice.inputPerMTok *
      exp.estimates.objectivesPerLesson) /
    1e6;
  const perGrounded = perLive + refExtra;
  const selects = exp.estimates.objectivesPerLesson;
  const fills = exp.estimates.objectivesPerLesson * exp.estimates.fillRate;
  const perPacked =
    stageSum(Object.keys(stages).filter((k) => k !== "facts")) +
    priced(model("select"), tok("pack-select"), selects) +
    priced(model("lesson"), tok("pack-fill"), fills);
  const n = briefs.length * exp.repeats;
  const per: Record<LessonArm, number> = {
    live: perLive,
    grounded: perGrounded,
    packed: perPacked,
  };
  for (const arm of exp.lessonArms) {
    const usd = per[arm] * n;
    lines.push({
      item: `lessons ${arm}: ${briefs.length} briefs × ${exp.repeats} repeats (≈ $${per[arm].toFixed(4)} each)`,
      calls: n,
      model: model("lesson"),
      usd,
    });
  }

  // E. judge
  const lessons = n * exp.lessonArms.length;
  lines.push({
    item: `judge rubric × ${lessons} lessons`,
    calls: lessons,
    model: model("judge"),
    usd: priced(model("judge"), tok("rubric-judge"), lessons),
  });
  lines.push({
    item: `judge addendum × ${lessons} lessons`,
    calls: lessons,
    model: model("judge"),
    usd: priced(model("judge"), tok("judge-addendum"), lessons),
  });

  return { lines, total: lines.reduce((s, l) => s + l.usd, 0) };
}

export function spendMarkdown(exp: Experiment, target: number): string {
  const { lines, total } = expectedSpend(exp);
  const L = ["| item | calls | model | USD |", "|---|---:|---|---:|"];
  for (const l of lines) L.push(`| ${l.item} | ${l.calls} | ${l.model} | $${l.usd.toFixed(4)} |`);
  L.push(`| **total** | ${lines.reduce((s, l) => s + l.calls, 0)} | | **$${total.toFixed(4)}** |`);
  L.push(
    "",
    `target $${target.toFixed(2)}: ${total <= target ? "within" : `OVER by $${(total - target).toFixed(2)}`}`,
  );
  return L.join("\n");
}

if (import.meta.main) {
  const exp = loadExperiment();
  const flag = (n: string) => process.argv.includes(`--${n}`);
  if (flag("freeze")) {
    const next = { ...exp, promptHashes: currentPromptHashes() };
    await Bun.write(EXPERIMENT_PATH, `${JSON.stringify(next, null, 2)}\n`);
    console.log(
      `froze ${Object.keys(next.promptHashes).length} prompt hashes into ${EXPERIMENT_PATH}`,
    );
  } else if (flag("check")) {
    const c = checkFrozen(exp);
    console.log(JSON.stringify(c, null, 2));
    process.exit(c.ok ? 0 : 1);
  } else {
    const at = process.argv.indexOf("--target");
    const target = at === -1 ? 0.85 : Number(process.argv[at + 1]);
    console.log(`# ${exp.id}: ${exp.title}`, "");
    console.log(
      `briefs: regression ${exp.briefs.regression.join(", ")}; held-out ${exp.briefs.heldOut.join(", ")}; reserve ${exp.briefs.reserve.join(", ")}`,
    );
    console.log(
      `arms ${exp.lessonArms.join("/")} × ${exp.repeats} repeats; packs by ${exp.authoringArms.join(", ")}; lessons use the ${exp.packArmForLessons} pack`,
    );
    console.log("", spendMarkdown(exp, target));
    console.log("", "levers (not taken; each is a decision):");
    for (const l of levers(exp)) console.log(`- ${l.lever}: $${l.total.toFixed(2)}`);
    const frozen = checkFrozen(exp);
    console.log(
      "",
      frozen.ok
        ? "prompt hashes: match the frozen set"
        : `prompt hashes: NOT frozen (changed ${frozen.changed.length}, added ${frozen.added.length}, removed ${frozen.removed.length}); run with --freeze once the prompt-engineer's prompts are in`,
    );
    await readFile(EXPERIMENT_PATH); // the file exists and is the one read
  }
}
