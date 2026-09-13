import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyChunkOverrides,
  BUNDLE_CHUNK_BUDGETS,
  buildReport,
  type ChunkBudget,
  chunksToMarkdown,
  collectChunkFiles,
  collectInitialFiles,
  distFromManifest,
  findClickLoadedLeaks,
  type Manifest,
  measureChunks,
  parseArgs,
  readThreshold,
  run,
  SKIP_MESSAGE,
  toMarkdown,
} from "./check-bundle-budget";

const FIXTURE: Manifest = {
  "index.html": {
    file: "assets/index-abc.js",
    isEntry: true,
    imports: ["_vendor-1.js", "_shared-2.js"],
    dynamicImports: ["src/routes/lazy.tsx"],
    css: ["assets/index-abc.css"],
  },
  "_vendor-1.js": { file: "assets/vendor-1.js", imports: ["_shared-2.js"] },
  "_shared-2.js": { file: "assets/shared-2.js", css: ["assets/shared-2.css"] },
  "src/routes/lazy.tsx": {
    file: "assets/lazy-3.js",
    isDynamicEntry: true,
    // `_shared-2.js` is already in the initial load and must not be counted twice.
    imports: ["_lazy-only-4.js", "_shared-2.js"],
    dynamicImports: ["_click-5.js"],
    css: ["assets/lazy-3.css"],
  },
  "_lazy-only-4.js": { file: "assets/lazy-only-4.js" },
  "_click-5.js": { file: "assets/click-5.js" },
};

const LAZY_BUDGET: ChunkBudget = { name: "lazy", match: /src\/routes\/lazy\.tsx$/, budgetKb: 3 };

describe("collectInitialFiles", () => {
  test("walks entry -> static imports transitively and includes css", () => {
    expect(collectInitialFiles(FIXTURE)).toEqual([
      "assets/index-abc.css",
      "assets/index-abc.js",
      "assets/shared-2.css",
      "assets/shared-2.js",
      "assets/vendor-1.js",
    ]);
  });

  test("excludes dynamicImports and everything only reachable through them", () => {
    const files = collectInitialFiles(FIXTURE);
    expect(files).not.toContain("assets/lazy-3.js");
    expect(files).not.toContain("assets/lazy-only-4.js");
  });

  test("returns nothing when no chunk is an entry", () => {
    expect(collectInitialFiles({ a: { file: "a.js" } })).toEqual([]);
  });
});

describe("findClickLoadedLeaks (TEACH-111 row 8)", () => {
  const exporters: Manifest = {
    "index.html": { file: "assets/index.js", isEntry: true, imports: ["_dialog.js"] },
    "_dialog.js": {
      file: "assets/dialog.js",
      dynamicImports: [
        "../../packages/editor/src/export/pptx.ts",
        "../../packages/editor/src/export/png.ts",
      ],
    },
    "../../packages/editor/src/export/pptx.ts": {
      file: "assets/pptx.js",
      dynamicImports: [
        "../../node_modules/.bun/pptxgenjs@4.0.1/node_modules/pptxgenjs/dist/pptxgen.es.js",
      ],
    },
    "../../packages/editor/src/export/png.ts": { file: "assets/png.js" },
    "../../node_modules/.bun/pptxgenjs@4.0.1/node_modules/pptxgenjs/dist/pptxgen.es.js": {
      file: "assets/pptxgen.es.js",
    },
  };

  test("is empty when the exporters are reached only through dynamicImports", () => {
    expect(findClickLoadedLeaks(exporters)).toEqual([]);
  });

  test("names the importer when a route chunk imports an exporter statically", () => {
    const leaky: Manifest = {
      ...exporters,
      "_dialog.js": {
        file: "assets/dialog.js",
        imports: ["../../packages/editor/src/export/png.ts"],
      },
      "_route.js": {
        file: "assets/route.js",
        imports: [
          "../../node_modules/.bun/pptxgenjs@4.0.1/node_modules/pptxgenjs/dist/pptxgen.es.js",
        ],
      },
    };
    expect(findClickLoadedLeaks(leaky)).toEqual([
      "_dialog.js -> ../../packages/editor/src/export/png.ts",
      "_route.js -> ../../node_modules/.bun/pptxgenjs@4.0.1/node_modules/pptxgenjs/dist/pptxgen.es.js",
    ]);
  });

  test("docx and export/docx.ts are guarded too (E3)", () => {
    const leaky: Manifest = {
      ...exporters,
      "_route.js": {
        file: "assets/route.js",
        imports: [
          "../../packages/editor/src/export/docx.ts",
          "../../node_modules/.bun/docx@9.7.1/node_modules/docx/dist/index.mjs",
        ],
      },
      "../../packages/editor/src/export/docx.ts": { file: "assets/docx.js" },
      "../../node_modules/.bun/docx@9.7.1/node_modules/docx/dist/index.mjs": {
        file: "assets/docx-vendor.js",
      },
    };
    expect(findClickLoadedLeaks(leaky)).toEqual([
      "_route.js -> ../../node_modules/.bun/docx@9.7.1/node_modules/docx/dist/index.mjs",
      "_route.js -> ../../packages/editor/src/export/docx.ts",
    ]);
  });

  test("an exporter importing another exporter statically is not a leak", () => {
    const chained: Manifest = {
      ...exporters,
      "../../packages/editor/src/export/pptx.ts": {
        file: "assets/pptx.js",
        imports: [
          "../../node_modules/.bun/pptxgenjs@4.0.1/node_modules/pptxgenjs/dist/pptxgen.es.js",
        ],
      },
    };
    expect(findClickLoadedLeaks(chained)).toEqual([]);
  });
});

describe("route chunk budgets (TEACH-113, ADR 0022 §8)", () => {
  test("collectChunkFiles walks the route's static imports and css, minus the initial load", () => {
    const initial = new Set(collectInitialFiles(FIXTURE));
    expect(collectChunkFiles(FIXTURE, "src/routes/lazy.tsx", initial)).toEqual([
      "assets/lazy-3.css",
      "assets/lazy-3.js",
      "assets/lazy-only-4.js",
    ]);
  });

  test("the pinned table names every editor route once, with a positive ceiling", () => {
    const names = BUNDLE_CHUNK_BUDGETS.map((b) => b.name);
    expect(names).toEqual([
      "lesson-editor",
      "lesson-present",
      "lesson-view",
      "lesson-print",
      "worksheet-editor",
      "worksheet-print",
    ]);
    for (const b of BUNDLE_CHUNK_BUDGETS) expect(b.budgetKb).toBeGreaterThan(0);
    expect(
      BUNDLE_CHUNK_BUDGETS.find((b) => b.name === "lesson-editor")?.match.test(
        "src/routes/lesson-editor.page.tsx",
      ),
    ).toBe(true);
  });

  test("applyChunkOverrides replaces a ceiling by name and refuses an unknown name", () => {
    const [first] = applyChunkOverrides(BUNDLE_CHUNK_BUDGETS, { "lesson-editor": 10 });
    expect(first).toMatchObject({ name: "lesson-editor", budgetKb: 10 });
    expect(applyChunkOverrides(BUNDLE_CHUNK_BUDGETS, {})).toEqual([...BUNDLE_CHUNK_BUDGETS]);
    expect(() => applyChunkOverrides(BUNDLE_CHUNK_BUDGETS, { nope: 1 })).toThrow(/no such chunk/);
  });

  test("chunksToMarkdown lists each route with its status", () => {
    const md = chunksToMarkdown([
      { name: "a", key: "k", files: [], totalGzip: 2048, budgetKb: 5, status: "ok" },
      { name: "b", key: null, files: [], totalGzip: 0, budgetKb: 5, status: "missing" },
    ]);
    expect(md).toContain("| `a` | 2.0 KB | 5 KB | OK |");
    expect(md).toContain("| `b` | — | 5 KB | MISSING |");
  });
});

describe("thresholds", () => {
  const sizes = (gzip: number) => [{ file: "a.js", raw: gzip * 3, gzip }];

  test("ok below warn", () => {
    expect(buildReport(sizes(100 * 1024), 200, 250).status).toBe("ok");
  });

  test("warn between warn and budget", () => {
    expect(buildReport(sizes(201 * 1024), 200, 250).status).toBe("warn");
    expect(buildReport(sizes(250 * 1024), 200, 250).status).toBe("warn");
  });

  test("fail above budget", () => {
    expect(buildReport(sizes(250 * 1024 + 1), 200, 250).status).toBe("fail");
  });

  test("readThreshold honours env overrides and rejects garbage", () => {
    expect(readThreshold("BUNDLE_BUDGET_KB", 250, {})).toBe(250);
    expect(readThreshold("BUNDLE_BUDGET_KB", 250, { BUNDLE_BUDGET_KB: "300" })).toBe(300);
    expect(() => readThreshold("BUNDLE_BUDGET_KB", 250, { BUNDLE_BUDGET_KB: "nope" })).toThrow();
    expect(() => readThreshold("BUNDLE_BUDGET_KB", 250, { BUNDLE_BUDGET_KB: "-1" })).toThrow();
  });
});

describe("cli parsing", () => {
  test("defaults", () => {
    expect(parseArgs([])).toEqual({
      manifest: join("apps", "web", "dist", ".vite", "manifest.json"),
      dist: null,
      json: false,
      markdownOut: null,
      chunkOverrides: {},
    });
  });

  test("flags", () => {
    expect(
      parseArgs([
        "--manifest",
        "m.json",
        "--dist",
        "d",
        "--json",
        "--markdown-out",
        "o.md",
        "--chunk",
        "lesson-editor=10",
        "--chunk",
        "lesson-print=20.5",
      ]),
    ).toEqual({
      manifest: "m.json",
      dist: "d",
      json: true,
      markdownOut: "o.md",
      chunkOverrides: { "lesson-editor": 10, "lesson-print": 20.5 },
    });
  });

  test("--chunk needs <name>=<kb>", () => {
    expect(() => parseArgs(["--chunk", "lesson-editor"])).toThrow(/<name>=<kb>/);
    expect(() => parseArgs(["--chunk", "=10"])).toThrow(/<name>=<kb>/);
    expect(() => parseArgs(["--chunk", "lesson-editor=-1"])).toThrow(/<name>=<kb>/);
  });

  test("unknown flag throws", () => {
    expect(() => parseArgs(["--wat"])).toThrow(/Unknown option/);
  });

  test("distFromManifest strips .vite", () => {
    expect(distFromManifest("apps/web/dist/.vite/manifest.json")).toBe("apps/web/dist");
    expect(distFromManifest("out/manifest.json")).toBe("out");
  });
});

describe("run (end to end against a temp dist)", () => {
  let dir: string;
  const lines: string[] = [];
  const out = (l: string) => {
    lines.push(l);
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bundle-budget-"));
    lines.length = 0;
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeDist(sizes: Record<string, number>): Promise<string> {
    await mkdir(join(dir, "assets"), { recursive: true });
    await mkdir(join(dir, ".vite"), { recursive: true });
    for (const [file, size] of Object.entries(sizes)) {
      // Random bytes do not compress, so gzip size ~ raw size and thresholds are predictable.
      const bytes = new Uint8Array(size);
      crypto.getRandomValues(bytes);
      await writeFile(join(dir, file), bytes);
    }
    const manifest = join(dir, ".vite", "manifest.json");
    await writeFile(manifest, JSON.stringify(FIXTURE));
    return manifest;
  }

  const ALL_FILES = {
    "assets/index-abc.js": 1024,
    "assets/index-abc.css": 1024,
    "assets/vendor-1.js": 1024,
    "assets/shared-2.js": 1024,
    "assets/shared-2.css": 1024,
    "assets/lazy-3.js": 1024 * 1024,
    "assets/lazy-3.css": 1024,
    "assets/lazy-only-4.js": 1024 * 1024,
    "assets/click-5.js": 1024,
  };

  test("missing manifest -> skip message, exit 0", async () => {
    const code = await run(["--manifest", join(dir, "nope.json")], {}, out, []);
    expect(code).toBe(0);
    expect(lines).toEqual([SKIP_MESSAGE]);
  });

  test("ok run writes markdown and ignores the huge lazy chunks", async () => {
    const manifest = await writeDist(ALL_FILES);
    const mdPath = join(dir, "report.md");
    const code = await run(["--manifest", manifest, "--markdown-out", mdPath], {}, out, []);
    expect(code).toBe(0);
    const md = await Bun.file(mdPath).text();
    expect(md).toContain("Bundle budget — OK");
    expect(md).toContain("assets/shared-2.css");
    expect(md).not.toContain("lazy");
    expect(md).not.toContain("Route chunk budgets");
    expect(lines.at(-1)).toMatch(/^Bundle budget: OK/);
  });

  test("warn threshold from env", async () => {
    const manifest = await writeDist(ALL_FILES);
    // 5 x 1 KB of random bytes gzips to slightly above 5 KB.
    const code = await run(
      ["--manifest", manifest],
      { BUNDLE_WARN_KB: "4", BUNDLE_BUDGET_KB: "10" },
      out,
      [],
    );
    expect(code).toBe(0);
    expect(lines.at(-1)).toMatch(/^Bundle budget: WARN/);
  });

  test("fail threshold from env -> exit 1", async () => {
    const manifest = await writeDist(ALL_FILES);
    const code = await run(
      ["--manifest", manifest, "--json"],
      { BUNDLE_WARN_KB: "1", BUNDLE_BUDGET_KB: "2" },
      out,
      [],
    );
    expect(code).toBe(1);
    expect(lines.at(-1)).toMatch(/^Bundle budget: FAIL/);
    const json = JSON.parse(lines[0] ?? "{}");
    expect(json.status).toBe("fail");
    expect(json.files).toHaveLength(5);
  });

  test("a route chunk under its ceiling passes and is reported; over it fails with exit 1", async () => {
    const manifest = await writeDist(ALL_FILES);
    // lazy-3.js + lazy-3.css + lazy-only-4.js ~ 2 MB of random bytes: over 3 KB, under 3000 KB.
    const ok = await run(["--manifest", manifest], {}, out, [{ ...LAZY_BUDGET, budgetKb: 3000 }]);
    expect(ok).toBe(0);
    expect(lines.join("\n")).toMatch(/\| `lazy` \| 2\d{3}\.\d KB \| 3000 KB \| OK \|/);

    lines.length = 0;
    const over = await run(["--manifest", manifest, "--json"], {}, out, [LAZY_BUDGET]);
    expect(over).toBe(1);
    expect(lines.at(-1)).toMatch(/^Bundle budget: OK/);
    expect(
      lines.some((l) => /^Chunk budget: FAIL — `lazy` is .* over its 3 KB ceiling/.test(l)),
    ).toBe(true);
    const json = JSON.parse(lines[0] ?? "{}");
    expect(json.chunks).toHaveLength(1);
    expect(json.chunks[0]).toMatchObject({
      name: "lazy",
      status: "fail",
      key: "src/routes/lazy.tsx",
    });
    // The click-loaded chunk behind a dynamic import is not the route's cost.
    expect(json.chunks[0].files.map((f: { file: string }) => f.file)).toEqual([
      "assets/lazy-3.css",
      "assets/lazy-3.js",
      "assets/lazy-only-4.js",
    ]);
  });

  test("--chunk overrides a pinned ceiling for a scratch run", async () => {
    const manifest = await writeDist(ALL_FILES);
    const code = await run(["--manifest", manifest, "--chunk", "lazy=1"], {}, out, [
      { ...LAZY_BUDGET, budgetKb: 3000 },
    ]);
    expect(code).toBe(1);
    expect(lines.some((l) => l.includes("over its 1 KB ceiling"))).toBe(true);
  });

  test("a budget whose route is no longer in the manifest fails, so a renamed page cannot lose its ceiling", async () => {
    const manifest = await writeDist(ALL_FILES);
    const code = await run(["--manifest", manifest], {}, out, [
      { name: "gone", match: /src\/routes\/gone\.tsx$/, budgetKb: 10 },
    ]);
    expect(code).toBe(1);
    expect(
      lines.some((l) => /Chunk budget: FAIL — no chunk in the manifest matches `gone`/.test(l)),
    ).toBe(true);
  });

  test("measureChunks reports a missing route without touching the disk", async () => {
    const reports = await measureChunks(FIXTURE, "/nowhere", [
      { name: "gone", match: /nothing/, budgetKb: 1 },
    ]);
    expect(reports).toEqual([
      { name: "gone", key: null, files: [], totalGzip: 0, budgetKb: 1, status: "missing" },
    ]);
  });

  test("markdown table lists every file and a total row", () => {
    const md = toMarkdown(
      buildReport(
        [
          { file: "a.js", raw: 2048, gzip: 1024 },
          { file: "a.css", raw: 1024, gzip: 512 },
        ],
        200,
        250,
      ),
    );
    expect(md).toContain("| `a.js` | 2.0 KB | 1.0 KB |");
    expect(md).toContain("| **Total** | **3.0 KB** | **1.5 KB** |");
  });
});
