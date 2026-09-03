import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { newId } from "../ids";
import { Journey, OBJECT_SCHEMAS, type ObjectName, Workspace } from "./index";

const objectNames = Object.keys(OBJECT_SCHEMAS) as ObjectName[];

describe("core object skeletons", () => {
  test("every schema except Workspace has a workspaceId", () => {
    for (const name of objectNames) {
      const shape = OBJECT_SCHEMAS[name].shape as Record<string, unknown>;
      if (name === "Workspace") {
        expect(shape).not.toHaveProperty("workspaceId");
      } else {
        expect(shape).toHaveProperty("workspaceId");
        // The field must be the shared WorkspaceId brand, not an arbitrary string.
        expect(shape.workspaceId).toBe(OBJECT_SCHEMAS.Journey.shape.workspaceId);
      }
    }
  });

  test("every schema has id, createdAt and updatedAt", () => {
    for (const name of objectNames) {
      const shape = OBJECT_SCHEMAS[name].shape as Record<string, unknown>;
      expect(shape).toHaveProperty("id");
      expect(shape).toHaveProperty("createdAt");
      expect(shape).toHaveProperty("updatedAt");
    }
  });

  test("only Journey carries a version", () => {
    for (const name of objectNames) {
      const shape = OBJECT_SCHEMAS[name].shape as Record<string, unknown>;
      expect(name === "Journey" ? "version" in shape : !("version" in shape)).toBe(true);
    }
  });

  test("schemas are strict (unknown fields rejected)", () => {
    const now = new Date().toISOString();
    const base = { id: newId(), workspaceId: newId(), createdAt: now, updatedAt: now };
    expect(Journey.safeParse({ ...base, version: 0 }).success).toBe(true);
    expect(Journey.safeParse({ ...base, version: 0, goal: "x" }).success).toBe(false);
    expect(Journey.safeParse({ ...base, version: -1 }).success).toBe(false);
    expect(Journey.safeParse({ ...base, version: 1.5 }).success).toBe(false);
    expect(Workspace.safeParse({ id: base.id, createdAt: now, updatedAt: now }).success).toBe(true);
    expect(
      Workspace.safeParse({
        id: base.id,
        createdAt: now,
        updatedAt: now,
        name: "Mine",
      }).success,
    ).toBe(false);
  });

  test("OBJECT_SCHEMAS covers every file in src/objects", () => {
    const files = readdirSync(import.meta.dir)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .filter((f) => f !== "index.ts" && f !== "base.ts")
      .map((f) => f.replace(/\.ts$/, ""));
    const toKebab = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
    expect(files.sort()).toEqual(objectNames.map(toKebab).sort());
  });

  test("each object file declares its owning PRD", async () => {
    const files = readdirSync(import.meta.dir).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "index.ts" && f !== "base.ts",
    );
    for (const file of files) {
      const text = await Bun.file(`${import.meta.dir}/${file}`).text();
      expect(text).toMatch(/^\/\/ Filled by F\d{2}(\/F\d{2})? \(.+\)$/m);
    }
  });
});
