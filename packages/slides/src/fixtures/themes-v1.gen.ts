import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

/**
 * Regenerates `themes-v1.json` (TEACH-152 part b): the nine v1 themes as `origin/master` had them
 * before theme v2, which `theme-v2.test.ts` holds the live catalogue to. It reads master's own
 * `themes.ts` and `fonts.ts` (`git show`), so the fixture never comes from the branch under test.
 *
 *   bun packages/slides/src/fixtures/themes-v1.gen.ts [ref]          write (default origin/master)
 *   bun packages/slides/src/fixtures/themes-v1.gen.ts [ref] --check  exit 1 unless byte-equal
 *
 * Master's sources go to `.themes-v1-master/` beside this file (gitignored, overwritten each run)
 * so their `@tj/domain` import resolves inside the package.
 */
const args = process.argv.slice(2);
const check = args.includes("--check");
const ref = args.find((a) => !a.startsWith("--")) ?? "origin/master";
const here = new URL(".", import.meta.url).pathname;
const repo = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: here }).toString().trim();
const dir = `${here}.themes-v1-master/`;
mkdirSync(dir, { recursive: true });
for (const f of ["themes.ts", "fonts.ts"])
  writeFileSync(
    `${dir}${f}`,
    execFileSync("git", ["show", `${ref}:packages/slides/src/${f}`], { cwd: repo }),
  );

const m = await import(`${dir}themes.ts`);
const out = {
  catalogue: m.THEMES,
  staged: Object.fromEntries(
    m.THEMES.flatMap((t: { id: string }) =>
      ["ks1", "ks2", "ks4"].map((b) => [`${t.id}@${b}`, m.getTheme(t.id, b)]),
    ),
  ),
  callouts: m.CALLOUT_TONES,
  options: m.OPTION_TONES,
};
// Formatted as the repo's pre-commit biome check leaves it, so a regenerated file is the committed one.
const json = execFileSync("bunx", ["biome", "format", "--stdin-file-path=themes-v1.json"], {
  cwd: repo,
  input: `${JSON.stringify(out, null, 2)}\n`,
}).toString();
const target = `${here}themes-v1.json`;
if (check) {
  const same = readFileSync(target, "utf8") === json;
  console.log(
    same ? `themes-v1.json is byte-equal to ${ref}` : `themes-v1.json differs from ${ref}`,
  );
  process.exit(same ? 0 : 1);
}
writeFileSync(target, json);
console.log(`wrote themes-v1.json from ${ref}`);
