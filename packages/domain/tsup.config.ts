import { defineConfig } from "tsup";

/**
 * Opt-in build (README "Internal packages are consumed from source"): consumers import `src/`
 * directly; `dist/` exists to prove the package emits tree-shakeable ESM + `.d.ts` for each
 * subpath export and to catch anything that only works under Bun.
 */
export default defineConfig({
  entry: {
    index: "src/index.ts",
    ids: "src/ids.ts",
    jobs: "src/jobs.ts",
    storage: "src/storage.ts",
    states: "src/states.ts",
    objects: "src/objects/index.ts",
    documents: "src/documents/index.ts",
    "documents/fixtures": "src/documents/fixtures.test-helpers.ts",
    result: "src/result.ts",
  },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: true,
  treeshake: true,
  target: "es2022",
  platform: "neutral",
  external: ["zod"],
});
