import { describe, expect, test } from "bun:test";
import path from "node:path";
import { docsOnly, isDocPath } from "./e2e-scope";

describe("docsOnly", () => {
  test("an ADR alone is documentation", () => {
    expect(docsOnly(["docs/adr/0001-record.md"])).toBe(true);
  });

  test("Markdown anywhere is documentation", () => {
    expect(docsOnly(["README.md", "apps/web/AGENTS.md"])).toBe(true);
  });

  test("vendored agent skills and their lock file are documentation", () => {
    expect(
      docsOnly([
        "apps/web/.agents/skills/tanstack-query/references/caching.ts",
        ".claude/skills/hono",
        "skills-lock.json",
        "apps/web/skills-lock.json",
      ]),
    ).toBe(true);
  });

  test("source moved into docs/ runs the suite (detect diffs with --no-renames: both sides)", () => {
    expect(docsOnly(["apps/web/src/lib/library.ts", "docs/library.ts"])).toBe(false);
  });

  test("one source file among the docs runs the suite", () => {
    expect(docsOnly(["docs/a.md", "apps/web/src/main.tsx"])).toBe(false);
  });

  test("a workflow change runs the suite", () => {
    expect(docsOnly([".github/workflows/ci.yml"])).toBe(false);
  });

  test("an empty diff runs the suite", () => {
    expect(docsOnly([])).toBe(false);
    expect(docsOnly(["", "  "])).toBe(false);
  });

  test("blank lines and trailing spaces around paths are ignored", () => {
    expect(docsOnly(["docs/testing.md ", "", "README.md"])).toBe(true);
  });
});

describe("isDocPath", () => {
  test("a file named like a skill directory is not a skill directory", () => {
    expect(isDocPath("scripts/.claude")).toBe(false);
  });

  test("a path that only starts with docs is not under docs/", () => {
    expect(isDocPath("docsite/index.ts")).toBe(false);
  });
});

describe("CLI", () => {
  const script = path.join(import.meta.dir, "e2e-scope.ts");

  async function scope(stdin: string): Promise<string> {
    const child = Bun.spawn(["bun", script], { stdin: new Blob([stdin]), stdout: "pipe" });
    const out = await new Response(child.stdout).text();
    expect(await child.exited).toBe(0);
    return out.trim();
  }

  test("prints e2e=false for a docs-only diff", async () => {
    expect(await scope("docs/testing.md\nREADME.md\n")).toBe("e2e=false");
  });

  test("prints e2e=true when the diff could not be read", async () => {
    expect(await scope("")).toBe("e2e=true");
  });
});
