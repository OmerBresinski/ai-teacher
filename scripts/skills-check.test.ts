import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  checkEntries,
  checkLayout,
  checkSkills,
  formatLayoutFailure,
  formatResults,
  parseCanonicalPath,
  parsePathCell,
  parseSkillTable,
  splitRow,
} from "./skills-check";

const FIXTURE = `# Agent skills

Some prose before the table.

| Skill | Source | Commit | Path | Purpose |
| ----- | ------ | ------ | ---- | ------- |
| \`alpha\` | owner/alpha | abc1234 | \`apps/web/.agents/skills/alpha\` | Alpha things |
| \`beta\` | owner/beta | def5678 | \`apps/api/.agents/skills/beta\`, \`apps/worker/.agents/skills/beta\` | Beta things |
| \`gamma\` | owner/gamma | 0123abc | \`packages/ui/.agents/skills/gamma\` | Gamma things |

## Another table that must be ignored

| Command | Effect |
| ------- | ------ |
| \`bun run x\` | nothing |
`;

describe("markdown parsing", () => {
  test("splitRow trims cells and drops outer pipes", () => {
    expect(splitRow("| a | b  |c|")).toEqual(["a", "b", "c"]);
  });

  test("parsePathCell reads backtick-quoted, comma-separated paths", () => {
    expect(parsePathCell("`a/b`, `c/d`")).toEqual(["a/b", "c/d"]);
    expect(parsePathCell("a/b, c/d")).toEqual(["a/b", "c/d"]);
    expect(parsePathCell("—")).toEqual([]);
  });

  test("parseSkillTable yields one entry per (skill, path) pair", () => {
    expect(parseSkillTable(FIXTURE)).toEqual([
      { skill: "alpha", path: "apps/web/.agents/skills/alpha" },
      { skill: "beta", path: "apps/api/.agents/skills/beta" },
      { skill: "beta", path: "apps/worker/.agents/skills/beta" },
      { skill: "gamma", path: "packages/ui/.agents/skills/gamma" },
    ]);
  });

  test("parseSkillTable throws when no Skill/Path table exists", () => {
    expect(() => parseSkillTable("| Command | Effect |\n| --- | --- |\n| x | y |")).toThrow(
      /No skill table/,
    );
  });
});

describe("filesystem checks", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "skills-check-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /** Mimics `skills add --agent universal claude-code`: real dir + relative `.claude` symlink. */
  async function installFake(path: string, { withLink = true } = {}) {
    await mkdir(join(root, path), { recursive: true });
    await writeFile(join(root, path, "SKILL.md"), "---\nname: fake\n---\n");
    if (withLink) await linkVariant(path, ".claude");
  }

  async function linkVariant(path: string, variant: string, target?: string) {
    const parts = parseCanonicalPath(path);
    if (!parts) throw new Error(`not canonical: ${path}`);
    const link = join(root, parts.location, variant, "skills", parts.name);
    await mkdir(dirname(link), { recursive: true });
    await symlink(target ?? join("..", "..", ".agents", "skills", parts.name), link);
    return link;
  }

  test("reports every skill present when all SKILL.md files exist", async () => {
    for (const p of [
      "apps/web/.agents/skills/alpha",
      "apps/api/.agents/skills/beta",
      "apps/worker/.agents/skills/beta",
      "packages/ui/.agents/skills/gamma",
    ]) {
      await installFake(p);
    }
    const doc = join(root, "docs", "agent-skills.md");
    await mkdir(join(root, "docs"), { recursive: true });
    await writeFile(doc, FIXTURE);

    const results = await checkSkills(doc, root);
    expect(results).toHaveLength(4);
    expect(results.every((r) => r.present)).toBe(true);
    expect(results.every((r) => r.layout.ok)).toBe(true);
    expect(formatResults(results)).toContain("layout");
    expect(formatResults(results)).toContain("ok");
    expect(formatResults(results)).not.toContain("MISSING");
    expect(formatResults(results)).not.toContain("FAIL");
  });

  test("names the missing skill and path when a directory is absent", async () => {
    await installFake("apps/web/.agents/skills/alpha");
    await installFake("apps/api/.agents/skills/beta");
    // apps/worker/.agents/skills/beta and packages/ui/.agents/skills/gamma deliberately missing

    const results = checkEntries(parseSkillTable(FIXTURE), root);
    const missing = results
      .filter((r) => !r.present)
      .map((r) => `${r.entry.skill}@${r.entry.path}`);
    expect(missing).toEqual([
      "beta@apps/worker/.agents/skills/beta",
      "gamma@packages/ui/.agents/skills/gamma",
    ]);
    expect(formatResults(results)).toContain("MISSING  gamma");
  });

  test("a directory without SKILL.md counts as missing", async () => {
    await mkdir(join(root, "apps/web/.agents/skills/alpha"), { recursive: true });
    const [alpha] = checkEntries([{ skill: "alpha", path: "apps/web/.agents/skills/alpha" }], root);
    expect(alpha?.present).toBe(false);
  });
});

describe("layout checks (ADR 0017)", () => {
  let root: string;
  const ENTRY = { skill: "alpha", path: "apps/web/.agents/skills/alpha" };
  const CANONICAL = join("apps/web/.agents/skills/alpha");
  const CLAUDE = "apps/web/.claude/skills/alpha";

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "skills-layout-"));
    await mkdir(join(root, CANONICAL), { recursive: true });
    await writeFile(join(root, CANONICAL, "SKILL.md"), "---\nname: alpha\n---\n");
    await writeFile(join(root, CANONICAL, "extra.md"), "reference\n");
    await mkdir(join(root, "apps/web/.claude/skills"), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("parseCanonicalPath splits <location>/.agents/skills/<name>", () => {
    expect(parseCanonicalPath("apps/web/.agents/skills/alpha")).toEqual({
      location: "apps/web",
      name: "alpha",
    });
    expect(parseCanonicalPath("packages/ui/.agents/skills/shadcn/")).toEqual({
      location: "packages/ui",
      name: "shadcn",
    });
    expect(parseCanonicalPath("apps/web/.claude/skills/alpha")).toBeNull();
    expect(parseCanonicalPath("apps/web/skills/alpha")).toBeNull();
  });

  test("passes with a real canonical dir and a relative .claude symlink", async () => {
    await symlink("../../.agents/skills/alpha", join(root, CLAUDE));
    expect(checkLayout(ENTRY, root)).toEqual({ ok: true });
  });

  test("also accepts an optional relative .opencode symlink", async () => {
    await symlink("../../.agents/skills/alpha", join(root, CLAUDE));
    await mkdir(join(root, "apps/web/.opencode/skills"), { recursive: true });
    await symlink("../../.agents/skills/alpha", join(root, "apps/web/.opencode/skills/alpha"));
    expect(checkLayout(ENTRY, root)).toEqual({ ok: true });
  });

  test("fails naming the path when .claude holds a real duplicate directory", async () => {
    await cp(join(root, CANONICAL), join(root, CLAUDE), { recursive: true });
    const layout = checkLayout(ENTRY, root);
    expect(layout.ok).toBe(false);
    if (layout.ok) return;
    expect(layout.path).toBe(CLAUDE);
    expect(layout.reason).toMatch(/real directory where a relative symlink/);
    const [result] = checkEntries([ENTRY], root);
    expect(formatLayoutFailure(result as NonNullable<typeof result>)).toBe(
      `${CLAUDE}: real directory where a relative symlink to ${CANONICAL} was expected`,
    );
    expect(formatResults([result as NonNullable<typeof result>])).toContain("FAIL");
  });

  test("fails on a broken symlink", async () => {
    await symlink("../../.agents/skills/does-not-exist", join(root, CLAUDE));
    const layout = checkLayout(ENTRY, root);
    expect(layout).toMatchObject({ ok: false, path: CLAUDE });
    if (!layout.ok) expect(layout.reason).toMatch(/broken symlink/);
  });

  test("fails on an absolute symlink target even when it resolves correctly", async () => {
    await symlink(join(root, CANONICAL), join(root, CLAUDE));
    const layout = checkLayout(ENTRY, root);
    expect(layout).toMatchObject({ ok: false, path: CLAUDE });
    if (!layout.ok) expect(layout.reason).toMatch(/absolute symlink target/);
  });

  test("fails when the .claude link is missing", async () => {
    const layout = checkLayout(ENTRY, root);
    expect(layout).toMatchObject({ ok: false, path: CLAUDE });
    if (!layout.ok) expect(layout.reason).toMatch(/missing; expected a relative symlink/);
  });

  test("fails when the symlink resolves to a different real directory", async () => {
    await mkdir(join(root, "apps/web/.agents/skills/other"), { recursive: true });
    await symlink("../../.agents/skills/other", join(root, CLAUDE));
    const layout = checkLayout(ENTRY, root);
    expect(layout).toMatchObject({ ok: false, path: CLAUDE });
    if (!layout.ok) expect(layout.reason).toMatch(/does not resolve to/);
  });

  test("fails when the canonical dir is missing or is itself a symlink", async () => {
    await rm(join(root, CANONICAL), { recursive: true });
    expect(checkLayout(ENTRY, root)).toMatchObject({
      ok: false,
      path: CANONICAL,
      reason: "canonical skill directory is missing",
    });

    await mkdir(join(root, "apps/web/real"), { recursive: true });
    await writeFile(join(root, "apps/web/real/SKILL.md"), "x");
    await symlink("../../real", join(root, CANONICAL));
    expect(checkLayout(ENTRY, root)).toMatchObject({ ok: false, path: CANONICAL });
  });

  test("fails when a path is not under .agents/skills", () => {
    const layout = checkLayout({ skill: "x", path: "apps/web/.claude/skills/x" }, root);
    expect(layout).toMatchObject({ ok: false, path: "apps/web/.claude/skills/x" });
  });
});
