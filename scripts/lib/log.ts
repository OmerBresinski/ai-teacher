// Plain-language, low-noise console output shared by every root script.

// These scripts run outside turbo, so the vars need no turbo.json declaration.
const useColor =
  Boolean(process.stdout.isTTY) &&
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: colour toggle, not a task input
  process.env.NO_COLOR === undefined &&
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: colour toggle, not a task input
  process.env.TERM !== "dumb" &&
  process.env.CI === undefined;

function paint(code: string): (text: string) => string {
  return (text) => (useColor ? `\u001b[${code}m${text}\u001b[0m` : text);
}

export const colour = {
  bold: paint("1"),
  dim: paint("2"),
  red: paint("31"),
  green: paint("32"),
  yellow: paint("33"),
  blue: paint("34"),
  cyan: paint("36"),
};

export const log = {
  /** A top-level phase, e.g. "Checking prerequisites". */
  step(message: string): void {
    console.log(`\n${colour.bold(colour.blue("==>"))} ${colour.bold(message)}`);
  },
  info(message: string): void {
    console.log(`    ${message}`);
  },
  ok(message: string): void {
    console.log(`    ${colour.green("ok")}    ${message}`);
  },
  warn(message: string): void {
    console.log(`    ${colour.yellow("warn")}  ${message}`);
  },
  fail(message: string): void {
    console.error(`    ${colour.red("FAIL")}  ${message}`);
  },
  /** A bare error line (no indentation); used for fatal, user-facing messages. */
  error(message: string): void {
    console.error(message);
  },
  blank(): void {
    console.log("");
  },
};

export type CheckStatus = "PASS" | "WARN" | "FAIL" | "SKIP";

const statusPaint: Record<CheckStatus, (s: string) => string> = {
  PASS: colour.green,
  WARN: colour.yellow,
  FAIL: colour.red,
  SKIP: colour.dim,
};

/** One `doctor` result line: `PASS  Bun version  1.3.6 (>= 1.3.6)` plus an optional fix. */
export function printCheck(
  status: CheckStatus,
  name: string,
  detail?: string,
  fix?: string | string[],
): void {
  const tag = statusPaint[status](status.padEnd(4));
  const line = `${tag}  ${colour.bold(name)}${detail ? `  ${colour.dim("--")} ${detail}` : ""}`;
  if (status === "FAIL") console.error(line);
  else console.log(line);
  const fixes = fix === undefined ? [] : Array.isArray(fix) ? fix : [fix];
  for (const f of fixes) {
    const text = `      fix: ${f}`;
    if (status === "FAIL") console.error(text);
    else console.log(text);
  }
}
