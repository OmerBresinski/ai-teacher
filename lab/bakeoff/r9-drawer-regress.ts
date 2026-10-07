// Round 9 drawer regression set (regression audit Q6: round 8 checked the drawer on 5 known failures
// and never on the diagrams that drew). Every diagram request the writer made in rounds 6-8
// (round<N>/runs/T/*/main.json, else stream.txt), redrawn through today's drawer into its real slot.
//
//   bun lab/bakeoff/r9-drawer-regress.ts build <set.json>          $0: collect the requests
//   bun lab/bakeoff/r9-drawer-regress.ts run <set.json> <out.json> --yes [--cap 0.02]
//                                                                  PAID (~$0.0001 a call, ~$0.01 a set)
// `run` sends each request through diagramSpec (strict schema capped to the slot, one retry with the
// fault), then checks the spec draws in its slot on the lesson's theme (services.ts slotFault).
// It reports drew / failed per kind and per round, and every failure with its fault.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { diagramContext } from "./harness";
import { type DiagramAsk, diagramSpec, Ledger, slotFault } from "./services";

const B =
  "/Users/gregwallace/Documents/experiments/ai-teacher/scratchpad/quality-prd/lab/rounds/BAKEOFF";
type S = Record<string, unknown>;
export type Case = {
  id: string;
  round: string;
  lesson: string;
  slide: number;
  theme: string;
  ask: DiagramAsk;
};

const str = (v: unknown) => (typeof v === "string" ? v : "");
/** The slide's words as the drawer sees them (heading, then the slide's text lines). */
function wordsOf(s: S): string {
  const out: string[] = [];
  for (const k of ["lead", "instruction", "stem", "formula"]) if (str(s[k])) out.push(str(s[k]));
  for (const k of ["points", "questions", "options"])
    for (const x of (s[k] as unknown[]) ?? [])
      out.push(typeof x === "string" ? x : str((x as S)?.text));
  return `${str(s.heading)}\n${out.join("\n")}`;
}
function writerOf(dir: string): S | undefined {
  for (const f of ["main.json", "stream.txt"]) {
    try {
      const raw = readFileSync(`${dir}/${f}`, "utf8");
      return (f === "main.json" ? JSON.parse(JSON.parse(raw).text) : JSON.parse(raw)) as S;
    } catch {}
  }
  return undefined;
}
const KS: Record<string, string> = {
  "1": "ks1",
  "2": "ks1",
  "3": "ks2",
  "4": "ks2",
  "5": "ks2",
  "6": "ks2",
  "7": "ks3",
  "8": "ks3",
  "9": "ks3",
  "10": "ks4",
  "11": "ks4",
  "12": "ks5",
  "13": "ks5",
};

export function collect(rounds = ["round6", "round7", "round8"]): Case[] {
  const cases: Case[] = [];
  for (const round of rounds) {
    const root = `${B}/${round}/runs/T`;
    if (!existsSync(root)) continue;
    for (const lesson of readdirSync(root).sort()) {
      const w = writerOf(`${root}/${lesson}`);
      if (!w) continue;
      let theme = "studio";
      try {
        theme = JSON.parse(readFileSync(`${root}/${lesson}/lesson.json`, "utf8")).themeId ?? theme;
      } catch {}
      const year = /^y(\d+)/.exec(lesson)?.[1] ?? "9";
      const stage = KS[year] ?? "ks3";
      ((w.slides as S[]) ?? []).forEach((s, i) => {
        const f = (s?.figure ?? s?.diagram) as S | undefined;
        if (!f || typeof f.kind !== "string") return;
        const ctx = diagramContext(s, stage);
        cases.push({
          id: `${round}/${lesson}/s${i + 3}`,
          round,
          lesson,
          slide: i + 3,
          theme,
          ask: {
            key: `${i + 2}:figure`,
            kind: f.kind,
            shows: str(f.shows),
            labels: ((f.labels as unknown[]) ?? []).map(String),
            words: wordsOf(s),
            yearGroup: `Year ${year}`,
            ...ctx,
            stage,
            theme,
          },
        });
      });
    }
  }
  return cases;
}

async function run(setFile: string, outFile: string, cap: number) {
  const cases = JSON.parse(readFileSync(setFile, "utf8")) as Case[];
  const ledger = new Ledger(cap);
  const rows: { id: string; kind: string; slot: string; ok: boolean; fault?: string }[] = [];
  const quiet = () => {};
  // Eight at a time: the set is ~100 calls of ~2 s.
  for (let k = 0; k < cases.length; k += 8)
    await Promise.all(
      cases.slice(k, k + 8).map(async (c) => {
        if (ledger.total >= cap)
          return rows.push({
            id: c.id,
            kind: c.ask.kind,
            slot: c.ask.slot?.name ?? "side",
            ok: false,
            fault: "cap reached",
          });
        const spec = await diagramSpec(c.ask, ledger, quiet).catch(() => undefined);
        const fault = spec ? slotFault(spec, c.ask) : "no spec after the retry";
        rows.push({
          id: c.id,
          kind: c.ask.kind,
          slot: c.ask.slot?.name ?? "side",
          ok: !fault,
          ...(fault ? { fault } : {}),
        });
      }),
    );
  const by = (key: (r: (typeof rows)[number]) => string) => {
    const m: Record<string, { drew: number; of: number }> = {};
    for (const r of rows) {
      const k = key(r);
      m[k] ??= { drew: 0, of: 0 };
      const x = m[k];
      x.of++;
      if (r.ok) x.drew++;
    }
    return m;
  };
  const report = {
    usd: Math.round(ledger.total * 10000) / 10000,
    drew: rows.filter((r) => r.ok).length,
    of: rows.length,
    byKind: by((r) => r.kind),
    byRound: by((r) => r.id.split("/")[0] ?? ""),
    failures: rows.filter((r) => !r.ok),
  };
  writeFileSync(outFile, `${JSON.stringify(report, null, 1)}\n`);
  console.log(`drew ${report.drew}/${report.of}, $${report.usd}; wrote ${outFile}`);
}

if (import.meta.main) {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === "build" && a) {
    const cases = collect();
    writeFileSync(a, `${JSON.stringify(cases, null, 1)}\n`);
    const kinds: Record<string, number> = {};
    for (const c of cases) kinds[c.ask.kind] = (kinds[c.ask.kind] ?? 0) + 1;
    console.log(`${cases.length} requests`, kinds);
  } else if (cmd === "run" && a && b && process.argv.includes("--yes")) {
    const i = process.argv.indexOf("--cap");
    await run(a, b, i > 0 ? Number(process.argv[i + 1]) : 0.02);
  } else {
    console.log("build <set.json> | run <set.json> <out.json> --yes [--cap usd]   (run is paid)");
    process.exit(2);
  }
}
