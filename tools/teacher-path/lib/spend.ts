/**
 * Spend: the ledger (a markdown table whose last column is the running total) and what this run
 * spent, priced from the services' own per-call log lines.
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

/** Model and picture spend in a byte range of a service log; an unpriced call counts $0.02. */
export function spentInLog(path: string, from = 0, to = Number.POSITIVE_INFINITY) {
  const out = { llm: 0, images: 0, unpriced: 0 };
  if (!existsSync(path)) return out;
  const text = readFileSync(path, "utf8").slice(from, to);
  for (const line of text.split("\n")) {
    if (!line.includes("costUsd")) continue;
    try {
      const j = JSON.parse(line);
      if (j.ai) {
        if (typeof j.ai.costUsd === "number") out.llm += j.ai.costUsd;
        else out.unpriced++;
      } else if (j.generated && typeof j.costUsd === "number") {
        out.images += j.costUsd;
      }
    } catch {}
  }
  out.llm += out.unpriced * 0.02;
  return out;
}
