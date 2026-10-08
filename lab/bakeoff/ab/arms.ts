// A/B arms (7 Oct): a round 5 baseline and three one-delta arms, picked by `run.ts --arm base|a1|a2|a3`
// (round9/RULE-LEDGER.md §C, §E). Never an env var: the arm is a run argument and is written into
// request.json. Writer text, schemas and shared prompts are the prompt agent's per-arm sets
// (BAKEOFF/ab/prompts/<arm>/{T,shared}/; round 5 hash-proven, ab/PROMPTS.md), checked by ab/check.ts
// and pinned in ab/PINS.json. Nothing is appended to the system text (no subject block in any arm).
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";

// Not imported from services.ts (services imports this file; the constant would not be set yet).
const BAKEOFF =
  "/Users/gregwallace/Documents/experiments/ai-teacher/scratchpad/quality-prd/lab/rounds/BAKEOFF";

export const AB_ARMS = [
  "base",
  "a1",
  "a2",
  "a3",
  "base2",
  "b2-a2",
  "b2-a3",
  "k1",
  "base3",
  "b3-r2",
  "b3-d1",
  "b3-l1",
  "b3-m1",
  "b3-r1",
  "b3-r1t",
  "b3-ms",
  "base4",
  "b4-r1t",
  "b4-ms",
  "b4-r1t2",
  "b4-ex",
  "b4-r1t3",
  "judge20",
  "dir-stage",
  "y1fix",
  "lib",
  "locale",
  "polish",
  "polish2",
  "locale2",
  "locale3",
  "base5",
  "checkdef",
] as const;
export type AbArm = (typeof AB_ARMS)[number];
export const isAbArm = (x: unknown): x is AbArm => AB_ARMS.includes(x as AbArm);
export const AB = `${BAKEOFF}/ab`;
export const STAGES = ["KS1", "KS2", "KS3-5"] as const;

/** What each arm changes on top of round 5 (code side). */
export const AB_CONFIG: Record<
  AbArm,
  {
    ask: boolean;
    kinds: string[];
    meaningKinds: string[];
    delta: string;
    fixes?: boolean;
    r2?: boolean;
    r1t?: boolean;
    r1t2?: boolean;
    r1t3?: boolean;
    stageBank?: boolean;
    lib?: boolean;
    polish?: boolean;
    /** polish2 (D30): base4's judge input, a log-only colour gate, per-label clash fallback. */
    polish2?: boolean;
    /** checkdef: one more objective-repair turn when the re-check rejects the first. */
    objRetry?: boolean;
    /** checkdef: only hinge, question-set, practice and exit-ticket slides count as checks. */
    checkDef?: boolean;
  }
> = {
  base: { ask: false, kinds: [], meaningKinds: [], delta: "round 5 writer prompt and schema" },
  a1: { ask: false, kinds: [], meaningKinds: [], delta: "C1 specialist moves (prompt only)" },
  a2: {
    ask: true,
    kinds: [],
    meaningKinds: [],
    delta: "C2 ask / ask_without: schema visual_defs(ask=True), definition, examples, resolveAsks",
  },
  a3: {
    ask: false,
    kinds: ["equal-groups", "fraction-shapes"],
    meaningKinds: ["equal-groups", "fraction-shapes", "flow"],
    delta: "C3 equal-groups and fraction-shapes kinds, flow gloss, meaning drawer for those three",
  },
  // D4 (7 Oct): the lab base is round 5 + A1. base2 = a1 exactly; b2-a2 and b2-a3 add A2's and A3's
  // deltas, unchanged, on top of it.
  base2: { ask: false, kinds: [], meaningKinds: [], delta: "D4 base: round 5 + A1 (= a1)" },
  "b2-a2": {
    ask: true,
    kinds: [],
    meaningKinds: [],
    delta: "base2 + C2 ask / ask_without (A2's delta unchanged)",
  },
  "b2-a3": {
    ask: false,
    kinds: ["equal-groups", "fraction-shapes"],
    meaningKinds: ["equal-groups", "fraction-shapes", "flow"],
    delta: "base2 + C3 kinds, flow gloss, meaning drawer (A3's delta unchanged)",
  },
  // D11 (7 Oct): K1, the flow's schema bounds are the whole lesson (9..12), not the slides array's.
  k1: {
    ask: false,
    kinds: [],
    meaningKinds: [],
    delta: "base2 + K1 flow bounds lo..hi (schema only)",
  },
  // D11a (7 Oct): k1 passed its writer-only screen. base3 = k1's prompt files + the correctness fixes.
  base3: {
    ask: false,
    kinds: [],
    meaningKinds: [],
    fixes: true,
    delta: "D11a base: base2 + K1 + K3 (incomplete writer fails) + seeded hinge shuffle",
  },
  // D12 (7 Oct): one prompt line each on base3, drafted by the prompt-engineer (ab/arms3/<arm>), unedited.
  "b3-d1": {
    ask: false,
    kinds: [],
    meaningKinds: [],
    fixes: true,
    delta:
      "base3 + d1: a picture is one scene; separate things get separate pictures (picture bullet)",
  },
  "b3-l1": {
    ask: false,
    kinds: [],
    meaningKinds: [],
    fixes: true,
    delta:
      "base3 + l1: the give-away rule covers a question's picture or diagram (base-head line 19)",
  },
  // D13 (8 Oct): misconception arms, one prompt line each on base3 (ab/arms3/<arm>, unedited).
  "b3-m1": {
    ask: false,
    kinds: [],
    meaningKinds: [],
    fixes: true,
    delta: "base3 + m1: a misconception slide only where a well-known one exists",
  },
  "b3-r1": {
    ask: false,
    kinds: [],
    meaningKinds: [],
    fixes: true,
    delta: "base3 + r1: the misconception clause removed",
  },
  // D18 (8 Oct): structural arms on base3; schemas from lab/bakeoff/ab/structural.ts, wording from the
  // prompt-engineer (ab/arms3/<arm>/REQUEST.md).
  "b3-r1t": {
    ask: false,
    kinds: [],
    meaningKinds: [],
    fixes: true,
    r1t: true,
    delta:
      "base3 + R1 stage 1: question pictures as 0-4 one-thing tiles; items carry needs_picture",
  },
  "b3-ms": {
    ask: false,
    kinds: [],
    meaningKinds: [],
    fixes: true,
    delta: "base3 + a nullable misconception slot before the flow",
  },
  // D19a (8 Oct): base4 = b3-r2 (base3 + R2), files byte for byte; the structural arms rebased onto it.
  base4: {
    ask: false,
    kinds: ["equal-groups", "fraction-shapes"],
    meaningKinds: [],
    fixes: true,
    r2: true,
    delta: "D19a base: base3 + R2 (= b3-r2)",
  },
  "b4-r1t": {
    ask: false,
    kinds: ["equal-groups", "fraction-shapes"],
    meaningKinds: [],
    fixes: true,
    r2: true,
    r1t: true,
    delta:
      "base4 + R1 stage 1: question pictures as 0-4 one-thing tiles; items carry needs_picture",
  },
  "b4-ms": {
    ask: false,
    kinds: ["equal-groups", "fraction-shapes"],
    meaningKinds: [],
    fixes: true,
    r2: true,
    delta: "base4 + a nullable misconception slot before the flow",
  },
  // Round 6 (8 Oct): R1 stage 2 in code on b4-r1t's files; b4-ex = base4 with its two labels-only examples fixed.
  "b4-r1t2": {
    ask: false,
    kinds: ["equal-groups", "fraction-shapes"],
    meaningKinds: [],
    fixes: true,
    r2: true,
    r1t: true,
    r1t2: true,
    delta:
      "b4-r1t + R1 stage 2: judge-covered pictures only, drop needs_picture items, remove emptied checks, restage layout only",
  },
  // Round 6 (8 Oct, rootcause/pictures.md): b4-r1t2 + every director picture fetched + a tile layout.
  "b4-r1t3": {
    ask: false,
    kinds: ["equal-groups", "fraction-shapes"],
    meaningKinds: [],
    fixes: true,
    r2: true,
    r1t: true,
    r1t2: true,
    r1t3: true,
    delta: "b4-r1t2 + findDirected fetches every director picture + tiles laid out as a 2-4 grid",
  },
  // Round 6 (8 Oct): base4 with the prompt-engineer's picture judge v20 (arms3/judge); writer files = base4.
  judge20: {
    ask: false,
    kinds: ["equal-groups", "fraction-shapes"],
    meaningKinds: [],
    fixes: true,
    r2: true,
    delta:
      "base4 with picture judge v20 (seen before the verdicts; age, stage and size only from the picture)",
  },
  // Round 6 (9 Oct): base4 with picture director v12 (arms3/dir-stage: stage animals generated).
  "dir-stage": {
    ask: false,
    kinds: ["equal-groups", "fraction-shapes"],
    meaningKinds: [],
    fixes: true,
    r2: true,
    delta:
      "base4 with picture director v12 (an unnamed living thing at an age, stage or sex is generated)",
  },
  // Round 6 (9 Oct, Greg): the Year 1 fixes together: b4-r1t3 + D8 (in code for every arm) + director v12
  // + the bank rule (a stage request never reuses a stock bank row).
  y1fix: {
    ask: false,
    kinds: ["equal-groups", "fraction-shapes"],
    meaningKinds: [],
    fixes: true,
    r2: true,
    r1t: true,
    r1t2: true,
    r1t3: true,
    stageBank: true,
    delta: "b4-r1t3 + D8 + director v12 + stage requests never reuse stock bank rows",
  },
  // lib (9 Oct, Greg): base4 + the writer may call a library model; a luna call fills its params,
  // code checks (schema, validate, one repair) and the library engine draws it (ab/lib.ts).
  lib: {
    ask: false,
    kinds: ["equal-groups", "fraction-shapes"],
    meaningKinds: [],
    fixes: true,
    r2: true,
    lib: true,
    delta:
      "base4 + figure kind model: writer picks a library model by id with an intent, luna fills its params, schema + validate + one repair, library engine draws",
  },
  // locale (8 Oct, Greg): base4 with the teacher's country in the writer, objectives and objective
  // repair prompts ({{locale.country}}, {{locale.setting}}) and no key stage outside England.
  // England compiles byte for byte to base4 (arms3/locale/DIFF.md).
  locale: {
    ask: false,
    kinds: ["equal-groups", "fraction-shapes"],
    meaningKinds: [],
    fixes: true,
    r2: true,
    delta:
      "base4 with the teacher's country in place of England (writer, objectives, objective repair); England byte-exact",
  },
  // polish (9 Oct, rootcause/uk-seasons.md): base4 + code fixes (ab/polish.ts): code's title
  // subtitle, snug flow/cycle nodes, label gap gate, strips kind, 768 px judge input, photo gate,
  // per-stage picture timings. Writer files = base4's until arms3/polish/REQUEST.md lands.
  polish: {
    ask: false,
    kinds: ["equal-groups", "fraction-shapes"],
    meaningKinds: [],
    fixes: true,
    r2: true,
    polish: true,
    delta:
      "base4 + code fixes: code title subtitle, snug nodes, label gap gate, strips kind, 768 px judge, photo gate, picture stage timings",
  },
  // polish2 (D30, 9 Oct): polish without the 768 px judge (base4's judge input), the colour gate
  // logging only, and a label clash refitted then dropped per label, never the whole diagram.
  // Writer files = polish's (recall clause removed, strips).
  polish2: {
    ask: false,
    kinds: ["equal-groups", "fraction-shapes"],
    meaningKinds: [],
    fixes: true,
    r2: true,
    polish: true,
    polish2: true,
    delta:
      "polish minus the 768 px judge; colour gate logs only; label clashes refit then drop one label, never the diagram",
  },
  // locale2 (8 Oct, Greg): locale plus one computed sentence ({{locale.place}}) after the country line:
  // where the topic depends on place, use the country's real facts (seasons by month, hemisphere,
  // climate, plants and animals, festivals, currency, units). England byte-exact to base4
  // (arms3/locale2/DIFF.md).
  locale2: {
    ask: false,
    kinds: ["equal-groups", "fraction-shapes"],
    meaningKinds: [],
    fixes: true,
    r2: true,
    delta:
      "locale + the country's place facts where the topic depends on them (writer, objectives, objective repair); England byte-exact",
  },
  // locale3 (8 Oct, Greg): locale2 with the list of kinds of fact removed; one short sentence
  // ({{locale.placeShort}}) leaves the judgement to the model. England byte-exact to base4
  // (arms3/locale3/NOTE.md).
  locale3: {
    ask: false,
    kinds: ["equal-groups", "fraction-shapes"],
    meaningKinds: [],
    fixes: true,
    r2: true,
    delta:
      "locale + one short sentence: where the topic depends on place, use what is true in the country (no list); England byte-exact",
  },
  // base5 (D32, D33, 9 Oct): base4 + recall clause removed (D28) + polish's code fixes (title
  // subtitle, cycle box sizing, strips drawn, strips menu and schema) + polish2's label refit with
  // protected labels never dropped (8a6a79a2) + locale3's country line. Not the 768 px judge; the
  // colour gate logs only. Writer files = polish2's with locale3's delta on base4 merged in
  // (England compiles byte for byte to polish2).
  base5: {
    ask: false,
    kinds: ["equal-groups", "fraction-shapes"],
    meaningKinds: [],
    fixes: true,
    r2: true,
    polish: true,
    polish2: true,
    delta:
      "polish2 + locale3's country line (England byte-exact to polish2); recall clause removed, code title, cycle sizing, strips, protected labels never dropped",
  },
  // checkdef (9 Oct): base5 + one definition in the writer's flow step and in objective-repair: only
  // a slide where pupils answer (question-set, practice, hinge, exit-ticket) checks an objective; an
  // explaining or modelling slide only teaches. Code: base5's switches + objRetry (one more repair
  // turn naming what is still missing when the re-check rejects the first) + checkDef (coverage
  // counts only CHECKDEF_TEMPLATES as checks, so discussion slides no longer do).
  checkdef: {
    ask: false,
    kinds: ["equal-groups", "fraction-shapes"],
    meaningKinds: [],
    fixes: true,
    r2: true,
    polish: true,
    polish2: true,
    objRetry: true,
    checkDef: true,
    delta:
      "base5 + checks defined: only question-set, practice, hinge or exit-ticket slides check (writer + objective-repair)",
  },
  "b4-ex": {
    ask: false,
    kinds: ["equal-groups", "fraction-shapes"],
    meaningKinds: [],
    fixes: true,
    r2: true,
    delta: "base4 with the number-line and line-graph example slides in R2 spec form",
  },
  // D11 R2 (RADICAL.md): structured kinds are per-kind spec defs the writer fills; code draws them.
  // Prompt text is base3's until the prompt-engineer rewrites the diagram section.
  "b3-r2": {
    ask: false,
    kinds: ["equal-groups", "fraction-shapes"],
    meaningKinds: [],
    fixes: true,
    r2: true,
    delta:
      "base3 + R2: writer spec defs per kind and slot (SLOT_LIMITS caps), code draws, drawer fallback",
  },
};
/** The arm each arm is diffed against, and the arm whose delta it must reproduce (D4). */
export const AB_REF: Partial<Record<AbArm, { ref: AbArm; same?: [AbArm, AbArm] }>> = {
  a1: { ref: "base" },
  a2: { ref: "base" },
  a3: { ref: "base" },
  base2: { ref: "a1" },
  "b2-a2": { ref: "base2", same: ["base", "a2"] },
  "b2-a3": { ref: "base2", same: ["base", "a3"] },
  k1: { ref: "base2" },
  base3: { ref: "k1" },
  "b3-r2": { ref: "base3" },
  "b3-d1": { ref: "base3" },
  "b3-l1": { ref: "base3" },
  "b3-m1": { ref: "base3" },
  "b3-r1": { ref: "base3" },
  "b3-r1t": { ref: "base3" },
  "b3-ms": { ref: "base3" },
  base4: { ref: "b3-r2" },
  "b4-r1t": { ref: "base4" },
  "b4-ms": { ref: "base4" },
  "b4-r1t2": { ref: "b4-r1t" },
  "b4-ex": { ref: "base4" },
  "b4-r1t3": { ref: "b4-r1t" },
  judge20: { ref: "base4" },
  "dir-stage": { ref: "base4" },
  y1fix: { ref: "b4-r1t" },
  lib: { ref: "base4" },
  locale: { ref: "base4" },
  locale2: { ref: "locale" },
  locale3: { ref: "locale2" },
  polish: { ref: "base4" },
  polish2: { ref: "polish" },
  base5: { ref: "polish2" },
  checkdef: { ref: "base5" },
};

/** The run's arm (run.ts sets it once; undefined = the old shared prompts/T path). */
let current: AbArm | undefined;
export function setAbArm(a: AbArm | undefined) {
  current = a;
}
export const abArm = () => current;
/**
 * Cache (ab/CACHE.md): `run.ts --code-arm <arm>` takes the code switches below (polish, polish2,
 * fixes, r2...) from another arm while prompts, schemas and picture versions stay the run arm's, so a
 * code-only A/B replays its base's writer from the cache.
 */
let codeArm: AbArm | undefined;
export function setAbCodeArm(a: AbArm | undefined) {
  codeArm = a;
}
const code = () => codeArm ?? current;
/** The `--code-arm` in force, if any (request.json records it). */
export const abCodeArm = () => codeArm;
/** D11 correctness fixes (K3 incomplete-writer failure, seeded hinge shuffle): base3 onwards only. */
/** R1 stage 1 (b3-r1t): the writer's items and tiles are flattened for the harness (writer-only scoring). */
/** R1 stage 2 (b4-r1t2): code drops pointing items whose picture is not shown. */
export const abR1t2 = () => (code() ? Boolean(AB_CONFIG[code() as AbArm].r1t2) : false);
/** b4-r1t3: every director picture fetched, several pictures laid out as tiles. */
export const abR1t3 = () => (code() ? Boolean(AB_CONFIG[code() as AbArm].r1t3) : false);
/** y1fix bank rule: stage requests never reuse stock bank rows. */
export const abStageBank = () => (code() ? Boolean(AB_CONFIG[code() as AbArm].stageBank) : false);
/** lib: the writer's figure kind `model` is filled and drawn by the library (ab/lib.ts). */
/** polish: rootcause/uk-seasons.md code fixes (ab/polish.ts). */
export const abPolish = () => (code() ? Boolean(AB_CONFIG[code() as AbArm].polish) : false);
export const abPolish2 = () => (code() ? Boolean(AB_CONFIG[code() as AbArm].polish2) : false);
export const abObjRetry = () => (code() ? Boolean(AB_CONFIG[code() as AbArm].objRetry) : false);
export const abCheckDef = () => (code() ? Boolean(AB_CONFIG[code() as AbArm].checkDef) : false);
export const abLib = () => (code() ? Boolean(AB_CONFIG[code() as AbArm].lib) : false);
export const abR1t = () => (code() ? Boolean(AB_CONFIG[code() as AbArm].r1t) : false);
/** R2: the writer's own diagram specs are drawn by code (b3-r2). */
export const abR2 = () => (code() ? Boolean(AB_CONFIG[code() as AbArm].r2) : false);
export const abFixes = () => (code() ? Boolean(AB_CONFIG[code() as AbArm].fixes) : false);

/** Round 5 as recorded: system length (JS chars) per stage in round5 request.json, and the T pin. */
export const ROUND5_SYSTEM_CHARS: Record<(typeof STAGES)[number], number> = {
  KS1: 14946,
  KS2: 15092,
  "KS3-5": 15219,
};
export const ROUND5_T_PIN = "1f5fc61a1f30";

/** The prompt agent's layout (ab/PROMPTS.md): <arm>/T/ for the writer, <arm>/shared/ for the rest. */
export const abFiles = (arm: AbArm, stage: string, root = `${AB}/prompts/${arm}`) => ({
  system: `${root}/T/system.${stage}.txt`,
  schema: `${root}/T/schema.${stage}.json`,
  repairSchema: `${root}/T/repair-schema.${stage}.json`,
});
/** Round 5 byte for byte (the hash proof), without C4: ab/round5-verbatim. */
export const ROUND5_VERBATIM = `${AB}/round5-verbatim`;
/** The run's shared prompt folder in A/B mode (round 5's prompts plus restage.txt). */
export const abShared = (): string | undefined =>
  current ? `${AB}/prompts/${current}/shared` : undefined;

export const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

/** prompts/pin.py's T hash (sorted "T/<file>" names, then bytes; first 12 hex) over one arm's files. */
export function tPin(root: string): string {
  const files = STAGES.flatMap((st) => {
    const f = abFiles("base", st, root);
    return [
      [`T/schema.${st}.json`, f.schema],
      [`T/system.${st}.txt`, f.system],
    ] as const;
  }).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const h = createHash("sha256");
  for (const [name, path] of files) {
    h.update(name);
    h.update(readFileSync(path));
  }
  return h.digest("hex").slice(0, 12);
}

/** The diagram kinds a system text's menu names ("Diagram kinds:" block, "- <kind>:" lines). */
export function menuKinds(system: string): string[] {
  const block = system.match(/Diagram kinds:[\s\S]*?(?=\n\s*\n|$)/)?.[0] ?? "";
  return [...block.matchAll(/^\s*-\s*([a-z][a-z-]*):/gm)].map((m) => m[1] as string);
}
/** The diagram kind enum a writer schema offers. */
export function schemaKinds(schema: Record<string, unknown>): string[] {
  const defs = schema.$defs as Record<string, { properties?: { kind?: { enum?: string[] } } }>;
  if (defs?.diagram) return defs.diagram.properties?.kind?.enum ?? [];
  // R2: the per-kind spec defs (dg-<kind>-<slot>) and the freeform def's kinds.
  const kinds = new Set<string>(defs?.["diagram-freeform"]?.properties?.kind?.enum ?? []);
  for (const [n, d] of Object.entries(defs ?? {}))
    if (n.startsWith("dg-")) for (const k of d.properties?.kind?.enum ?? []) kinds.add(k);
  return [...kinds];
}

/**
 * The pinned files a run may use: PINS.json is written by `ab/check.ts --pin` once the $0 checks pass.
 * A paid run refuses to start on any difference (prompt or schema edited after the checks).
 */
export function pinFaults(arm: AbArm): string[] {
  const pinsFile = `${AB}/PINS.json`;
  if (!existsSync(pinsFile)) return [`no ${pinsFile}: run lab/bakeoff/ab/check.ts --pin first`];
  const pins = JSON.parse(readFileSync(pinsFile, "utf8")) as Record<string, string>;
  const out: string[] = [];
  for (const st of STAGES)
    for (const [k, f] of Object.entries(abFiles(arm, st))) {
      const key = f.slice(AB.length + 1);
      if (!existsSync(f)) out.push(`${key} missing (${k})`);
      else if (pins[key] !== sha(readFileSync(f))) out.push(`${key} differs from its pin`);
    }
  // Audit F8: every shared prompt the run reads, from wherever it is read (the arm's copy, or the
  // head BAKEOFF/prompts/shared file outside git), pinned by hash; an absent file is pinned as absent.
  for (const { key, path } of sharedReads(arm)) {
    const now = pinOf(path);
    if (!(key in pins)) out.push(`${key} has no pin (run check.ts --pin)`);
    else if (pins[key] !== now) out.push(`${key} differs from its pin`);
  }
  // lib arm: a stand-in prompt (marked "[PLACEHOLDER") never goes to a paid run.
  for (const f of [
    ...STAGES.map((st) => abFiles(arm, st).system),
    ...SHARED_PINNED.map((x) => `${AB}/prompts/${arm}/${x}`),
  ])
    if (existsSync(f) && readFileSync(f, "utf8").includes("[PLACEHOLDER"))
      out.push(`${f.slice(AB.length + 1)} still holds a placeholder prompt`);
  for (const f of CODE_PINNED)
    if (pins[`code:${f}`] !== sha(readFileSync(`${REPO}/${f}`)))
      out.push(`${f} (code) differs from its pin`);
  return out;
}

/** The non-writer prompt files an arm reads from its own shared/ (pinned). Notes come from the head
 * prompts/shared in every arm (base code item 13), pinned under "shared:". */
/** Round 5's picture prompts, which are code (coordinator, 7 Oct): director v11, judge v17, shortlist. */
export const CODE_PINNED = [
  "packages/generation/src/prompts/picture-director.ts",
  "packages/generation/src/prompts/pick-or-requery-photo.ts",
  "packages/generation/src/prompts/shortlist-photos.ts",
  // Audit F8: the versions judge20, dir-stage and y1fix run (ARM_PICTURE_VERSIONS).
  "packages/generation/src/prompts/picture-director-v12.ts",
  "packages/generation/src/prompts/pick-or-requery-photo-v20.ts",
];
export const REPO = `${import.meta.dir}/../../..`;
export const PICTURE_VERSIONS = {
  director: "picture-director.v11",
  judge: "pick-or-requery-photo.v17",
};
/** Per-arm picture versions over PICTURE_VERSIONS (judge20 runs judge v20; every other arm v17). */
export const ARM_PICTURE_VERSIONS: Partial<Record<AbArm, Partial<typeof PICTURE_VERSIONS>>> = {
  judge20: { judge: "pick-or-requery-photo.v20" },
  "dir-stage": { director: "picture-director.v12" },
  y1fix: { director: "picture-director.v12" },
};
export const pictureVersions = (a: AbArm | undefined) => ({
  ...PICTURE_VERSIONS,
  ...(a ? ARM_PICTURE_VERSIONS[a] : {}),
});

/**
 * check.ts (audit F9): the failure line for a code-only arm whose writer request differs from its
 * reference, named for the arm itself (it once printed "judge20" for dir-stage and "b4-r1t2" for
 * b4-r1t3 and y1fix).
 */
export function codeOnlyFault(arm: string, id: string, differs: boolean): string | undefined {
  if (!differs) return undefined;
  if (arm === "judge20" || arm === "dir-stage")
    return `${arm} ${id}: its request differs from base4 (${arm === "judge20" ? "the judge" : "the director"} is code only)`;
  if (arm === "b4-r1t2" || arm === "b4-r1t3" || arm === "y1fix")
    return `${arm} ${id}: its request differs from b4-r1t (${arm === "b4-r1t2" ? "stage 2" : arm} is code only)`;
  return undefined;
}

/** The head shared prompt folder (outside git). */
export const HEAD_SHARED = `${BAKEOFF}/prompts/shared`;
/** Shared files read only from the head folder, whatever the arm (services.ts, arm-t.ts). */
export const HEAD_ONLY = [
  "shared/illustration-style.txt",
  "shared/house-photo.txt",
  "shared/diagram-contract.v2.txt",
  "shared/diagram-spec.v2.txt",
];
/** A file's pin: its sha256, or "absent" (a file appearing later is a change too). */
export const pinOf = (path: string) => (existsSync(path) ? sha(readFileSync(path)) : "absent");
/**
 * Every shared prompt file an arm's run reads, with its pin key (audit F8). A HEAD_ONLY file, the
 * head subjects/ files and any SHARED_PINNED file the arm has no copy of are read from the head
 * folder and keyed `head:prompts/shared/<f>`; an arm copy keeps its `prompts/<arm>/<f>` key.
 */
export function sharedReads(arm: AbArm): { key: string; path: string }[] {
  const out: { key: string; path: string }[] = [];
  const head = (f: string) => ({ key: `head:prompts/${f}`, path: `${BAKEOFF}/prompts/${f}` });
  for (const f of [...new Set([...SHARED_PINNED, ...HEAD_ONLY])]) {
    const own = `${AB}/prompts/${arm}/${f}`;
    out.push(
      !HEAD_ONLY.includes(f) && existsSync(own)
        ? { key: own.slice(AB.length + 1), path: own }
        : head(f),
    );
  }
  if (existsSync(`${HEAD_SHARED}/subjects`))
    for (const f of readdirSync(`${HEAD_SHARED}/subjects`).sort())
      if (f.endsWith(".txt")) out.push(head(`shared/subjects/${f}`));
  return out;
}

export const SHARED_PINNED = [
  "shared/user.txt",
  "shared/objectives.txt",
  "shared/objectives-user.txt",
  "shared/objectives-schema.json",
  "shared/pupil-objectives.txt",
  "shared/pupil-objectives-user.txt",
  "shared/pupil-objectives-schema.json",
  "shared/repair.txt",
  "shared/repair-user.txt",
  "shared/restage.txt",
  "shared/notes.txt",
  "shared/notes-user.txt",
  "shared/notes-schema.json",
  "shared/objective-repair.txt",
  "shared/diagram-spec.txt",
  "shared/diagram-spec.v2.txt",
  "shared/diagram-contract.v2.txt",
  "shared/director-batch.txt",
  "shared/set-judge.txt",
  "shared/set-judge-schema.json",
  "shared/illustration-style.txt",
  "shared/lib-fill.txt",
  "shared/lib-fill-user.txt",
  "shared/lib-repair-user.txt",
  "shared/base-visuals.txt",
  "shared/base-visuals.KS1.txt",
  "shared/base-visuals.KS2.txt",
  "shared/base-visuals.KS3-5.txt",
];
