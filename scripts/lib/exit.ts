import { log } from "./log";

/** Process exit codes used by the root scripts. */
export const ExitCode = {
  Ok: 0,
  /** A check failed or a prerequisite is missing; the message says what to do. */
  Failure: 1,
  /** Bad command-line usage. */
  Usage: 2,
  /** Interrupted by SIGINT (128 + 2). */
  Interrupted: 130,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

/**
 * An error whose message is meant for the developer as-is. `runMain` prints it as a plain
 * sentence (no stack trace) and exits with `exitCode`.
 */
export class UserFacingError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode: number = ExitCode.Failure) {
    super(message);
    this.name = "UserFacingError";
    this.exitCode = exitCode;
  }
}

/** Shape of Bun's `ShellError` (thrown by `Bun.$` when a command exits non-zero). */
interface ShellErrorLike {
  exitCode: number;
  stderr: Uint8Array;
  stdout: Uint8Array;
  message: string;
}

function isShellError(err: unknown): err is ShellErrorLike {
  return (
    typeof err === "object" &&
    err !== null &&
    "exitCode" in err &&
    "stderr" in err &&
    typeof (err as ShellErrorLike).exitCode === "number"
  );
}

/**
 * Runs a script's `main` (a returned number becomes the exit code, anything else is 0), mapping
 * errors to readable output:
 * - `UserFacingError` -> its message, its exit code, no stack trace;
 * - a failed `Bun.$` command -> the command's stderr and its exit code;
 * - anything else -> "Unexpected error" with the stack (that is a bug in the script).
 */
export async function runMain(main: () => Promise<unknown>): Promise<never> {
  try {
    const code = await main();
    process.exit(typeof code === "number" ? code : ExitCode.Ok);
  } catch (err) {
    if (err instanceof UserFacingError) {
      log.error(err.message);
      process.exit(err.exitCode);
    }
    if (isShellError(err)) {
      const stderr = new TextDecoder().decode(err.stderr).trim();
      log.error(`Command failed (exit ${err.exitCode}).${stderr ? `\n${stderr}` : ""}`);
      process.exit(err.exitCode === 0 ? ExitCode.Failure : err.exitCode);
    }
    console.error("Unexpected error:", err);
    process.exit(ExitCode.Failure);
  }
}
