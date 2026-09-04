import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildReport,
  collectInitialFiles,
  distFromManifest,
  type Manifest,
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
    imports: ["_lazy-only-4.js"],
  },
  "_lazy-only-4.js": { file: "assets/lazy-only-4.js" },
};

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
    });
  });

  test("flags", () => {
    expect(
      parseArgs(["--manifest", "m.json", "--dist", "d", "--json", "--markdown-out", "o.md"]),
    ).toEqual({ manifest: "m.json", dist: "d", json: true, markdownOut: "o.md" });
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
    "assets/lazy-only-4.js": 1024 * 1024,
  };

  test("missing manifest -> skip message, exit 0", async () => {
    const code = await run(["--manifest", join(dir, "nope.json")], {}, out);
    expect(code).toBe(0);
    expect(lines).toEqual([SKIP_MESSAGE]);
  });

  test("ok run writes markdown and ignores the huge lazy chunks", async () => {
    const manifest = await writeDist(ALL_FILES);
    const mdPath = join(dir, "report.md");
    const code = await run(["--manifest", manifest, "--markdown-out", mdPath], {}, out);
    expect(code).toBe(0);
    const md = await Bun.file(mdPath).text();
    expect(md).toContain("Bundle budget — OK");
    expect(md).toContain("assets/shared-2.css");
    expect(md).not.toContain("lazy");
    expect(lines.at(-1)).toMatch(/^Bundle budget: OK/);
  });

  test("warn threshold from env", async () => {
    const manifest = await writeDist(ALL_FILES);
    // 5 x 1 KB of random bytes gzips to slightly above 5 KB.
    const code = await run(
      ["--manifest", manifest],
      { BUNDLE_WARN_KB: "4", BUNDLE_BUDGET_KB: "10" },
      out,
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
    );
    expect(code).toBe(1);
    expect(lines.at(-1)).toMatch(/^Bundle budget: FAIL/);
    const json = JSON.parse(lines[0] ?? "{}");
    expect(json.status).toBe("fail");
    expect(json.files).toHaveLength(5);
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
