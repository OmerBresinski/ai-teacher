import { describe, expect, test } from "bun:test";

/*
 * ADR 0025 §9: `@tj/slides` is consumed by the worker, so it must bundle for Bun with no React,
 * no Tiptap, no `@tj/ui` and no stylesheet. Build the package entry and look for the modules that
 * would mean it did not. Unlike `packages/editor/src/thumb.test.ts`, which walks a split build's
 * static import graph because the editor has `React.lazy` chunks, this package has no lazy
 * imports, so a single-output build (no `splitting`) is the whole picture.
 */
const FORBIDDEN = ["react", "react-dom", "@tiptap/", "@tj/ui", ".css"];

describe("@tj/slides", () => {
  test("bundles for bun without React, Tiptap, @tj/ui or CSS", async () => {
    const result = await Bun.build({
      entrypoints: [`${import.meta.dir}/index.ts`],
      target: "bun",
      minify: false,
    });
    expect(result.success).toBe(true);
    expect(result.outputs).toHaveLength(1);
    const text = await (result.outputs[0] as Bun.BuildArtifact).text();
    expect(text.length).toBeGreaterThan(0);
    for (const name of FORBIDDEN) {
      expect(text.includes(name), `${name} reached the @tj/slides bundle`).toBe(false);
    }
  });
});
