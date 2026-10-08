// Round 6 ($0): stage 2 replay by request class, with the round 6 metric fix, for b4-r1t2 and b4-r1t3.
// Oracle (base4 full runs b3-r2-1/2): per brief and class (compound = several subjects in one slot; one-subject,
// columns and sequences included), the share of writer photo requests that shipped a picture covering its
// must_see, under the old metric (visible + alt) and the fixed one (seenOf: + a judged pick's request, fluffy=fluff).
// Replay on b4-r1t-wo1/wo2: a one-subject tile is shown at the brief's one-subject rate; a compound request at the
// compound rate (b4-r1t2) or, split by the director into one fetch per subject (b4-r1t3), at one-subject^k.
// bun lab/bakeoff/ab/stage2sim3.ts
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { AB } from "./arms";
import { applyStage2, covers, picturesOf, seenOf } from "./stage2";

type J = Record<string, unknown>;
const STRONG = new RegExp(
  readFileSync(`${AB}/metrics.py`, "utf8").match(
    /^STRONG = re\.compile\(r"(.*)", re\.I\)$/m,
  )?.[1] ?? "point (to|at)",
  "i",
);
const compound = (p: J) =>
  ((p.must_see as string[]) ?? []).length >= 4 ||
  /separate (photo|picture)|photographs|arranged|arrangement|two-by-two|grid|rows? of/i.test(
    String(p.shows ?? ""),
  );
const legacyForms = (w: string) => {
  const x = w.toLowerCase();
  const f = new Set([x]);
  if (x.endsWith("ies") && x.length > 4) f.add(`${x.slice(0, -3)}y`);
  if (x.endsWith("es") && x.length > 4) f.add(x.slice(0, -2));
  if (x.endsWith("s") && x.length > 3) f.add(x.slice(0, -1));
  return f;
};
const W = (s: string) => (s.match(/[A-Za-z]+/g) ?? []).filter((w) => w.length > 2);
const legacyCovers = (ms: string[], seen: string[]) => {
  const bag = new Set(seen.flatMap(W).flatMap((w) => [...legacyForms(w)]));
  return ms.every((m) => W(m).some((w) => [...legacyForms(w)].some((f) => bag.has(f))));
};
type Cls = { n: number; placed: number; old: number; fixed: number };
const oracle: Record<string, { one: Cls; comp: Cls }> = {};
const z = (): Cls => ({ n: 0, placed: 0, old: 0, fixed: 0 });
for (const t of ["b3-r2-1", "b3-r2-2"])
  for (const b of readdirSync(`${AB}/runs/${t}/T`)) {
    const d = `${AB}/runs/${t}/T/${b}`;
    const w = JSON.parse(JSON.parse(readFileSync(`${d}/main.json`, "utf8")).text);
    const L = JSON.parse(readFileSync(`${d}/lesson.json`, "utf8"));
    if (!oracle[b]) oracle[b] = { one: z(), comp: z() };
    const o = oracle[b];
    for (const [i, s] of ([w.title, ...w.slides] as J[]).entries()) {
      const id = `s${i === 0 ? 1 : i + 2}`;
      const els = ((L.slides as J[]).find((x) => x.id === id)?.elements ?? []) as J[];
      const pics = [
        ...picturesOf(s),
        ...((s.columns as J[]) ?? []).map((c) => c.picture as J).filter(Boolean),
        ...((s.sequence as J[]) ?? []),
      ].filter((p) => p && typeof p === "object" && !("kind" in p) && p.shows);
      for (const p of pics) {
        const c = compound(p) ? o.comp : o.one;
        const ms = (p.must_see as string[]) ?? [];
        const el = els.find(
          (e) =>
            e.type === "image" &&
            !String(e.src ?? "").startsWith("data:") &&
            String(e.request ?? "").startsWith(String(p.shows).slice(0, 30)),
        );
        c.n++;
        if (!el) continue;
        c.placed++;
        const ev = (((el.source as J)?.evidence as J)?.visible as string[]) ?? [];
        if (legacyCovers(ms, [...ev, String(el.alt ?? "")])) c.old++;
        if (covers(ms, seenOf(el as never))) c.fixed++;
      }
    }
  }
const pool = (k: "one" | "comp") =>
  Object.values(oracle).reduce((a, o) => ({ n: a.n + o[k].n, fixed: a.fixed + o[k].fixed }), {
    n: 0,
    fixed: 0,
  });
const rate = (b: string, k: "one" | "comp") => {
  const c = oracle[b]?.[k];
  const p = pool(k);
  return c && c.n >= 3 ? c.fixed / c.n : p.fixed / Math.max(1, p.n);
};
let seed = 20261008;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const DRAWS = 2000;
type Tot = { removed: number; dangling: number; unchecked: number; shown: number; asked: number };
const res: Record<string, Record<string, Tot>> = {};
for (const arm of ["b4-r1t2", "b4-r1t3"])
  for (const t of ["b4-r1t-wo1", "b4-r1t-wo2"])
    for (const b of readdirSync(`${AB}/runs/${t}/T`)) {
      const d = `${AB}/runs/${t}/T/${b}`;
      const w = JSON.parse(JSON.parse(readFileSync(`${d}/main.json`, "utf8")).text);
      const nobj = JSON.parse(readFileSync(`${AB}/../round5/runs/T/${b}/objectives.json`, "utf8"))
        .objectives.length;
      const all = [w.title, ...w.slides] as J[];
      const p1 = rate(b, "one");
      const pc = rate(b, "comp");
      const prob = (p: J | undefined) => {
        if (!p) return 0;
        if ("kind" in p) return 0.89;
        if (!compound(p)) return p1;
        return arm === "b4-r1t3"
          ? p1 ** Math.min(4, Math.max(2, ((p.must_see as string[]) ?? []).length))
          : pc;
      };
      const tot: Tot = { removed: 0, dangling: 0, unchecked: 0, shown: 0, asked: 0 };
      for (let k = 0; k < DRAWS; k++) {
        const cache = new Map<string, boolean>();
        const shown = (num: number, kk: number) => {
          const key = `${num}:${kk}`;
          if (!cache.has(key))
            cache.set(key, rnd() < prob(picturesOf(all[num === 1 ? 0 : num - 2] as J)[kk]));
          return cache.get(key) as boolean;
        };
        for (const [i, s] of all.entries())
          for (const [kk, p] of picturesOf(s).entries())
            if (!("kind" in p)) {
              tot.asked++;
              if (shown(i === 0 ? 1 : i + 2, kk)) tot.shown++;
            }
        const r = applyStage2({ title: w.title, slides: w.slides, flow: w.flow }, shown, nobj);
        tot.removed += r.removed.length;
        tot.unchecked += r.unchecked.length;
        for (const [i, s] of [r.title, ...r.slides].entries()) {
          const num = i === 0 ? 1 : i + 2;
          if (r.removed.includes(num)) continue;
          const items = [s.lead, s.instruction, ...((s.questions as unknown[]) ?? [])].map((x) =>
            x && typeof x === "object" ? String((x as J).text) : String(x ?? ""),
          );
          const pics = picturesOf(s);
          if (
            items.some((x) => STRONG.test(x)) &&
            !(pics.length && pics.every((_, kk) => shown(num, kk)))
          )
            tot.dangling++;
        }
      }
      if (!res[arm]) res[arm] = {};
      const key = b.startsWith("y1-") ? "y1" : "other";
      if (!res[arm][key])
        res[arm][key] = { removed: 0, dangling: 0, unchecked: 0, shown: 0, asked: 0 };
      const acc = res[arm][key] as Tot;
      for (const f of Object.keys(tot) as (keyof Tot)[]) acc[f] += tot[f] / DRAWS;
    }
const fmt = (x: Tot) =>
  `${x.removed.toFixed(2)} | ${x.dangling.toFixed(2)} | ${x.unchecked.toFixed(2)} | ${x.shown.toFixed(1)} / ${x.asked.toFixed(0)}`;
const md = [
  "### Oracle: base4 photo requests covered, old metric -> fixed metric (placed / requests)",
  "| brief | one-subject n | placed | old | fixed | compound n | placed | old | fixed |",
  "|---|---|---|---|---|---|---|---|---|",
  ...Object.entries(oracle).map(
    ([b, o]) =>
      `| ${b} | ${o.one.n} | ${o.one.placed} | ${o.one.old} | ${o.one.fixed} | ${o.comp.n} | ${o.comp.placed} | ${o.comp.old} | ${o.comp.fixed} |`,
  ),
  "",
  `### Replay on b4-r1t-wo1/wo2 (2 lessons per brief, expected totals over ${DRAWS} draws)`,
  "| arm | scope | check slides removed | dangling slides | objectives lost | pictures delivered |",
  "|---|---|---|---|---|---|",
  ...Object.entries(res).flatMap(([a, r]) => {
    const both = Object.values(r).reduce(
      (s, x) => ({
        removed: s.removed + x.removed,
        dangling: s.dangling + x.dangling,
        unchecked: s.unchecked + x.unchecked,
        shown: s.shown + x.shown,
        asked: s.asked + x.asked,
      }),
      { removed: 0, dangling: 0, unchecked: 0, shown: 0, asked: 0 },
    );
    return [`| ${a} | y1 | ${fmt(r.y1 as Tot)} |`, `| ${a} | all 12 | ${fmt(both)} |`];
  }),
];
writeFileSync(`${AB}/stage2sim3.md`, `${md.join("\n")}\n`);
console.log(md.join("\n"));
