// Audit F6 (8 Oct): a lesson dir is a finished lesson only when its log.jsonl holds a summary event.
// The harness writes lesson.json early (a 1-slide stub before the writer returns), so a crashed or
// refused lesson has a lesson.json too. run.ts skips only finished lessons and moves an unfinished
// one to <runs>/crashed/ (run.sh's convention), so <runs>/<arm> holds finished lessons only.
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { basename, dirname } from "node:path";

/** Whether `dir`'s log.jsonl has an `ev: "summary"` line. */
export function lessonDone(dir: string): boolean {
  const f = `${dir}/log.jsonl`;
  if (!existsSync(f)) return false;
  for (const l of readFileSync(f, "utf8").split("\n")) {
    if (!l.includes('"summary"')) continue;
    try {
      if (JSON.parse(l)?.ev === "summary") return true;
    } catch {}
  }
  return false;
}

/** Moves an unfinished lesson dir to <runs>/crashed/<name>[.<n>] (both attempts' logs and costs kept). */
export function moveToCrashed(dir: string): string {
  const runs = dirname(dirname(dir));
  mkdirSync(`${runs}/crashed`, { recursive: true });
  let to = `${runs}/crashed/${basename(dir)}`;
  for (let n = 2; existsSync(to); n++) to = `${runs}/crashed/${basename(dir)}.${n}`;
  renameSync(dir, to);
  return to;
}
