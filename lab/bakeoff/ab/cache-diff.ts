// Slide-by-slide diff of two runs' shipped lessons (ab/CACHE.md proof): bun cache-diff.ts <runA> <runB>
// where each run is a dir of <brief>/lesson.json (or <run>/T/<brief>). Element ids and timestamps
// are left out; prints one line per lesson and each differing slide's first differing paths.
import { existsSync, readdirSync, readFileSync } from "node:fs";

const VOLATILE = new Set([
  "id",
  "createdAt",
  "updatedAt",
  "lessonId",
  "slideId",
  "elementId",
  "version",
]);
export function norm(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.keys(v)
        .filter((k) => !VOLATILE.has(k))
        .sort()
        .map((k) => [k, norm((v as Record<string, unknown>)[k])]),
    );
  return v;
}
/** `--ignore <regex>`: paths left out (e.g. picture attribution the old reuse path does not carry). */
const IGNORE = (() => {
  const i = process.argv.indexOf("--ignore");
  return i > 0 ? new RegExp(String(process.argv[i + 1])) : undefined;
})();
/** Paths where a and b differ (at most `max`). */
export function diffPaths(
  a: unknown,
  b: unknown,
  path = "",
  out: string[] = [],
  max = 6,
): string[] {
  if (out.length >= max) return out;
  if (JSON.stringify(a) === JSON.stringify(b)) return out;
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys)
      diffPaths(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
        `${path}.${k}`,
        out,
        max,
      );
    return out;
  }
  if (IGNORE?.test(path)) return out;
  out.push(`${path}: ${JSON.stringify(a)?.slice(0, 70)} -> ${JSON.stringify(b)?.slice(0, 70)}`);
  return out;
}
const lessons = (run: string) => {
  const root = existsSync(`${run}/T`) ? `${run}/T` : run;
  return new Map(
    readdirSync(root)
      .filter((d) => existsSync(`${root}/${d}/lesson.json`))
      .map((d) => [d, `${root}/${d}/lesson.json`]),
  );
};
if (import.meta.main) {
  const [a, b] = process.argv
    .slice(2)
    .filter((x, i, all) => !x.startsWith("--") && all[i - 1] !== "--ignore");
  if (!a || !b) throw new Error("usage: cache-diff.ts <runA> <runB>");
  const A = lessons(a);
  const B = lessons(b);
  let same = 0;
  let all = 0;
  for (const [k, fa] of A) {
    const fb = B.get(k);
    if (!fb) continue;
    const sa = (JSON.parse(readFileSync(fa, "utf8")).slides ?? []) as unknown[];
    const sb = (JSON.parse(readFileSync(fb, "utf8")).slides ?? []) as unknown[];
    const diffs: string[] = [];
    for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
      all += 1;
      const d = diffPaths(norm(sa[i]), norm(sb[i]));
      if (d.length) diffs.push(`  s${i + 1} ${d.join("\n      ")}`);
      else same += 1;
    }
    console.log(`${k}: ${sa.length} vs ${sb.length} slides, ${diffs.length} differ`);
    for (const d of diffs) console.log(d);
  }
  console.log(`identical slides: ${same}/${all}`);
}
