#!/usr/bin/env bun
// railway run -- bun packages/generation/eval/np1-ff.ts --cap <overall usd> [--run-cap 0.04]
//   [--concurrency 4] [--glob np1] [--verify] [--force] [--dry-run]
//
// np1 root cause, facts held fixed: every saved np1 run with facts re-run through
// `lab.ts --from-facts <run>` (no objectives, select or facts call; the outline re-written in code;
// Generate, Illustrate, Evaluate, Repair as usual; images and judge off; Verify off unless
// `--verify`) into `eval/results/lab/<run>-ff/`.
//
// Spend guard, two levels: each run's own budget is `--run-cap` (lab.ts `--cap`: the Budget
// reserves every call's worst case and refuses what does not fit), and the batch reserves that
// cap from `--cap` before it starts a run (at most `--concurrency` in flight, `mapPool`). A run
// that cannot be reserved is skipped, not started; when it ends its reservation is released and
// its ledger's actual cost is booked. So the batch can never spend more than `--cap`.
// A run whose `-ff` result already executed is kept unless `--force` (resume after a stop).
// `--dry-run` makes no call: the runs, each one's expected cost (its saved ledger's generate,
// illustrate, evaluate and repair rows), the total, and the commands it would run.

import { existsSync } from "node:fs";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LAB_RESULTS, loadRunFacts } from "./from-facts";
import { DEFAULT_CONCURRENCY, mapPool } from "./pool";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};
const flag = (name: string) => process.argv.includes(`--${name}`);

/** The stages a `--from-facts` run pays for (plan-side stages are not re-run). */
export const FF_STAGES = ["generate", "illustrate", "evaluate", "repair"] as const;

type LedgerFile = {
  rows: { stage: string; usd: number }[];
  all?: { usd: number };
  lesson?: { usd: number };
};

/** A saved run's cost for the stages a from-facts rerun repeats (plus Verify when re-run). */
export function expectedCost(ledger: LedgerFile, verify = false): number {
  const stages = new Set<string>([...FF_STAGES, ...(verify ? ["verify"] : [])]);
  return ledger.rows.filter((r) => stages.has(r.stage)).reduce((t, r) => t + r.usd, 0);
}

/** A reservation ledger for the batch: start a run only if its cap still fits under the total. */
export function createReserver(capUsd: number) {
  let spent = 0;
  let reserved = 0;
  return {
    tryReserve(usd: number): boolean {
      if (spent + reserved + usd > capUsd + 1e-12) return false;
      reserved += usd;
      return true;
    },
    settle(reservedUsd: number, actualUsd: number) {
      reserved -= reservedUsd;
      spent += actualUsd;
    },
    totals: () => ({ spent, reserved, cap: capUsd }),
  };
}

async function main() {
  const glob = arg("glob") ?? "np1";
  const runCap = Number(arg("run-cap") ?? 0.04);
  const concurrency = Number(arg("concurrency") ?? Math.min(4, DEFAULT_CONCURRENCY));
  const verify = flag("verify");
  const dry = flag("dry-run");
  const capArg = arg("cap");
  if (!dry && capArg === undefined) {
    console.error("np1-ff: --cap <overall usd> is required for a live batch");
    process.exit(2);
  }
  const cap = Number(capArg ?? Number.POSITIVE_INFINITY);

  const dirs = (await readdir(LAB_RESULTS))
    .filter((d) => d.startsWith(glob) && !d.endsWith("-ff"))
    .sort();
  const runs: { run: string; expected: number; skip?: string }[] = [];
  for (const run of dirs) {
    try {
      await loadRunFacts(run);
    } catch {
      continue; // no result.json or no saved facts (np1-dry, the runs that stopped in Plan)
    }
    const ledger = JSON.parse(
      await readFile(join(LAB_RESULTS, run, "ledger.json"), "utf8"),
    ) as LedgerFile;
    const ffResult = join(LAB_RESULTS, `${run}-ff`, "result.json");
    const done =
      existsSync(ffResult) &&
      (JSON.parse(await readFile(ffResult, "utf8")) as { status?: { executed?: boolean } }).status
        ?.executed === true;
    runs.push({
      run,
      expected: expectedCost(ledger, verify),
      ...(done && !flag("force") ? { skip: "done (pass --force to rerun)" } : {}),
    });
  }
  const todo = runs.filter((r) => !r.skip);
  const total = todo.reduce((t, r) => t + r.expected, 0);
  const command = (run: string) => [
    "bun",
    join(import.meta.dir, "lab.ts"),
    "--from-facts",
    run,
    "--no-images",
    "--no-judge",
    "--cap",
    String(runCap),
    ...(verify ? ["--verify", "--model", "verify-facts=openai/gpt-5.6-luna"] : []),
  ];

  const L: string[] = [];
  L.push(
    `np1-ff: ${runs.length} runs with facts (${todo.length} to run), run cap $${runCap}, overall cap ${Number.isFinite(cap) ? `$${cap}` : "-"}, concurrency ${concurrency}, verify ${verify ? "on (Luna)" : "off"}`,
  );
  L.push(
    "| run | expected $ (saved generate+illustrate+evaluate+repair) | note |",
    "|---|---:|---|",
  );
  for (const r of runs) L.push(`| ${r.run} | ${r.expected.toFixed(4)} | ${r.skip ?? ""} |`);
  L.push(
    `expected total $${total.toFixed(4)} (mean $${(total / Math.max(1, todo.length)).toFixed(4)}/run); worst case bounded by min(cap, ${todo.length} × run cap = $${(todo.length * runCap).toFixed(2)})`,
  );
  if (Number.isFinite(cap) && cap < runCap)
    L.push(`WARNING: --cap $${cap} is below one run's cap $${runCap}: nothing would start`);
  console.log(L.join("\n"));
  if (dry) {
    console.log(`\ncommands (repo root, under railway run):`);
    for (const r of todo) console.log(command(r.run).join(" "));
    return;
  }

  const reserver = createReserver(cap);
  const outcomes = await mapPool(todo, concurrency, async ({ run, expected }) => {
    if (!reserver.tryReserve(runCap)) {
      return { run, expected, status: "skipped: overall cap", usd: 0 };
    }
    let usd = 0;
    let status = "failed";
    try {
      // A stale ledger from an earlier attempt must not be booked as this run's cost.
      await rm(join(LAB_RESULTS, `${run}-ff`, "ledger.json"), { force: true });
      const child = Bun.spawn(command(run), { stdout: "inherit", stderr: "inherit" });
      const code = await child.exited;
      const ledgerPath = join(LAB_RESULTS, `${run}-ff`, "ledger.json");
      if (existsSync(ledgerPath)) {
        const ledger = JSON.parse(await readFile(ledgerPath, "utf8")) as LedgerFile;
        usd = ledger.all?.usd ?? ledger.lesson?.usd ?? 0;
      } else {
        // No ledger written (crashed before the end): book the whole reservation, to be safe.
        usd = runCap;
      }
      status = code === 0 ? "executed" : `exit ${code}`;
    } finally {
      reserver.settle(runCap, usd);
    }
    const t = reserver.totals();
    console.error(`[np1-ff] ${run}: ${status}, $${usd.toFixed(4)}; spent $${t.spent.toFixed(4)}`);
    return { run, expected, status, usd };
  });
  const t = reserver.totals();
  const summary = { cap, runCap, verify, spent: t.spent, runs: outcomes };
  await writeFile(join(LAB_RESULTS, `${glob}-ff-batch.json`), JSON.stringify(summary, null, 2));
  console.log(
    [
      "",
      "| run | status | expected $ | actual $ |",
      "|---|---|---:|---:|",
      ...outcomes.map(
        (o) => `| ${o.run} | ${o.status} | ${o.expected.toFixed(4)} | ${o.usd.toFixed(4)} |`,
      ),
      `spent $${t.spent.toFixed(4)} of $${cap}; wrote ${join(LAB_RESULTS, `${glob}-ff-batch.json`)}`,
    ].join("\n"),
  );
}

if (import.meta.main) await main();
