import { describe, expect, test } from "bun:test";

/*
 * ADR 0025 §17, §21: the package the worker imports must bundle for Bun without React, the
 * editor, or the dev-only Studio entry (`mastra.dev.ts`, which constructs `new Mastra()` and is
 * never part of production). Single-output build: the package has no lazy imports.
 */
/** React as a module (bundled or imported), not the word: prompt text says "reaction" (TEACH-88). */
const FORBIDDEN = [
  "node_modules/react/",
  '"react"',
  "@tj/editor",
  "mastra.dev",
  "@tiptap/",
  ".css",
];

describe("@tj/generation", () => {
  test("bundles for bun without React, the editor or the Studio entry", async () => {
    const result = await Bun.build({
      entrypoints: [`${import.meta.dir}/index.ts`],
      target: "bun",
      minify: false,
      // `@mastra/core` is a runtime dependency of the worker image; it is not what this test is
      // about, and bundling it drags in optional peers. Everything `@tj/*` is bundled and checked.
      // happy-dom (the library models' DOM, TEACH-247 part h) is a runtime dependency too; its own
      // CSSOM code names `cssRules`, which is not an editor stylesheet.
      external: ["@mastra/core", "@mastra/core/*", "ai", "pino", "zod", "nanoid", "happy-dom"],
    });
    expect(result.success, result.logs.map((l) => l.message).join("\n")).toBe(true);
    expect(result.outputs).toHaveLength(1);
    const text = await (result.outputs[0] as Bun.BuildArtifact).text();
    for (const name of FORBIDDEN) {
      expect(text.includes(name), `${name} reached the @tj/generation bundle`).toBe(false);
    }
  });
});
