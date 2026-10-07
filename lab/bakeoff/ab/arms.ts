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

export const AB_ARMS = ["base", "a1", "a2", "a3"] as const;
export type AbArm = (typeof AB_ARMS)[number];
export const isAbArm = (x: unknown): x is AbArm => AB_ARMS.includes(x as AbArm);
export const AB = `${BAKEOFF}/ab`;
export const STAGES = ["KS1", "KS2", "KS3-5"] as const;

/** What each arm changes on top of round 5 (code side). */
export const AB_CONFIG: Record<
  AbArm,
  { ask: boolean; kinds: string[]; meaningKinds: string[]; delta: string }
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
};

/** The run's arm (run.ts sets it once; undefined = the old shared prompts/T path). */
let current: AbArm | undefined;
export function setAbArm(a: AbArm | undefined) {
  current = a;
}
export const abArm = () => current;

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
  return defs?.diagram?.properties?.kind?.enum ?? [];
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
  return out;
}

/** The non-writer prompt files an arm reads from its own shared/ (pinned). Notes come from the head
 * prompts/shared in every arm (base code item 13), pinned under "shared:". */
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
