/**
 * Spend: the ledger (a markdown table whose last column is the running total) and what this run
 * spent, priced from the services' own per-call log lines. The guard fails closed: a lesson's
 * worst case is reserved before it starts, and a lesson whose spend cannot be read keeps that
 * reservation and stops the run.
 */
import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs";

/** The running total on the ledger's latest row. */
export function ledgerTotal(path: string): number {
  const rows = readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.startsWith("| 20"));
  const last = rows.at(-1);
  if (!last) throw new Error(`no rows in ${path}`);
  const cells = last.split("|").map((c) => c.trim());
  const total = Number(cells.at(-2)?.replace(/^\$/, ""));
  if (!Number.isFinite(total)) throw new Error(`cannot read the running total from: ${last}`);
  return total;
}

export function ledgerRow(path: string, what: string, cost: number) {
  const total = ledgerTotal(path) + cost;
  const when = new Date().toISOString().slice(0, 16);
  appendFileSync(path, `| ${when} | ${what} | $${cost.toFixed(4)} | $${total.toFixed(4)} |\n`);
  return total;
}

export const logSize = (path: string) => (existsSync(path) ? statSync(path).size : 0);

export type LogSpend = { llm: number; images: number; unpriced: number };

/**
 * Model and picture spend in a byte range of a service log; an unpriced call counts $0.02.
 * Throws when the log is missing, or when the range has lines but none of them is JSON (a
 * pretty-printed or corrupt log would otherwise read as $0).
 */
export function spentInLog(path: string, from = 0, to = Number.POSITIVE_INFINITY): LogSpend {
  if (!existsSync(path)) throw new Error(`spend log ${path} is missing`);
  const out = { llm: 0, images: 0, unpriced: 0 };
  const lines = readFileSync(path, "utf8")
    .slice(from, to)
    .split("\n")
    .filter((l) => l.trim());
  let json = 0;
  for (const line of lines) {
    let j: { ai?: { costUsd?: unknown }; generated?: unknown; costUsd?: unknown };
    try {
      j = JSON.parse(line);
      json++;
    } catch {
      continue;
    }
    if (j.ai) {
      if (typeof j.ai.costUsd === "number") out.llm += j.ai.costUsd;
      else out.unpriced++;
    } else if (j.generated && typeof j.costUsd === "number") {
      out.images += j.costUsd;
    }
  }
  if (lines.length > 0 && json === 0) throw new Error(`spend log ${path} has no JSON lines`);
  out.llm += out.unpriced * 0.02;
  return out;
}

/**
 * The run's spend against STOP_USD. `reserve` books a lesson's worst case before it starts and
 * refuses when the ledger, everything spent or reserved so far, and that worst case pass the stop.
 * `settle` replaces the reservation with what the lesson actually cost; `settle(null)` (spend
 * unreadable) keeps the reservation, so the run is never under-counted.
 */
export class SpendGuard {
  spent = 0;
  private reserved = 0;
  constructor(
    private readonly ledger: () => number,
    private readonly stop: number,
    private readonly ceiling: number,
  ) {}
  reserve(): boolean {
    if (this.reserved > 0) throw new Error("a lesson is already reserved");
    if (this.ledger() + this.spent + this.ceiling > this.stop) return false;
    this.reserved = this.ceiling;
    return true;
  }
  settle(actual: number | null) {
    this.spent += actual ?? this.reserved;
    this.reserved = 0;
  }
  /** Spend not tied to a lesson (the api's own calls after the last lesson). */
  add(usd: number) {
    this.spent += usd;
  }
}
