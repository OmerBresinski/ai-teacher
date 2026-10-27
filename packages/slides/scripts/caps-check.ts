/*
 * Capacity drift check (text-limits M0, ADR 0040 §6). Re-runs every capacity generator against a
 * throwaway copy of `src/` and diffs what it produces against the committed JSON. Nothing in the
 * repo is written: each generator writes next to itself, so the copy takes the writes.
 *
 * Usage: bun packages/slides/scripts/caps-check.ts [--only <name>]
 * Exit 1 on drift that is not in KNOWN, and on a KNOWN entry that no longer holds (so the list
 * only ever shrinks).
 */
import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";

const PKG = join(import.meta.dir, "..");
const TEMPLATES = "src/templates";

/** Today's gaps, each with its reason. A gap that closes fails the check until it is removed here. */
export const KNOWN: Record<
  string,
  {
    kind: "drift" | "stdout-only" | "no-main";
    reason: string;
    /** For a drift: the exact value the generator writes today. Anything else fails. */
    generated?: unknown;
  }
> = {
  "figure-capacity.json": {
    kind: "drift",
    reason:
      "the generator writes 210/210/210 (its probe sentence's length): figure.ts ellipsises a long caption to one line (#563), so the one-line probe never fails. The committed 60/67/79 is what figure.ts reads. Fix in M1.",
    generated: { early: 210, primary: 210, secondary: 210 },
  },
  "hinge-capacity.json": {
    kind: "stdout-only",
    reason: "hinge-capacity.ts prints its table and writes nothing; compared from stdout.",
  },
  "source-capacity.json": {
    kind: "stdout-only",
    reason: "source-capacity.ts prints its table and writes nothing; compared from stdout.",
  },
  "worked-capacity.json": {
    kind: "no-main",
    reason: "worked-capacity.ts has no entry point; compared by calling measureWorkedCapacity().",
  },
};

type Gen = {
  /** The committed JSON it should reproduce (under src/templates). */
  target: string;
  /** Command args after `bun`, relative to the copy's package root. */
  args: string[];
  /** Where the result is read: a file the generator writes, or its stdout. */
  from: "file" | "stdout";
};

function generators(): Gen[] {
  const out: Gen[] = [];
  const dir = join(PKG, TEMPLATES);
  for (const f of readdirSync(dir)
    .filter((f) => f.endsWith("-capacity.ts"))
    .sort()) {
    const target = f.replace(/\.ts$/, ".json");
    const known = KNOWN[target]?.kind;
    if (f === "activity-capacity.ts") continue; // written by scripts/activity-capacity.ts
    if (known === "no-main") {
      const fn = f === "worked-capacity.ts" ? "measureWorkedCapacity" : "";
      out.push({
        target,
        from: "stdout",
        args: [
          "-e",
          `import { ${fn} } from "./${TEMPLATES}/${f}"; console.log(JSON.stringify(${fn}()));`,
        ],
      });
    } else
      out.push({
        target,
        from: known === "stdout-only" ? "stdout" : "file",
        args: [`${TEMPLATES}/${f}`],
      });
  }
  out.push({
    target: "activity-capacity.json",
    from: "file",
    args: ["scripts/activity-capacity.ts"],
  });
  return out;
}

function run(args: string[], cwd: string): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, args, { cwd, env: { ...process.env, NO_COLOR: "1" } });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => {
      out += d;
    });
    p.stderr.on("data", (d) => {
      err += d;
    });
    p.on("close", (code) => resolve({ code: code ?? 1, out, err }));
  });
}

/** The first difference between two JSON values, as a short path and both sides. */
function firstDiff(a: unknown, b: unknown, path = ""): string | undefined {
  if (JSON.stringify(a) === JSON.stringify(b)) return undefined;
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const d = firstDiff(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
        `${path}.${k}`,
      );
      if (d) return d;
    }
  }
  const s = (v: unknown) => (JSON.stringify(v) ?? "undefined").slice(0, 120);
  return `${path || "(root)"}: generated ${s(a)}, committed ${s(b)}`;
}

/**
 * The JSON table a generator printed. Progress lines may come before it, so the whole output is
 * tried first, then every line that opens an object or array, from the last one back, up to the end.
 */
function parseTrailingJson(text: string): unknown {
  const all = text.trim();
  try {
    return JSON.parse(all);
  } catch {}
  const starts = [...all.matchAll(/^[{[]/gm)].map((m) => m.index ?? 0).reverse();
  for (const at of starts) {
    try {
      return JSON.parse(all.slice(at));
    } catch {}
  }
  throw new Error("no JSON table on stdout");
}

/**
 * Tables a generator writes beside its own: split-compare's also writes side-by-side's, and
 * reasons' also writes the question-picture cells (TEACH-247 part ba).
 */
const ALSO_WRITES: Record<string, string[]> = {
  "split-compare-capacity.json": ["side-by-side-capacity.json"],
  "reasons-capacity.json": ["reasons-picture-capacity.json"],
};

async function main() {
  const only = process.argv.includes("--only")
    ? process.argv[process.argv.indexOf("--only") + 1]
    : undefined;
  const copy = join(mkdtempSync(join(tmpdir(), "caps-check-")), "slides");
  cpSync(join(PKG, "src"), join(copy, "src"), { recursive: true });
  cpSync(join(PKG, "scripts"), join(copy, "scripts"), { recursive: true });
  cpSync(join(PKG, "package.json"), join(copy, "package.json"));
  cpSync(join(PKG, "tsconfig.json"), join(copy, "tsconfig.json"));
  symlinkSync(join(PKG, "node_modules"), join(copy, "node_modules"));
  const gens = generators().filter((g) => !only || g.target.startsWith(only));
  // Some generators read other committed tables, so the copy keeps them intact. A table counts as
  // written when its nanosecond mtime or its bytes changed (mtime alone could tie on a coarse clock).
  const stamp = (t: string) => {
    const f = join(copy, TEMPLATES, t);
    return `${statSync(f, { bigint: true }).mtimeNs}:${readFileSync(f, "utf8")}`;
  };
  const targets = [
    ...gens.filter((g) => g.from === "file").map((g) => g.target),
    ...Object.values(ALSO_WRITES).flat(),
  ];
  const before = new Map(targets.map((t) => [t, stamp(t)]));
  const wrote = (t: string) => stamp(t) !== before.get(t);

  const t0 = performance.now();
  type Result = {
    target: string;
    ok: boolean;
    ran: boolean;
    got?: unknown;
    note: string;
    ms: number;
  };
  const results: Result[] = [];
  const queue = [...gens];
  const width = Math.max(2, Math.min(6, availableParallelism() - 1));
  await Promise.all(
    Array.from({ length: width }, async () => {
      for (let g = queue.shift(); g; g = queue.shift()) {
        const s = performance.now();
        const r = await run(g.args, copy);
        const ms = Math.round(performance.now() - s);
        const committed = JSON.parse(readFileSync(join(PKG, TEMPLATES, g.target), "utf8"));
        if (r.code !== 0) {
          results.push({
            target: g.target,
            ok: false,
            ran: false,
            ms,
            note: `exit ${r.code}: ${r.err.trim().split("\n").slice(-3).join(" | ")}`,
          });
          continue;
        }
        let got: unknown;
        try {
          if (g.from === "stdout") got = parseTrailingJson(r.out);
          else {
            if (!wrote(g.target)) throw new Error("the generator did not write its JSON");
            got = JSON.parse(readFileSync(join(copy, TEMPLATES, g.target), "utf8"));
          }
        } catch (e) {
          results.push({ target: g.target, ok: false, ran: false, ms, note: String(e) });
          continue;
        }
        const d = firstDiff(got, committed);
        results.push({ target: g.target, ok: !d, ran: true, got, ms, note: d ?? "matches" });
      }
    }),
  );

  // Every committed table must have a generator (one written beside another counts).
  const covered = new Set([...gens.map((g) => g.target), ...Object.values(ALSO_WRITES).flat()]);
  const orphans = only
    ? []
    : readdirSync(join(PKG, TEMPLATES)).filter(
        (f) => f.endsWith("-capacity.json") && !covered.has(f),
      );
  // A table written beside another is judged only when its writer's run succeeded.
  for (const [by, extra] of Object.entries(ALSO_WRITES)) {
    const w = results.find((r) => r.target === by);
    if (!w) continue;
    const gen = by.replace(/\.json$/, ".ts");
    for (const target of extra) {
      let r: Result;
      if (!w.ran)
        r = {
          target,
          ok: false,
          ran: false,
          ms: 0,
          note: `${gen} failed, so it was not regenerated`,
        };
      else if (!wrote(target))
        r = { target, ok: false, ran: false, ms: 0, note: `${gen} did not write it` };
      else {
        const got = JSON.parse(readFileSync(join(copy, TEMPLATES, target), "utf8"));
        const d = firstDiff(got, JSON.parse(readFileSync(join(PKG, TEMPLATES, target), "utf8")));
        r = { target, ok: !d, ran: true, got, ms: 0, note: d ?? `matches (written by ${gen})` };
      }
      results.push(r);
    }
  }

  let fail = 0;
  for (const r of results.sort((a, b) => a.target.localeCompare(b.target))) {
    const k = KNOWN[r.target];
    let status: string;
    if (k?.kind === "drift") {
      // Only the pinned drift passes: the generator must run and write exactly `generated`.
      const pinned = r.ran && !firstDiff(r.got, k.generated);
      if (r.ok) status = "FAIL (known drift is gone: remove it from KNOWN)";
      else if (pinned) status = "known drift";
      else status = "FAIL (drift changed from the pinned value)";
      if (!pinned) fail++;
    } else if (!r.ok) {
      status = "FAIL";
      fail++;
    } else status = k ? `ok, known ${k.kind}` : "ok";
    console.log(
      `${status.padEnd(22)} ${r.target.padEnd(32)} ${String(r.ms).padStart(6)} ms  ${r.note}`,
    );
    if (k) console.log(`${"".padEnd(22)} ${"".padEnd(32)} reason: ${k.reason}`);
  }
  for (const o of orphans) {
    console.log(`FAIL                   ${o.padEnd(32)} no generator writes or prints this table`);
    fail++;
  }
  for (const [t, k] of Object.entries(KNOWN))
    if (!only && !results.some((r) => r.target === t)) {
      console.log(
        `FAIL                   ${t.padEnd(32)} KNOWN lists it (${k.kind}) but no generator ran`,
      );
      fail++;
    }
  console.log(
    `\n${results.length} tables, ${fail} failing, ${Object.keys(KNOWN).length} known gaps, ${Math.round((performance.now() - t0) / 1000)} s`,
  );
  process.exit(fail ? 1 : 0);
}

if (import.meta.main) await main();
