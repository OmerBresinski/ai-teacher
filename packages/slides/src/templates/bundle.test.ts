import { describe, expect, test } from "bun:test";

/*
 * ADR 0025 §9, as `src/bundle.test.ts` checks the package entry: the writer templates
 * (`@tj/slides/templates`) and the diagram drawer they call bundle for Bun with no React, no
 * Tiptap, no `@tj/ui` and no stylesheet.
 */
const FORBIDDEN = ['"react"', '"react-dom', '"react/', '"react.', '"@tiptap/', '"@tj/ui', '.css"'];

describe("@tj/slides/templates", () => {
  test("bundles for bun without React, Tiptap, @tj/ui or CSS", async () => {
    const result = await Bun.build({
      entrypoints: [`${import.meta.dir}/index.ts`, `${import.meta.dir}/../diagrams/index.ts`],
      target: "bun",
      minify: false,
    });
    expect(result.success).toBe(true);
    for (const out of result.outputs) {
      const text = await out.text();
      expect(text.length).toBeGreaterThan(0);
      for (const name of FORBIDDEN) {
        expect(text.includes(name), `${name} reached the templates bundle`).toBe(false);
      }
    }
  });
});
