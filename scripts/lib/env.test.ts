import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  composeDatabaseUrl,
  diffEnv,
  diffEnvText,
  envPathFor,
  findEnvExamples,
  parseDatabaseUrl,
  parseEnv,
  parseEnvKeys,
} from "./env";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "tj-env-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("parseEnv", () => {
  test("reads KEY=value pairs in order and ignores comments and blanks", () => {
    const env = parseEnv(
      ["# heading", "", "A=1", "  B = two ", "# C=commented-out", "D="].join("\n"),
    );
    expect([...env.entries()]).toEqual([
      ["A", "1"],
      ["B", "two"],
      ["D", ""],
    ]);
  });

  test("handles export prefix, quotes, inline comments, CRLF and a BOM", () => {
    const env = parseEnv(
      "\uFEFFexport URL=\"postgres://u:p@h:5432/db\" # comment\r\nQ='single # not a comment'\r\nPLAIN=value # trailing\r\n",
    );
    expect(env.get("URL")).toBe("postgres://u:p@h:5432/db");
    expect(env.get("Q")).toBe("single # not a comment");
    expect(env.get("PLAIN")).toBe("value");
  });

  test("skips lines that are not KEY=value", () => {
    expect(parseEnvKeys("just words\n1BAD=x\nGOOD=1\n-x=2")).toEqual(["GOOD"]);
  });
});

describe("diffEnvText", () => {
  test("lists example keys missing from the env, in example order", () => {
    const diff = diffEnvText("A=1\nB=2\nC=3\n", "B=other\n");
    expect(diff.missing).toEqual(["A", "C"]);
    expect(diff.extra).toEqual([]);
  });

  test("reports extra keys separately and ignores commented-out example keys", () => {
    const diff = diffEnvText("A=1\n# OPTIONAL=x\n", "A=1\nZ=9\n");
    expect(diff.missing).toEqual([]);
    expect(diff.extra).toEqual(["Z"]);
  });

  test("values do not matter, only keys", () => {
    expect(diffEnvText("A=1\n", "A=\n").missing).toEqual([]);
  });
});

describe("diffEnv (files)", () => {
  test("compares an .env.example with its .env on disk", async () => {
    await withTempDir(async (dir) => {
      const example = path.join(dir, ".env.example");
      const env = path.join(dir, ".env");
      await writeFile(example, "DATABASE_URL=x\nTJ_PG_PORT=5432\n# HIDDEN=1\n");
      await writeFile(env, "TJ_PG_PORT=5433\nEXTRA=1\n");
      const diff = await diffEnv(example, env);
      expect(diff.envExists).toBe(true);
      expect(diff.missing).toEqual(["DATABASE_URL"]);
      expect(diff.extra).toEqual(["EXTRA"]);
    });
  });

  test("a missing .env means every example key is missing", async () => {
    await withTempDir(async (dir) => {
      const example = path.join(dir, ".env.example");
      await writeFile(example, "A=1\nB=2\n");
      const diff = await diffEnv(example, envPathFor(example));
      expect(diff.envExists).toBe(false);
      expect(diff.missing).toEqual(["A", "B"]);
    });
  });
});

describe("findEnvExamples", () => {
  test("finds every .env.example except under node_modules and build output", async () => {
    await withTempDir(async (dir) => {
      const files = [
        ".env.example",
        "apps/api/.env.example",
        "apps/web/.env.example",
        "packages/db/.env.example",
        "node_modules/some-dep/.env.example",
        "apps/api/node_modules/dep/.env.example",
        "apps/web/dist/.env.example",
        ".turbo/.env.example",
        "coverage/.env.example",
        ".git/.env.example",
      ];
      for (const f of files) {
        await mkdir(path.dirname(path.join(dir, f)), { recursive: true });
        await writeFile(path.join(dir, f), "A=1\n");
      }
      // Decoys that must not match.
      await writeFile(path.join(dir, "apps/api/.env"), "A=1\n");
      await writeFile(path.join(dir, "apps/api/.env.example.bak"), "A=1\n");

      const found = await findEnvExamples(dir);
      expect(found.map((p) => path.relative(dir, p))).toEqual([
        ".env.example",
        "apps/api/.env.example",
        "apps/web/.env.example",
        "packages/db/.env.example",
      ]);
    });
  });

  test("returns an empty list for a directory without examples", async () => {
    await withTempDir(async (dir) => {
      expect(await findEnvExamples(dir)).toEqual([]);
    });
  });
});

describe("database URLs", () => {
  test("composeDatabaseUrl builds the compose connection string", () => {
    expect(composeDatabaseUrl(5433, "teaching_journey_test")).toBe(
      "postgres://postgres:postgres@localhost:5433/teaching_journey_test",
    );
  });

  test("parseDatabaseUrl extracts host, port and database", () => {
    expect(
      parseDatabaseUrl("postgres://postgres:postgres@localhost:5433/teaching_journey"),
    ).toEqual({
      host: "localhost",
      port: 5433,
      database: "teaching_journey",
    });
    expect(parseDatabaseUrl("postgresql://u@db.example.com/x")?.port).toBe(5432);
    expect(parseDatabaseUrl("mysql://x")).toBeNull();
    expect(parseDatabaseUrl("not a url")).toBeNull();
  });
});
