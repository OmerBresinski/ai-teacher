import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SpendGuard, spentInLog } from "./spend";

const dir = mkdtempSync(join(tmpdir(), "teacher-path-spend-"));
const file = (name: string, text: string) => {
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
};

describe("spentInLog", () => {
  test("prices model and picture lines, an unpriced call at $0.02", () => {
    const log = file(
      "ok.log",
      [
        JSON.stringify({ ai: { costUsd: 0.01 } }),
        JSON.stringify({ ai: { costUsd: null } }),
        JSON.stringify({ generated: "x", costUsd: 0.04 }),
        JSON.stringify({ msg: "job started" }),
      ].join("\n"),
    );
    const s = spentInLog(log);
    expect(s.llm).toBeCloseTo(0.03);
    expect(s.images).toBeCloseTo(0.04);
  });
  test("throws on a missing log instead of reading $0", () => {
    expect(() => spentInLog(join(dir, "nope.log"))).toThrow(/missing/);
  });
  test("throws on a log with lines but no JSON (pretty-printed or corrupt)", () => {
    const log = file("pretty.log", "[12:00:00] INFO: plan call\n    ai: { costUsd: 0.2 }\n");
    expect(() => spentInLog(log)).toThrow(/no JSON/);
  });
  test("an empty range reads $0", () => {
    expect(spentInLog(file("empty.log", ""))).toEqual({ llm: 0, images: 0, unpriced: 0 });
  });
});

describe("SpendGuard", () => {
  test("reserves a lesson's worst case before it starts and refuses past the stop", () => {
    const g = new SpendGuard(() => 49.0, 49.8, 0.82);
    expect(g.reserve()).toBe(false);
    const h = new SpendGuard(() => 48.0, 49.8, 0.82);
    expect(h.reserve()).toBe(true);
    h.settle(0.1);
    expect(h.spent).toBeCloseTo(0.1);
    expect(h.reserve()).toBe(true);
  });
  test("an unreadable spend keeps the reservation, so the stop still trips", () => {
    const g = new SpendGuard(() => 48.0, 49.8, 0.82);
    expect(g.reserve()).toBe(true);
    g.settle(null);
    expect(g.spent).toBeCloseTo(0.82);
    expect(g.reserve()).toBe(true);
    g.settle(null);
    expect(g.reserve()).toBe(false);
  });
  test("the ledger is re-read before every reservation", () => {
    let ledger = 48.0;
    const g = new SpendGuard(() => ledger, 49.8, 0.82);
    expect(g.reserve()).toBe(true);
    g.settle(0);
    ledger = 49.5;
    expect(g.reserve()).toBe(false);
  });
});
