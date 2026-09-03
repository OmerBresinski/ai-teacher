import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkEntries,
  checkSkills,
  formatResults,
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

  async function installFake(path: string) {
    await mkdir(join(root, path), { recursive: true });
    await writeFile(join(root, path, "SKILL.md"), "---\nname: fake\n---\n");
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
    expect(formatResults(results)).toContain("ok");
    expect(formatResults(results)).not.toContain("MISSING");
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
