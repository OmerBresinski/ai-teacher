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

/*
 * The build runs in a child `bun build`, not `Bun.build` in this process. The test process keeps
 * the library's shared draw thread (`library/guard.ts`, a Worker that loads the kit and the
 * models), and on Bun 1.3.6 an in-process `Bun.build` that runs while a Worker loads modules
 * misreads files: on CI it failed to resolve every `./vendor/models/*.js` (#602, #604, 20 Oct
 * 2026), and locally the same pairing gives "Unseekable reading file" errors or a segfault. A
 * child process has its own resolver and no threads to share it with.
 */
const EXTERNAL = ["@mastra/core", "@mastra/core/*", "ai", "pino", "zod", "nanoid", "happy-dom"];

describe("@tj/generation", () => {
  test("bundles for bun without React, the editor or the Studio entry", async () => {
    // `@mastra/core` is a runtime dependency of the worker image; it is not what this test is
    // about, and bundling it drags in optional peers. Everything `@tj/*` is bundled and checked.
    // happy-dom (the library models' DOM, TEACH-247 part h) is a runtime dependency too; its own
    // CSSOM code names `cssRules`, which is not an editor stylesheet.
    const proc = Bun.spawn(
      [
        process.execPath,
        "build",
        `${import.meta.dir}/index.ts`,
        "--target=bun",
        ...EXTERNAL.map((name) => `--external=${name}`),
      ],
      { cwd: import.meta.dir, stdout: "pipe", stderr: "pipe" },
    );
    const [text, errors, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(code, errors).toBe(0);
    // Without --outdir the single bundle is written to stdout.
    expect(text.length).toBeGreaterThan(0);
    for (const name of FORBIDDEN) {
      expect(text.includes(name), `${name} reached the @tj/generation bundle`).toBe(false);
    }
  }, 30_000);
});
