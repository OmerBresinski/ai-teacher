import { describe, expect, test } from "bun:test";

/*
 * ADR 0027 §2: `@tj/extract` is server-only. The package bundles for Bun without React or the
 * editor, and no browser app declares it as a dependency (`unpdf` and `mammoth` together are more
 * than the whole web bundle budget, F18-R05).
 */
const FORBIDDEN = ["react", "@tj/editor", "@tj/ui", ".css"];

describe("@tj/extract", () => {
  test("bundles for bun without React or the editor", async () => {
    const result = await Bun.build({
      entrypoints: [`${import.meta.dir}/index.ts`],
      target: "bun",
      minify: false,
      external: ["unpdf", "mammoth", "jszip", "fast-xml-parser", "zod"],
    });
    expect(result.success, result.logs.map((l) => l.message).join("\n")).toBe(true);
    const text = await (result.outputs[0] as Bun.BuildArtifact).text();
    for (const name of FORBIDDEN) {
      expect(text.includes(name), `${name} reached the @tj/extract bundle`).toBe(false);
    }
  });

  test("apps/web does not depend on it", async () => {
    const pkg = (await Bun.file(`${import.meta.dir}/../../../apps/web/package.json`).json()) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.["@tj/extract"]).toBeUndefined();
    expect(pkg.devDependencies?.["@tj/extract"]).toBeUndefined();
  });
});
