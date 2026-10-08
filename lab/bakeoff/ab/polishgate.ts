// polish arm ($0): set the photo gate's thresholds on base4's accepted pictures and list what it
// would refuse. bun lab/bakeoff/ab/polishgate.ts [--write]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { STORE } from "../services";
import { AB } from "./arms";
import { decode, pixelStats } from "./polish";

const RUNS = `${AB}/runs`;
type Row = {
  run: string;
  lesson: string;
  key: string;
  id: string;
  provider: string;
  rms: number;
  haze: number;
  colour: number;
};
const rows: Row[] = [];
for (const f of [...new Bun.Glob("{b3-r2-1,b3-r2-2,nz-uk}/T/*/log.jsonl").scanSync(RUNS)].sort()) {
  const [run, , lesson] = f.split("/");
  for (const l of readFileSync(`${RUNS}/${f}`, "utf8").split("\n")) {
    if (!l.includes('"picture-done"')) continue;
    const e = JSON.parse(l);
    // The gate runs on stock candidates only: generated pictures (white grounds) are not judged by it.
    if (!e.ok || !e.src || e.style === "drawn" || !["pexels", "commons"].includes(e.provider))
      continue;
    const path = `${STORE}/${String(e.src).replace(/^\/files\//, "")}`;
    if (!existsSync(path)) continue;
    const px = decode(new Uint8Array(readFileSync(path)));
    if (!px) continue;
    rows.push({
      run: run as string,
      lesson: lesson as string,
      key: e.key,
      id: String(e.id),
      provider: e.provider,
      ...pixelStats(px),
    });
  }
}
/** The linear-interpolated quantile (the usual definition). */
const q = (v: number[], p: number) => {
  const s = [...v].sort((a, b) => a - b);
  const at = p * (s.length - 1);
  const lo = Math.floor(at);
  const hi = Math.min(s.length - 1, lo + 1);
  return (s[lo] as number) + ((s[hi] as number) - (s[lo] as number)) * (at - lo);
};
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const gate = {
  colourMin: r3(
    q(
      rows.map((r) => r.colour),
      0.05,
    ),
  ),
  rmsMin: r3(
    q(
      rows.map((r) => r.rms),
      0.05,
    ),
  ),
  hazeMax: r3(
    q(
      rows.map((r) => r.haze),
      0.95,
    ),
  ),
  // Only colourfulness refuses: RMS contrast and dark-channel haze did not separate the two faulty
  // picks (uk-seasons slides 8 and 12 sit mid-pack on both); they are logged as advice.
  active: ["colour"],
  n: rows.length,
  set: "base4 accepted stock pictures (b3-r2-1, b3-r2-2, nz-uk); 5th pct colour and rms, 95th pct haze",
};
if (process.argv.includes("--write"))
  writeFileSync(`${import.meta.dir}/polish-gate.json`, `${JSON.stringify(gate, null, 1)}\n`);
const refused = rows.filter((r) => r.colour < gate.colourMin);
const advisory = rows.filter((r) => r.rms < gate.rmsMin || r.haze > gate.hazeMax);
console.log(
  `refused ${refused.length}/${rows.length}; advisory (rms or haze) ${advisory.length}: ${advisory.map((r) => `${r.lesson} ${r.key}`).join(", ")}`,
);
console.log(JSON.stringify(gate));
for (const r of refused)
  console.log(
    `REFUSED ${r.run} ${r.lesson} ${r.key} ${r.provider} ${r.id} colour=${r.colour.toFixed(3)}`,
  );
const rank = (k: "rms" | "haze" | "colour", r: Row) => rows.filter((x) => x[k] < r[k]).length;
for (const r of [...rows].sort((a, b) => a.colour - b.colour))
  console.log(
    `  ${r.lesson.slice(0, 22)} ${r.key} ${r.id} rms=${r.rms.toFixed(3)}(${rank("rms", r)}) haze=${r.haze.toFixed(3)}(${rank("haze", r)}) colour=${r.colour.toFixed(3)}(${rank("colour", r)})`,
  );
