// A/B $0 checks: bun lab/bakeoff/ab/check.ts [--pin]
// 1. base is round 5: system length per stage = round 5's recorded systemChars, and the T hash
//    (pin.py's rule over system + schema) = the round 5 run pin.
// 2. every arm: the menu's diagram kinds = the schema's kind enum; no unfilled token; a schema strict
//    mode accepts; a2 carries "ask is the slide's line".
// 3. the compiled request (system as sent, schema, user turn with round 5's approved objectives) for
//    the 6 A/B briefs in every arm -> BAKEOFF/ab/compiled/<arm>/<brief>.json; the user turn must equal
//    round 5's request.json user; each arm is diffed against base (ab/compiled/DIFF.md).
// --pin merges into BAKEOFF/ab/PINS.json (sha256 of every arm file and the shared prompts) when all
//    pass: only this worktree's built arms are added or updated; other entries are kept as they are.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { openaiSchemaFaults } from "../../../packages/slides/src/diagrams/wire";
import { armT } from "../arm-t";
import { contextBlock } from "../harness";
import { localise, setLocale } from "../locale";
import {
  AB,
  AB_ARMS,
  AB_CONFIG,
  AB_REF,
  type AbArm,
  abFiles,
  CODE_PINNED,
  codeOnlyFault,
  menuKinds,
  PICTURE_VERSIONS,
  pinOf,
  REPO,
  ROUND5_SYSTEM_CHARS,
  ROUND5_T_PIN,
  ROUND5_VERBATIM,
  SHARED_PINNED,
  STAGES,
  schemaKinds,
  setAbArm,
  sha,
  sharedReads,
  tPin,
} from "./arms";
import { mergePins } from "./pins-merge";

const BAKEOFF = AB.replace(/\/ab$/, "");
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
    // 9 Oct: an arm registered before its prompt folder exists is not built yet: it cannot run
    // (run.ts pinFaults refuses it), so it no longer blocks the other arms' paid runs.
    if (!existsSync(`${AB}/prompts/${a}`)) {
      console.log("skip", `${a}: not built (no ab/prompts/${a}/ yet); it cannot run until it is`);
      continue;
    }
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
    // R2 adds equal-groups and fraction-shapes as spec defs; its menu text is base3's until the
    // prompt-engineer rewrites the diagram section, so only those two may be schema-only there.
    if (AB_CONFIG[a].r2)
      miss.splice(0, miss.length, ...miss.filter((k) => !AB_CONFIG[a].kinds.includes(k)));
    if (miss.length || extra.length)
      fail(`${a} ${st}: menu vs schema kinds: schema only [${miss}], menu only [${extra}]`);
    if (/\{\{/.test(localise(system))) fail(`${a} ${st}: unfilled token`);
    const sf = openaiSchemaFaults(schema, true);
    if (sf.length) fail(`${a} ${st}: strict schema faults: ${sf.slice(0, 2).join("; ")}`);
    if (AB_CONFIG[a].ask && !system.includes("ask is the slide's line"))
      fail(`a2 ${st}: compiled system lacks "ask is the slide's line"`);
    if (!AB_CONFIG[a].ask && /\bask_without\b/.test(system))
      fail(`${a} ${st}: mentions ask_without`);
    if (system.includes("compact JSON")) fail(`${a} ${st}: carries the C4 compact-JSON clause`);
    if (a === "base") {
      // base = round 5 byte for byte (coordinator, 7 Oct: no C4).
      const v = abFiles("base", st, ROUND5_VERBATIM);
      const r5 = readFileSync(v.system, "utf8");
      if (r5.length !== ROUND5_SYSTEM_CHARS[st])
        fail(`round5-verbatim ${st}: ${r5.length} chars, round 5 sent ${ROUND5_SYSTEM_CHARS[st]}`);
      if (system !== r5) fail(`base ${st}: system is not round 5 byte for byte`);
      if (readFileSync(f.schema, "utf8") !== readFileSync(v.schema, "utf8"))
        fail(`base ${st}: schema is not round 5's`);
    }
  }
}
{
  const p = tPin(ROUND5_VERBATIM);
  if (p === ROUND5_T_PIN) ok(`round5-verbatim T hash ${p} = round 5 run pin`);
  else fail(`round5-verbatim T hash ${p} != round 5 run pin ${ROUND5_T_PIN}`);
  const b = tPin(`${AB}/prompts/base`);
  if (b === ROUND5_T_PIN) ok(`base T hash ${b} = round 5 run pin`);
  else fail(`base T hash ${b} != round 5 run pin ${ROUND5_T_PIN}`);
}

// Pictures: round 5's director and judge in every arm (they are code, so one version for all arms).
{
  const dir = readFileSync(`${REPO}/${CODE_PINNED[0]}`, "utf8");
  const judge = readFileSync(`${REPO}/${CODE_PINNED[1]}`, "utf8");
  if (!dir.includes(`"${PICTURE_VERSIONS.director}"`))
    fail(`director is not ${PICTURE_VERSIONS.director}`);
  else if (!judge.includes(`"${PICTURE_VERSIONS.judge}"`))
    fail(`picture judge is not ${PICTURE_VERSIONS.judge}`);
  else if (
    !readFileSync(
      `${REPO}/packages/generation/src/prompts/pick-or-requery-photo-v20.ts`,
      "utf8",
    ).includes('"pick-or-requery-photo.v20"')
  )
    fail("judge20: pick-or-requery-photo-v20.ts is not v20");
  else
    ok(
      `pictures: ${PICTURE_VERSIONS.director}, ${PICTURE_VERSIONS.judge} (round 5) in every arm but judge20 (v20)`,
    );
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
    if (a === "base") {
      const failsBefore = bad;
      // The request as sent (after localise) against round 5's files, byte for byte.
      const st = brief.keyStage === "ks1" ? "KS1" : brief.keyStage === "ks2" ? "KS2" : "KS3-5";
      const v = abFiles("base", st, ROUND5_VERBATIM);
      if (req.system !== readFileSync(v.system, "utf8"))
        fail(`base ${id}: sent system is not round 5's`);
      if (JSON.stringify(req.schema) !== JSON.stringify(JSON.parse(readFileSync(v.schema, "utf8"))))
        fail(`base ${id}: sent schema is not round 5's`);
      // Audit F9: printed unless this check failed (an unrelated arm's failure no longer hides it).
      if (bad === failsBefore) ok(`base ${id}: system, schema, user, model and effort = round 5`);
    }
    if (req.model !== r5.model || req.effort !== r5.effort) fail(`${a} ${id}: model/effort differ`);
    if (a === "base" && req.system.length !== r5.systemChars)
      fail(`base ${id}: system ${req.system.length} chars, round 5 ${r5.systemChars}`);
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
/** [start, end) of the writer's diagram section: the "- A diagram's kind" bullet to the end of the kinds list. */
function diagramSection(sys: string): [number, number] {
  const start = sys.indexOf("\n- A diagram's kind");
  const list = sys.indexOf("\nDiagram kinds:\n", start);
  if (start < 0 || list < 0) return [-1, -1];
  let end = list + "\nDiagram kinds:\n".length;
  while (sys.startsWith("- ", end)) {
    const nl = sys.indexOf("\n", end);
    end = nl < 0 ? sys.length : nl + 1;
  }
  return [start + 1, end];
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
for (const a of AB_ARMS.filter((x) => AB_REF[x])) {
  const spec = AB_REF[a] as { ref: AbArm; same?: [AbArm, AbArm] };
  const base = reqs[spec.ref];
  if (!base || !reqs[a]) continue;
  md.push(`## ${a} (against ${spec.ref})`, "");
  let first = true;
  const sigs = new Set<string>();
  for (const id of AB_BRIEFS) {
    const b = base[id] as Req;
    const r = reqs[a][id] as Req;
    const other = (["model", "effort", "user"] as const).filter((k) => b[k] !== r[k]);
    if (other.length) fail(`${a} ${id}: ${other.join(", ")} differ from ${spec.ref}`);
    const sd = lineDiff(b.system, r.system);
    const jd = jsonDiff(b.schema, r.schema);
    if (a === "base2" && (sd.del.length || sd.add.length || jd.length || b.system !== r.system))
      fail(`base2 ${id}: differs from a1`);
    // D12: d1 and l1 change exactly one system line on every stage, and no schema path.
    if (
      ["b3-d1", "b3-l1", "b3-m1", "b3-r1"].includes(a) &&
      (sd.del.length !== 1 || sd.add.length !== 1 || jd.length)
    )
      fail(
        `${a} ${id}: not exactly one line changed (-${sd.del.length} +${sd.add.length}, ${jd.length} schema paths)`,
      );
    // R2: the system text is base3's; only the diagram defs change.
    // D18: each structural arm touches only its own schema paths, plus at most the requested prompt lines.
    const OWN: Record<string, { paths: RegExp; lines: number }> = {
      "b3-r1t": {
        paths:
          /^\$\.\$defs\.(item|tile|question-set|practice|exit-ticket|[a-z-]+\.properties\.lead)\b/,
        lines: 8,
      },
      "b3-ms": { paths: /^\$\.(properties\.misconception|required)\b/, lines: 1 },
      "b4-ms": { paths: /^\$\.(properties\.misconception|required)\b/, lines: 1 },
    };
    OWN["b4-r1t"] = OWN["b3-r1t"] as { paths: RegExp; lines: number };
    const own = OWN[a];
    if (own) {
      const stray = jd.filter((l) => !own.paths.test(l));
      if (stray.length)
        fail(`${a} ${id}: schema paths outside its own: ${stray.slice(0, 2).join("; ")}`);
      if (sd.del.length > own.lines || sd.add.length > own.lines)
        fail(
          `${a} ${id}: system -${sd.del.length} +${sd.add.length} lines, more than the ${own.lines} requested`,
        );
    }
    // D13: b3-r2's system may differ from base3's only inside the diagram section (the "- A diagram's
    // kind" bullet through the end of the "Diagram kinds:" list); before and after it, byte for byte.
    if (a === "b3-r2") {
      const [x0, x1] = diagramSection(b.system);
      const [y0, y1] = diagramSection(r.system);
      if (
        x0 < 0 ||
        y0 < 0 ||
        b.system.slice(0, x0) !== r.system.slice(0, y0) ||
        b.system.slice(x1) !== r.system.slice(y1)
      )
        fail(`b3-r2 ${id}: its system differs from base3's outside the diagram section`);
      if (jd.some((l) => !/^\$\.\$defs\./.test(l)))
        fail(`b3-r2 ${id}: changes more than the schema's diagram defs`);
    }
    // Audit F9: each failure names its own arm.
    const codeOnly = codeOnlyFault(a, id, jd.length > 0 || b.system !== r.system);
    if (codeOnly) fail(codeOnly);
    // b4-ex: only the two example lines (number-line, line-graph) may change; no schema path.
    if (a === "b4-ex") {
      const ex = (l: string) =>
        l.startsWith('{"template":') && /"kind":"(number-line|line-graph)"/.test(l);
      if (
        jd.length ||
        sd.del.length > 2 ||
        sd.add.length > 2 ||
        !sd.del.every(ex) ||
        !sd.add.every(ex)
      )
        fail(`b4-ex ${id}: changes more than the number-line and line-graph example lines`);
    }
    // base5 (D32/D33): every A/B brief is England, where locale3's line compiles away; so polish2's
    // request byte for byte.
    if (a === "base5" && (jd.length || b.system !== r.system))
      fail(`base5 ${id}: its England request differs from polish2's`);
    // checkdef: base5's request plus one changed system line (the flow step, carrying the checks
    // definition); no schema path.
    if (
      a === "checkdef" &&
      (jd.length ||
        sd.del.length !== 1 ||
        sd.add.length !== 1 ||
        !sd.add[0].includes(
          "a question-set, practice, hinge or exit-ticket slide. A slide that explains or models only teaches",
        ))
    )
      fail(`checkdef ${id}: changes more than base5's flow line`);
    // base6 (rootcause/base5-loss.txt): base4's England request with the recall clause cut from the
    // flow line (base5's cut) and, once prompt-engineer fills shared/opener.txt, one opener sentence
    // in that same line. One line out, one in; no schema path.
    if (a === "base6") {
      const cut = " a first slide that recalls the earlier learning this lesson builds on;";
      const anchor = "Plan these where they fit this topic and year group:";
      const out = sd.del[0] ?? "";
      const inn = sd.add[0] ?? "";
      const [pre, post] = out.replace(cut, "").split(anchor);
      if (
        jd.length ||
        sd.del.length !== 1 ||
        sd.add.length !== 1 ||
        !out.includes(cut) ||
        !inn.startsWith(pre ?? "\0") ||
        !inn.endsWith(`${anchor}${post}`)
      )
        fail(`base6 ${id}: changes more than base4's flow line (recall cut + opener slot)`);
    }
    if (a === "base4" && (jd.length || b.system !== r.system))
      fail(`base4 ${id}: its request differs from b3-r2 (base4 is b3-r2's files)`);
    if (a === "base3" && (jd.length || b.system !== r.system))
      fail(`base3 ${id}: its request differs from k1 (base3 is k1's files + code fixes)`);
    // D11: K1 changes only the flow's minItems and maxItems; the system text is byte for byte base2's.
    if (
      a === "k1" &&
      (b.system !== r.system ||
        jd.map((l) => l.split(":")[0]).join(",") !==
          "$.properties.flow.minItems,$.properties.flow.maxItems")
    )
      fail(`k1 ${id}: changes more than the flow bounds (${jd.join("; ")})`);
    if (spec.same) {
      // D4: the arm's delta on base2 is exactly its delta on base (same lines out and in, same schema paths).
      const [p0, p1] = spec.same;
      const x = reqs[p0]?.[id];
      const y = reqs[p1]?.[id];
      const d0 = x && y ? lineDiff(x.system, y.system) : undefined;
      const j0 = x && y ? jsonDiff(x.schema, y.schema) : [];
      if (
        !d0 ||
        JSON.stringify(d0) !== JSON.stringify(sd) ||
        JSON.stringify(j0) !== JSON.stringify(jd)
      )
        fail(`${a} ${id}: its delta on ${spec.ref} is not ${p1}'s delta on ${p0}`);
    }
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
    // PINS.json is shared by every lab worktree: pin only this worktree's built arms (plus the head
    // shared files they read and the pinned code) and keep every other entry (ab/pins-merge.ts).
    const pins: Record<string, string> = {};
    for (const a of AB_ARMS) {
      if (!have(a)) continue;
      for (const st of STAGES)
        for (const f of Object.values(abFiles(a, st)))
          pins[f.slice(AB.length + 1)] = sha(readFileSync(f));
      for (const f of SHARED_PINNED) {
        const path = `${AB}/prompts/${a}/${f}`;
        if (existsSync(path)) pins[path.slice(AB.length + 1)] = sha(readFileSync(path));
      }
      // Audit F8: the head shared files each arm reads (outside git), by hash or "absent".
      for (const { key, path } of sharedReads(a)) pins[key] = pinOf(path);
    }
    for (const f of CODE_PINNED) pins[`code:${f}`] = sha(readFileSync(`${REPO}/${f}`));
    const r = mergePins(`${AB}/PINS.json`, pins);
    ok(
      `pinned ${Object.keys(pins).length} files (${r.added} added, ${r.updated} updated; ${r.total} pins in all, other worktrees' kept) -> ${AB}/PINS.json`,
    );
  }
}
process.exit(bad ? 1 : 0);
