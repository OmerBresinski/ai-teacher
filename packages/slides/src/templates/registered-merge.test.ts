import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/*
 * TEACH-106 part b: two layout PRs that each register a template merge without a conflict. A
 * scratch repo holds the real registries and `.gitattributes`; two branches each add a dummy
 * layout the way `packages/slides/AGENTS.md` ("Adding a layout") says, at the same places, and
 * `git merge-tree` merges them. Without the union driver the same branches conflict, so the test
 * proves the attributes are what makes the merge clean.
 */
const ROOT = join(import.meta.dir, "../../../..");
const SLIDES = "packages/slides/src/templates/registered.ts";
const WRITER = "packages/generation/src/writer/registered.ts";
const DOMAIN = "packages/domain/src/documents/adaptive-template-ids.ts";
const FILES = [".gitattributes", SLIDES, WRITER, DOMAIN];

const MARK = "  // Add entries below this line.\n";

function git(cwd: string, ...args: string[]) {
  const r = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd });
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
}

/** Inserts `text` before the only occurrence of `anchor`. */
function before(src: string, anchor: string, text: string): string {
  expect(src.split(anchor).length).toBe(2);
  return src.replace(anchor, text + anchor);
}

/** Registers a dummy layout `id` in all three registries, as a layout PR would. */
function addLayout(dir: string, id: string) {
  const name = id[0]?.toUpperCase() + id.slice(1);
  const edit = (path: string, f: (s: string) => string) =>
    writeFileSync(join(dir, path), f(readFileSync(join(dir, path), "utf8")));
  edit(SLIDES, (s) => {
    let out = before(
      s,
      "\n\n/**\n * Each registered",
      `\nimport { layout${name} } from "./${id}";`,
    );
    out = out.replace(`${MARK}}\n`, `${MARK}  ${id}: { ${id}?: string[] };\n}\n`);
    return out.replace(
      `${MARK}};\n`,
      `${MARK}  ${id}: {\n    kind: "content",\n    layout: layout${name},\n  },\n};\n`,
    );
  });
  edit(WRITER, (s) =>
    s.replace(
      `${MARK}};\n`,
      `${MARK}  ${id}: { toInput: ({ heading }) => ({ template: "${id}", heading }) },\n};\n`,
    ),
  );
  edit(DOMAIN, (s) => s.replace(`${MARK}] as const;\n`, `${MARK}  "${id}",\n] as const;\n`));
}

function scratchRepo(withAttributes: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), "registry-merge-"));
  for (const f of FILES) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    const src = readFileSync(join(ROOT, f), "utf8");
    writeFileSync(join(dir, f), f === ".gitattributes" && !withAttributes ? "" : src);
  }
  git(dir, "init", "-q", "-b", "master");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "base");
  for (const id of ["alpha", "zeta"]) {
    git(dir, "checkout", "-q", "-b", id, "master");
    addLayout(dir, id);
    git(dir, "commit", "-q", "-am", id);
  }
  return dir;
}

describe("layout registries merge (TEACH-106 part b)", () => {
  test("two branches that each add a layout merge cleanly", () => {
    const dir = scratchRepo(true);
    const merged = git(dir, "merge-tree", "--write-tree", "alpha", "zeta");
    expect(merged.out).not.toContain("CONFLICT");
    expect(merged.code).toBe(0);
    const tree = merged.out.split("\n")[0] ?? "";
    for (const f of [SLIDES, WRITER, DOMAIN]) {
      const body = git(dir, "show", `${tree}:${f}`).out;
      expect(body).toContain("alpha");
      expect(body).toContain("zeta");
    }
    const slides = git(dir, "show", `${tree}:${SLIDES}`).out;
    expect(slides).toContain('import { layoutAlpha } from "./alpha";');
    expect(slides).toContain('import { layoutZeta } from "./zeta";');
  });

  test("without the union driver the same branches conflict", () => {
    const dir = scratchRepo(false);
    const merged = git(dir, "merge-tree", "--write-tree", "alpha", "zeta");
    expect(merged.code).toBe(1);
    expect(merged.out).toContain("CONFLICT");
  });
});
