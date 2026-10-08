// A/B arms (7 Oct): a round 5 baseline and three one-delta arms, picked by `run.ts --arm base|a1|a2|a3`
// (round9/RULE-LEDGER.md §C, §E). Never an env var: the arm is a run argument and is written into
// request.json. Writer text, schemas and shared prompts are the prompt agent's per-arm sets
// (BAKEOFF/ab/prompts/<arm>/{T,shared}/; round 5 hash-proven, ab/PROMPTS.md), checked by ab/check.ts
// and pinned in ab/PINS.json. Nothing is appended to the system text (no subject block in any arm).
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

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
};

/** The run's arm (run.ts sets it once; undefined = the old shared prompts/T path). */
let current: AbArm | undefined;
export function setAbArm(a: AbArm | undefined) {
  current = a;
}
export const abArm = () => current;
/** D11 correctness fixes (K3 incomplete-writer failure, seeded hinge shuffle): base3 onwards only. */
/** R1 stage 1 (b3-r1t): the writer's items and tiles are flattened for the harness (writer-only scoring). */
/** R1 stage 2 (b4-r1t2): code drops pointing items whose picture is not shown. */
export const abR1t2 = () => (current ? Boolean(AB_CONFIG[current].r1t2) : false);
export const abR1t = () => (current ? Boolean(AB_CONFIG[current].r1t) : false);
/** R2: the writer's own diagram specs are drawn by code (b3-r2). */
export const abR2 = () => (current ? Boolean(AB_CONFIG[current].r2) : false);
export const abFixes = () => (current ? Boolean(AB_CONFIG[current].fixes) : false);

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
  for (const f of SHARED_PINNED) {
    const path = `${AB}/prompts/${arm}/${f}`;
    const key = path.slice(AB.length + 1);
    if (existsSync(path) && pins[key] !== sha(readFileSync(path)))
      out.push(`${key} differs from its pin`);
  }
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
];
export const REPO = `${import.meta.dir}/../../..`;
export const PICTURE_VERSIONS = {
  director: "picture-director.v11",
  judge: "pick-or-requery-photo.v17",
};

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
];
