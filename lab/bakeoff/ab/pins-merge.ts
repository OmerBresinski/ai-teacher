// PINS.json is one file outside git that every lab worktree pins into. `check.ts --pin` once
// rewrote it from the pinning worktree's view of AB_ARMS, dropping the pins of arms that only other
// worktrees define, so their paid runs refused at start (8 Oct: tilesgen twice, SPEND.md 17:10 and
// 17:12). mergePins adds or updates only the keys the caller computed and keeps every other entry
// byte-identical (key order kept, new keys appended). Writers serialise on an flock'd sidecar,
// PINS.json.lock (released when its fd closes or the process dies, so a crash leaves no stale lock),
// and compare the file's hash just before an atomic temp-plus-rename, so a writer that skips the
// lock (an older check.ts) is caught and the merge is redone on its result.
import { dlopen, FFIType } from "bun:ffi";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
} from "node:fs";

const LOCK_EX = 2;
const LIBC = process.platform === "darwin" ? "/usr/lib/libSystem.B.dylib" : "libc.so.6";

/** sha256 of the file's bytes, or "absent". */
export const fileHash = (path: string) =>
  existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : "absent";

export type MergeResult = { added: number; updated: number; kept: number; total: number };

/**
 * Merge `own` into the pins file at `file`. `beforeRename` is a test seam (it runs after the temp
 * file is written and before the hash compare), used to simulate a writer that ignores the lock.
 */
export function mergePins(
  file: string,
  own: Record<string, string>,
  opts: { beforeRename?: () => void; attempts?: number } = {},
): MergeResult {
  const libc = dlopen(LIBC, { flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 } });
  const lockFd = openSync(`${file}.lock`, "a");
  try {
    if (libc.symbols.flock(lockFd, LOCK_EX) !== 0) throw new Error(`could not lock ${file}.lock`);
    const tmp = `${file}.tmp-${process.pid}`;
    for (let i = 0; i < (opts.attempts ?? 5); i++) {
      const before = fileHash(file);
      const cur =
        before === "absent"
          ? {}
          : (JSON.parse(readFileSync(file, "utf8")) as Record<string, string>);
      const next: Record<string, string> = { ...cur };
      let added = 0;
      let updated = 0;
      for (const [k, v] of Object.entries(own)) {
        if (!(k in cur)) added++;
        else if (cur[k] !== v) updated++;
        next[k] = v;
      }
      const fd = openSync(tmp, "w");
      try {
        writeSync(fd, JSON.stringify(next, null, 1));
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      opts.beforeRename?.();
      if (fileHash(file) !== before) continue; // someone wrote without the lock: merge again
      renameSync(tmp, file);
      const total = Object.keys(next).length;
      return { added, updated, kept: total - added - updated, total };
    }
    throw new Error(`${file} kept changing under the pin; nothing written (rerun --pin)`);
  } finally {
    closeSync(lockFd); // releases the flock
    libc.close();
  }
}
