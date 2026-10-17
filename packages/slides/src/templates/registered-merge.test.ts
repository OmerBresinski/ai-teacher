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

/** Inserts `line` (one line, no newline) before the only occurrence of `anchor`. */
function before(src: string, anchor: string, line: string): string {
  expect(src.split(anchor).length).toBe(2);
  return src.replace(anchor, `${line}\n${anchor}`);
}

/**
 * Registers a dummy layout `id` in all three registries, as a layout PR would: one line per list,
 * each naming the layout, with the def (layout, samples, lay-draft rules) in the layout's own file.
 */
function addLayout(dir: string, id: string) {
  const edit = (path: string, f: (s: string) => string) =>
    writeFileSync(join(dir, path), f(readFileSync(join(dir, path), "utf8")));
  edit(SLIDES, (s) => {
    let out = before(s, "\n/**\n * Each registered", `import { ${id}Def } from "./${id}";`);
    out = out.replace(`${MARK}}\n`, `${MARK}  ${id}: ${id}Fields;\n}\n`);
    out = before(out, "\n/**\n * Each registered", `import type { ${id}Fields } from "./${id}";`);
    return out.replace(`${MARK}};\n`, `${MARK}  ${id}: ${id}Def,\n};\n`);
  });
  // The writer def carries its lay-draft rules too (`holdDraft`, `itemIcons`), so a layout that
  // needs a draft rule still adds one line here and nothing in `lay-draft.ts`.
  edit(WRITER, (s) => {
    const out = before(s, "\n/** What `toInput`", `import { ${id}Writer } from "./${id}";`);
    return out.replace(`${MARK}};\n`, `${MARK}  ${id}: ${id}Writer,\n};\n`);
  });
  edit(DOMAIN, (s) => s.replace(`${MARK}] as const;\n`, `${MARK}  "${id}",\n] as const;\n`));
}

/** The lines a branch added to `path`, against master. */
function added(dir: string, branch: string, path: string): string[] {
  return git(dir, "diff", "-U0", "master", branch, "--", path)
    .out.split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1));
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
      const base = git(dir, "show", `master:${f}`).out.split("\n");
      const body = git(dir, "show", `${tree}:${f}`).out.split("\n");
      const lines = [...added(dir, "alpha", f), ...added(dir, "zeta", f)];
      expect(lines.length).toBeGreaterThan(0);
      // Every added line survives, once: the union kept both blocks whole and merged no line away.
      for (const l of lines) expect(body.filter((b) => b === l).length, `${f}: ${l}`).toBe(1);
      expect(body.length).toBe(base.length + lines.length);
    }
  });

  test("without the union driver the same branches conflict", () => {
    const dir = scratchRepo(false);
    const merged = git(dir, "merge-tree", "--write-tree", "alpha", "zeta");
    expect(merged.code).toBe(1);
    expect(merged.out).toContain("CONFLICT");
  });
});

/*
 * The real registries keep one line per entry. The union driver is only safe for one-line entries
 * (a line two multi-line blocks share is merged away), so an import or entry the formatter wrapped
 * over several lines fails here before it can break a merge.
 */
describe("the real registries hold one line per entry (TEACH-106 part b)", () => {
  const HOW =
    'see packages/slides/AGENTS.md, "Adding a layout": one line per entry, naming the layout';
  const balanced = (l: string) =>
    [..."{(["].every((o, i) => l.split(o).length === l.split("})]"[i] ?? "").length);
  for (const f of [SLIDES, WRITER, DOMAIN]) {
    test(f, () => {
      const lines = readFileSync(join(ROOT, f), "utf8").split("\n");
      lines.forEach((l, n) => {
        if (l.startsWith("import "))
          expect(
            /^import .* from "[^"]+";$/.test(l),
            `${f}:${n + 1} import spans lines; ${HOW}`,
          ).toBe(true);
      });
      const marks = lines.flatMap((l, n) => (l === MARK.slice(0, -1) ? [n] : []));
      expect(marks.length).toBeGreaterThan(0);
      for (const m of marks) {
        for (let n = m + 1; !/^(\}|\};|\] as const;)$/.test(lines[n] ?? "}"); n++) {
          const l = lines[n] ?? "";
          const whole = /^ {2}\S.*[,;]$/.test(l) && balanced(l);
          expect(whole, `${f}:${n + 1} entry spans lines ("${l.trim()}"); ${HOW}`).toBe(true);
        }
      }
    });
  }
});
