import { describe, expect, test } from "bun:test";
import pkg from "../../package.json";

/*
 * ADR 0025 §9, as `src/bundle.test.ts` checks the package entry: the writer templates
 * (`@tj/slides/templates`) and the diagram drawer they call bundle for Bun with no React, no
 * Tiptap, no `@tj/ui` and no stylesheet; and no browser-reachable export pulls in the node-only
 * modules.
 *
 * Each bundle is built by a separate `bun build` process: under Bun 1.3.6 (CI), `Bun.build` inside
 * a long test process fails to read files once many other test files have loaded (EISDIR on
 * `@tj/domain/documents`), whatever the entry.
 */
const FORBIDDEN = ['"react"', '"react-dom', '"react/', '"react.', '"@tiptap/', '"@tj/ui', '.css"'];

function bundle(entry: string, target: "bun" | "browser"): string {
  const r = Bun.spawnSync([process.execPath, "build", entry, `--target=${target}`], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (r.exitCode !== 0) throw new Error(`bun build ${entry} failed: ${r.stderr.toString()}`);
  const text = r.stdout.toString();
  expect(text.length).toBeGreaterThan(0);
  return text;
}

describe("@tj/slides/templates", () => {
  test("bundles for bun without React, Tiptap, @tj/ui or CSS", () => {
    for (const entry of [
      `${import.meta.dir}/index.ts`,
      `${import.meta.dir}/../diagrams/index.ts`,
    ]) {
      const text = bundle(entry, "bun");
      for (const name of FORBIDDEN)
        expect(text.includes(name), `${name} reached the templates bundle`).toBe(false);
    }
  }, 60_000);

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
    // The slot-limit CLI by its own export: the table it generated (diagrams/slot-limits.gen.ts,
    // on the diagrams subpath since TEACH-247) names the CLI's file in its note.
    "slotLimitsSource",
    "pupil-words.ts",
  ];

  test("no browser-reachable entry imports node:fs, the table CLIs or the catalogue", () => {
    expect(BROWSER.length).toBeGreaterThan(5);
    for (const entry of BROWSER) {
      const text = bundle(entry, "browser");
      for (const m of MARKERS) expect(text.includes(m), `${m} reached ${entry}`).toBe(false);
      expect(text.includes('"objectives capacity'), `catalogue reached ${entry}`).toBe(false);
    }
  }, 120_000);

  test("the markers would catch the CLIs and the catalogue (the check is not vacuous)", () => {
    const fit = bundle(`${import.meta.dir}/fit-table.ts`, "bun");
    expect(fit.includes('"node:fs"') || fit.includes("writeFileSync")).toBe(true);
    expect(bundle(`${import.meta.dir}/pupil-words.ts`, "bun")).toContain("pupil-words.ts");
  }, 60_000);
});
