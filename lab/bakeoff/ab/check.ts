// A/B $0 checks: bun lab/bakeoff/ab/check.ts [--pin]
// 1. base is round 5: system length per stage = round 5's recorded systemChars, and the T hash
//    (pin.py's rule over system + schema) = the round 5 run pin.
// 2. every arm: the menu's diagram kinds = the schema's kind enum; no unfilled token; a schema strict
//    mode accepts; a2 carries "ask is the slide's line".
// 3. the compiled request (system as sent, schema, user turn with round 5's approved objectives) for
//    the 6 A/B briefs in every arm -> BAKEOFF/ab/compiled/<arm>/<brief>.json; the user turn must equal
//    round 5's request.json user; each arm is diffed against base (ab/compiled/DIFF.md).
// --pin writes BAKEOFF/ab/PINS.json (sha256 of every arm file and the shared prompts) when all pass.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { openaiSchemaFaults } from "../../../packages/slides/src/diagrams/wire";
import { armT } from "../arm-t";
import { contextBlock } from "../harness";
import { localise, setLocale } from "../locale";
import {
  AB,
  AB_ARMS,
  type AbArm,
  abFiles,
  CODE_PINNED,
  menuKinds,
  PICTURE_VERSIONS,
  REPO,
  ROUND5_SYSTEM_CHARS,
  ROUND5_T_PIN,
  ROUND5_VERBATIM,
  SHARED_PINNED,
  STAGES,
  schemaKinds,
  setAbArm,
  sha,
  tPin,
} from "./arms";

const BAKEOFF = AB.replace(/\/ab$/, "");
const C4 = ", as compact JSON with no indentation";
export const AB_BRIEFS = [
  "y1-science-animals-young",
  "y5-maths-fractions-of-amounts",
  "y11-chemistry-rates-of-reaction",
  "y2-maths-halves-quarters",
  "y8-french-my-family",
  "y12-psychology-multi-store-model",
];
let bad = 0;
const fail = (m: string) => {
  bad++;
  console.log("FAIL", m);
};
const ok = (m: string) => console.log("ok  ", m);
const have = (a: AbArm) => STAGES.every((st) => existsSync(abFiles(a, st).system));

// 1-2. files
for (const a of AB_ARMS) {
  if (!have(a)) {
    fail(`${a}: system files missing in ab/prompts/${a}/ (prompt agent's)`);
    continue;
  }
  if (!existsSync(`${AB}/prompts/${a}/shared/restage.txt`)) fail(`${a}: no shared/restage.txt`);
  for (const st of STAGES) {
    const f = abFiles(a, st);
    const system = readFileSync(f.system, "utf8");
    const schema = JSON.parse(readFileSync(f.schema, "utf8"));
    const mk = menuKinds(system);
    const sk = schemaKinds(schema);
    const miss = sk.filter((k) => !mk.includes(k));
    const extra = mk.filter((k) => !sk.includes(k));
    if (miss.length || extra.length)
      fail(`${a} ${st}: menu vs schema kinds: schema only [${miss}], menu only [${extra}]`);
    if (/\{\{/.test(localise(system))) fail(`${a} ${st}: unfilled token`);
    const sf = openaiSchemaFaults(schema, true);
    if (sf.length) fail(`${a} ${st}: strict schema faults: ${sf.slice(0, 2).join("; ")}`);
    if (a === "a2" && !system.includes("ask is the slide's line"))
      fail(`a2 ${st}: compiled system lacks "ask is the slide's line"`);
    if (a !== "a2" && /\bask_without\b/.test(system)) fail(`${a} ${st}: mentions ask_without`);
    if (a === "base") {
      // base = round 5 byte for byte + C4 (compact JSON, the ledger's "ship it"), and nothing else.
      const v = abFiles("base", st, ROUND5_VERBATIM);
      const r5 = readFileSync(v.system, "utf8");
      if (r5.length !== ROUND5_SYSTEM_CHARS[st])
        fail(`round5-verbatim ${st}: ${r5.length} chars, round 5 sent ${ROUND5_SYSTEM_CHARS[st]}`);
      if (
        system !== r5.replace("in the same order.", `in the same order${C4}.`) ||
        !r5.includes("in the same order.")
      )
        fail(`base ${st}: not round 5 + the C4 clause`);
      if (readFileSync(f.schema, "utf8") !== readFileSync(v.schema, "utf8"))
        fail(`base ${st}: schema is not round 5's`);
    }
  }
}
{
  const p = tPin(ROUND5_VERBATIM);
  if (p === ROUND5_T_PIN)
    ok(`round5-verbatim T hash ${p} = round 5 run pin; base = it + C4 (checked per stage)`);
  else fail(`round5-verbatim T hash ${p} != round 5 run pin ${ROUND5_T_PIN}`);
}

// Pictures: round 5's director and judge in every arm (they are code, so one version for all arms).
{
  const dir = readFileSync(`${REPO}/${CODE_PINNED[0]}`, "utf8");
  const judge = readFileSync(`${REPO}/${CODE_PINNED[1]}`, "utf8");
  if (!dir.includes(`"${PICTURE_VERSIONS.director}"`))
    fail(`director is not ${PICTURE_VERSIONS.director}`);
  else if (!judge.includes(`"${PICTURE_VERSIONS.judge}"`))
    fail(`picture judge is not ${PICTURE_VERSIONS.judge}`);
  else
    ok(`pictures: ${PICTURE_VERSIONS.director}, ${PICTURE_VERSIONS.judge} (round 5) in every arm`);
}

// 3. compiled requests
const out = `${AB}/compiled`;
type Req = {
  arm: AbArm;
  model: string;
  effort: string;
  user: string;
  system: string;
  schema: unknown;
};
const reqs: Record<string, Record<string, Req>> = {};
for (const a of AB_ARMS) {
  if (!have(a)) continue;
  setAbArm(a);
  for (const id of AB_BRIEFS) {
    const brief = JSON.parse(readFileSync(`${BAKEOFF}/briefs/${id}.json`, "utf8"));
    setLocale(brief.locale);
    const r5 = JSON.parse(readFileSync(`${BAKEOFF}/round5/runs/T/${id}/request.json`, "utf8"));
    const obj = JSON.parse(readFileSync(`${BAKEOFF}/round5/runs/T/${id}/objectives.json`, "utf8"));
    const p = armT.prompt(brief) as {
      system: string;
      schema: unknown;
      model: string;
      effort: string;
    };
    const req: Req = {
      arm: a,
      model: p.model,
      effort: p.effort,
      user: contextBlock(brief, obj.objectives),
      system: localise(p.system),
      schema: p.schema,
    };
    if (req.user !== r5.user) fail(`${a} ${id}: user turn differs from round 5's`);
    if (req.model !== r5.model || req.effort !== r5.effort) fail(`${a} ${id}: model/effort differ`);
    if (a === "base" && req.system.length !== r5.systemChars + C4.length)
      fail(`base ${id}: system ${req.system.length} chars, round 5 ${r5.systemChars} + C4`);
    mkdirSync(`${out}/${a}`, { recursive: true });
    writeFileSync(`${out}/${a}/${id}.json`, JSON.stringify(req, null, 1));
    const byBrief = reqs[a] ?? {};
    byBrief[id] = req;
    reqs[a] = byBrief;
  }
}
setAbArm(undefined);
setLocale(undefined);

/** Line diff (LCS) of two texts: the removed and added lines. */
function lineDiff(x: string, y: string): { del: string[]; add: string[] } {
  const a = x.split("\n");
  const b = y.split("\n");
  const L = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      L[i]![j] = a[i] === b[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
  const del: string[] = [];
  const add: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length)
    if (a[i] === b[j]) {
      i++;
      j++;
    } else if (L[i + 1]![j]! >= L[i]![j + 1]!) del.push(a[i++]!);
    else add.push(b[j++]!);
  while (i < a.length) del.push(a[i++]!);
  while (j < b.length) add.push(b[j++]!);
  return { del, add };
}
/** JSON paths whose values differ. */
function jsonDiff(x: unknown, y: unknown, path = "$"): string[] {
  if (JSON.stringify(x) === JSON.stringify(y)) return [];
  if (
    x &&
    y &&
    typeof x === "object" &&
    typeof y === "object" &&
    !Array.isArray(x) &&
    !Array.isArray(y)
  ) {
    const keys = [...new Set([...Object.keys(x), ...Object.keys(y)])];
    return keys.flatMap((k) =>
      jsonDiff(
        (x as Record<string, unknown>)[k],
        (y as Record<string, unknown>)[k],
        `${path}.${k}`,
      ),
    );
  }
  return [`${path}: ${JSON.stringify(x)?.slice(0, 120)} -> ${JSON.stringify(y)?.slice(0, 120)}`];
}
const md: string[] = [
  "# A/B compiled requests: each arm against base (generated by lab/bakeoff/ab/check.ts)",
  "",
];
const base = reqs.base;
for (const a of AB_ARMS.filter((x) => x !== "base")) {
  if (!base || !reqs[a]) continue;
  md.push(`## ${a}`, "");
  let first = true;
  const sigs = new Set<string>();
  for (const id of AB_BRIEFS) {
    const b = base[id] as Req;
    const r = reqs[a][id] as Req;
    const other = (["model", "effort", "user"] as const).filter((k) => b[k] !== r[k]);
    if (other.length) fail(`${a} ${id}: ${other.join(", ")} differ from base`);
    const sd = lineDiff(b.system, r.system);
    const jd = jsonDiff(b.schema, r.schema);
    const sig = `${sd.del.length}/${sd.add.length}/${jd.length}`;
    sigs.add(
      `${id.startsWith("y1-") || id.startsWith("y2-") ? "KS1" : id.startsWith("y5") ? "KS2" : "KS3-5"} ${sig}`,
    );
    md.push(
      `- ${id}: system -${sd.del.length} +${sd.add.length} lines (${r.system.length - b.system.length >= 0 ? "+" : ""}${r.system.length - b.system.length} chars); schema ${jd.length} paths; model, effort, user identical`,
    );
    if (first) {
      md.push(
        "",
        "  System lines removed:",
        ...sd.del.map((l) => `  - \`${l.slice(0, 400)}\``),
        "",
        "  System lines added:",
        ...sd.add.map((l) => `  + \`${l.slice(0, 400)}\``),
        "",
        "  Schema paths changed:",
        ...jd.slice(0, 40).map((l) => `  * ${l}`),
        "",
      );
      first = false;
    }
    writeFileSync(
      `${out}/${a}/${id}.diff.txt`,
      [
        ...sd.del.map((l) => `- ${l}`),
        ...sd.add.map((l) => `+ ${l}`),
        ...jd.map((l) => `* ${l}`),
      ].join("\n"),
    );
  }
  md.push("", `Per stage (removed/added lines/schema paths): ${[...sigs].join("; ")}`, "");
}
writeFileSync(`${out}/DIFF.md`, md.join("\n"));
console.log(
  `compiled ${Object.values(reqs).reduce((n, x) => n + Object.keys(x).length, 0)} requests -> ${out}`,
);

if (process.argv.includes("--pin")) {
  if (bad) fail("not pinning: fix the failures first");
  else {
    const pins: Record<string, string> = {};
    for (const a of AB_ARMS) {
      for (const st of STAGES)
        for (const f of Object.values(abFiles(a, st)))
          pins[f.slice(AB.length + 1)] = sha(readFileSync(f));
      for (const f of SHARED_PINNED) {
        const path = `${AB}/prompts/${a}/${f}`;
        if (existsSync(path)) pins[path.slice(AB.length + 1)] = sha(readFileSync(path));
      }
    }
    for (const f of CODE_PINNED) pins[`code:${f}`] = sha(readFileSync(`${REPO}/${f}`));
    writeFileSync(`${AB}/PINS.json`, JSON.stringify(pins, null, 1));
    ok(`pinned ${Object.keys(pins).length} files -> ${AB}/PINS.json`);
  }
}
process.exit(bad ? 1 : 0);
