// Round 6 ($0): R1 stage 2 simulated on b4-r1t's writer outputs, with base4's observed picture delivery as the oracle.
// Oracle: in base4's full runs (b3-r2-1, b3-r2-2), the share of photo requests per brief that shipped a photo whose
// judge-visible + alt covers every must_see (the pooled share when a brief has fewer than 3 requests). Each b4-r1t picture is shown with that
// probability (diagrams: base4's drawn share, 0.89); 2000 seeded draws per lesson.
// bun lab/bakeoff/ab/stage2sim.ts
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { AB } from "./arms";
import { applyStage2, covers, picturesOf } from "./stage2";

type J = Record<string, unknown>;
const STRONG = new RegExp(
  readFileSync(`${AB}/metrics.py`, "utf8").match(
    /^STRONG = re\.compile\(r"(.*)", re\.I\)$/m,
  )?.[1] ?? "point (to|at)",
  "i",
);
// 1. The oracle.
const oracle: Record<string, { n: number; ok: number }> = {};
for (const t of ["b3-r2-1", "b3-r2-2"])
  for (const b of readdirSync(`${AB}/runs/${t}/T`)) {
    const d = `${AB}/runs/${t}/T/${b}`;
    const w = JSON.parse(JSON.parse(readFileSync(`${d}/main.json`, "utf8")).text);
    const L = JSON.parse(readFileSync(`${d}/lesson.json`, "utf8"));
    if (!oracle[b]) oracle[b] = { n: 0, ok: 0 };
    const o = oracle[b];
    for (const [i, s] of [w.title, ...w.slides].entries()) {
      const idx = i === 0 ? 0 : i + 1;
      for (const p of picturesOf(s as J)) {
        if ("kind" in p) continue;
        const ms = (p.must_see as string[]) ?? [];
        o.n++;
        const els = (L.slides[idx]?.elements ?? []) as J[];
        const ok = els.some((e) => {
          if (e.type !== "image" || String(e.src ?? "").startsWith("data:image/svg")) return false;
          const ev = ((e.source as J)?.evidence as J)?.visible as string[] | undefined;
          return covers(ms, [...(ev ?? []), String(e.alt ?? "")]);
        });
        o.ok += ok ? 1 : 0;
      }
    }
  }
// 2. The simulation.
let seed = 20261008;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const rows: string[] = [];
const tot = { lessons: 0, removed: 0, dropped: 0, unchecked: 0, dangling: 0, writerFault: 0 };
const DRAWS = 2000;
for (const t of ["b4-r1t-wo1", "b4-r1t-wo2"])
  for (const b of readdirSync(`${AB}/runs/${t}/T`)) {
    const d = `${AB}/runs/${t}/T/${b}`;
    const w = JSON.parse(JSON.parse(readFileSync(`${d}/main.json`, "utf8")).text);
    const nobj = JSON.parse(readFileSync(`${AB}/../round5/runs/T/${b}/objectives.json`, "utf8"))
      .objectives.length;
    const pooled = Object.values(oracle).reduce((a, o) => [a[0] + o.ok, a[1] + o.n], [0, 0]);
    const fixedP = process.argv.includes("--p")
      ? Number(process.argv[process.argv.indexOf("--p") + 1])
      : undefined;
    const p =
      fixedP !== undefined
        ? fixedP
        : oracle[b] && oracle[b].n >= 3
          ? oracle[b].ok / oracle[b].n
          : pooled[0] / Math.max(1, pooled[1]);
    let rem = 0,
      drop = 0,
      unc = 0,
      dang = 0;
    const all = () => [w.title, ...w.slides] as J[];
    for (let k = 0; k < DRAWS; k++) {
      const cache = new Map<string, boolean>();
      const shown = (num: number, kk: number) => {
        const key = `${num}:${kk}`;
        if (!cache.has(key)) {
          const s = all()[num === 1 ? 0 : num - 2] as J;
          const pic = picturesOf(s)[kk] as J | undefined;
          cache.set(key, rnd() < (pic && "kind" in pic ? 0.89 : p));
        }
        return cache.get(key) as boolean;
      };
      const r = applyStage2({ title: w.title, slides: w.slides, flow: w.flow }, shown, nobj);
      rem += r.removed.length;
      drop += r.dropped.length;
      unc += r.unchecked.length;
      // Dangling left: a kept slide (not removed) with a pointing item and a picture not shown.
      const kept = [r.title, ...r.slides];
      for (const [i, s] of kept.entries()) {
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
          dang++;
      }
    }
    const always = applyStage2(
      { title: w.title, slides: w.slides, flow: w.flow },
      () => true,
      nobj,
    );
    tot.lessons++;
    tot.removed += rem / DRAWS;
    tot.dropped += drop / DRAWS;
    tot.unchecked += unc / DRAWS;
    tot.dangling += dang / DRAWS;
    tot.writerFault += always.dropped.length;
    rows.push(
      `| ${t} | ${b} | ${p.toFixed(2)} | ${(drop / DRAWS).toFixed(2)} | ${(rem / DRAWS).toFixed(2)} | ${(unc / DRAWS).toFixed(2)} | ${(dang / DRAWS).toFixed(2)} | ${always.dropped.map((x) => `s${x.slide} "${x.text}"`).join("; ") || "-"} |`,
    );
  }
const md = [
  "| run | brief | oracle p (base4 photo requests shown and covered) | items dropped | check/discussion slides removed | objectives left unchecked | dangling slides left | dropped even with every picture shown (writer fault) |",
  "|---|---|---|---|---|---|---|---|",
  ...rows,
  "",
  `Totals over ${tot.lessons} lessons (expected values, ${DRAWS} draws each): items dropped ${tot.dropped.toFixed(1)}, slides removed ${tot.removed.toFixed(2)}, objectives left unchecked ${tot.unchecked.toFixed(2)} (these go to the objective repair), dangling slides left ${tot.dangling.toFixed(2)}, writer-fault drops ${tot.writerFault}.`,
  "",
  `Oracle per brief: ${Object.entries(oracle)
    .map(([b, o]) => `${b} ${o.ok}/${o.n}`)
    .join("; ")}`,
];
writeFileSync(
  `${AB}/stage2sim${process.argv.includes("--p") ? `-p${process.argv[process.argv.indexOf("--p") + 1]}` : ""}.md`,
  `${md.join("\n")}\n`,
);
console.log(md.join("\n"));
