import { describe, expect, test } from "bun:test";
import pkg from "../../package.json";

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

  /*
   * The node-only modules: the fit and slot-limit CLIs write files (node:fs), and the pupil word
   * limit carries the capacity catalogue. No browser-reachable entry may pull any of them in.
   */
  const NODE_ONLY = ["./templates/pupil-words"];
  const BROWSER = Object.entries(pkg.exports)
    .filter(([k]) => !NODE_ONLY.includes(k))
    .map(([, v]) => `${import.meta.dir}/../../${v}`);
  const MARKERS = [
    '"node:fs"',
    "writeFileSync",
    "fit-table.ts",
    "slot-limits.ts",
    "pupil-words.ts",
  ];

  test("no browser-reachable entry imports node:fs, the table CLIs or the catalogue", async () => {
    expect(BROWSER.length).toBeGreaterThan(5);
    for (const entry of BROWSER) {
      const result = await Bun.build({ entrypoints: [entry], target: "browser", minify: false });
      expect(result.success).toBe(true);
      for (const out of result.outputs) {
        const text = await out.text();
        for (const m of MARKERS) expect(text.includes(m), `${m} reached ${entry}`).toBe(false);
        expect(text.includes('"objectives capacity'), `catalogue reached ${entry}`).toBe(false);
      }
    }
  }, 60_000);

  test("the markers would catch the CLIs (the check is not vacuous)", async () => {
    const result = await Bun.build({
      entrypoints: [`${import.meta.dir}/fit-table.ts`],
      target: "bun",
      minify: false,
    });
    const text = await (result.outputs[0] as Bun.BuildArtifact).text();
    expect(text.includes('"node:fs"') || text.includes("writeFileSync")).toBe(true);
  });
});
