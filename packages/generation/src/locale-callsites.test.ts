import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/*
 * TEACH-33 part b: `callStructured` localises the system prompt from `deps.locale`, so every call
 * site must hand on the stage's own `deps` (which carries the lesson's locale) rather than build a
 * fresh object that drops it. A new call site that builds its own `deps` fails here until it
 * passes `locale` or is listed below with the reason it has no lesson.
 */

/** Call sites that run before any lesson exists, so England's wording is the only one. */
const NO_LESSON = new Set(["parse-brief.ts"]);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "fixtures" ? [] : sources(path);
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [path] : [];
  });
}

test("every callStructured call site passes the stage's deps, or deps with locale", () => {
  const root = join(import.meta.dir);
  const offenders: string[] = [];
  let sites = 0;
  for (const file of sources(root)) {
    const rel = relative(root, file);
    if (rel === "call.ts") continue;
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/callStructured\(\{\s*deps(\s*[,}:])/g)) {
      sites++;
      if (match[1]?.trim() !== ":") continue; // `deps,` — the stage's own deps, locale included
      const literal = text.slice(match.index, match.index + 600);
      const body = literal.slice(literal.indexOf("deps:"), literal.indexOf("}") + 1);
      if (!body.includes("locale") && !NO_LESSON.has(rel.split("/").pop() ?? "")) {
        offenders.push(rel);
      }
    }
  }
  expect(sites).toBeGreaterThanOrEqual(17);
  expect(offenders).toEqual([]);
});
