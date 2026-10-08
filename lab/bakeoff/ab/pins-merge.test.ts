// mergePins (ab/pins-merge.ts): a worktree's --pin never drops another worktree's arm pins, keeps
// their entries byte-identical, and concurrent pins lose no update.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileHash, mergePins } from "./pins-merge";

const fresh = () => `${mkdtempSync(`${tmpdir()}/pins-merge-`)}/PINS.json`;
const read = (f: string) => JSON.parse(readFileSync(f, "utf8")) as Record<string, string>;

describe("mergePins", () => {
  test("adds and updates only the caller's keys; every other entry stays byte-identical", () => {
    const f = fresh();
    const other = {
      "prompts/tilesgen/T/system.KS1.txt": "t1",
      "prompts/tilesgen/shared/set-judge-tiles.txt": "t2",
      "prompts/base4/T/system.KS1.txt": "old",
      "head:prompts/shared/user.txt": "h",
    };
    writeFileSync(f, JSON.stringify(other, null, 1));
    const otherLines = readFileSync(f, "utf8")
      .split("\n")
      .filter((l) => l.includes("tilesgen"));
    const r = mergePins(f, { "prompts/base4/T/system.KS1.txt": "new", "prompts/base6/x": "b6" });
    expect(r).toEqual({ added: 1, updated: 1, kept: 3, total: 5 });
    const after = read(f);
    expect(Object.keys(after)).toEqual([...Object.keys(other), "prompts/base6/x"]);
    expect(after["prompts/base4/T/system.KS1.txt"]).toBe("new");
    expect(after["prompts/tilesgen/T/system.KS1.txt"]).toBe("t1");
    for (const l of otherLines) expect(readFileSync(f, "utf8")).toContain(l);
  });

  test("creates the file when absent", () => {
    const f = fresh();
    mergePins(f, { a: "1" });
    expect(read(f)).toEqual({ a: "1" });
  });

  test("a write that skips the lock is caught by the hash compare and merged over, not lost", () => {
    const f = fresh();
    writeFileSync(f, JSON.stringify({ a: "1" }, null, 1));
    let raced = false;
    mergePins(
      f,
      { mine: "m" },
      {
        beforeRename: () => {
          if (raced) return;
          raced = true;
          writeFileSync(f, JSON.stringify({ a: "1", theirs: "t" }, null, 1));
        },
      },
    );
    expect(read(f)).toEqual({ a: "1", theirs: "t", mine: "m" });
  });

  test("gives up without writing when the file never settles", () => {
    const f = fresh();
    writeFileSync(f, "{}");
    let n = 0;
    const h = fileHash(f);
    expect(() =>
      mergePins(
        f,
        { x: "1" },
        { attempts: 3, beforeRename: () => writeFileSync(f, `{"n${n++}":"1"}`) },
      ),
    ).toThrow(/kept changing/);
    expect(fileHash(f)).not.toBe(h);
    expect(read(f)).not.toHaveProperty("x");
  });

  test("concurrent pins from separate processes all land (flock serialises them)", async () => {
    const f = fresh();
    writeFileSync(f, JSON.stringify({ keep: "k" }, null, 1));
    const mod = `${import.meta.dir}/pins-merge.ts`;
    const procs = Array.from({ length: 12 }, (_, i) =>
      Bun.spawn(
        [
          process.execPath,
          "-e",
          `import { mergePins } from ${JSON.stringify(mod)}; for (let j = 0; j < 5; j++) mergePins(${JSON.stringify(f)}, { ["w${i}-" + j]: "v" });`,
        ],
        { stderr: "inherit" },
      ),
    );
    expect(await Promise.all(procs.map((p) => p.exited))).toEqual(Array(12).fill(0));
    const after = read(f);
    expect(after.keep).toBe("k");
    for (let i = 0; i < 12; i++) for (let j = 0; j < 5; j++) expect(after[`w${i}-${j}`]).toBe("v");
  }, 30000);
});
