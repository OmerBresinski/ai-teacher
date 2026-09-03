import { describe, expect, test } from "bun:test";
import { newId, type WorkspaceId } from "./ids";
import { isErr, isOk } from "./result";
import { parseStorageKey, StorageKeyError, StorageKeySchema, storageKey } from "./storage";

const ws = newId<WorkspaceId>();

describe("storageKey", () => {
  test("prefixes the workspace id and joins parts with /", () => {
    expect(storageKey(ws, "sources", "abc.pdf")).toBe(`${ws}/sources/abc.pdf`);
    expect(storageKey(ws, "exports")).toBe(`${ws}/exports`);
  });

  test("keeps dots inside file names", () => {
    expect(storageKey(ws, "sources", "report.final.v2.pdf")).toBe(
      `${ws}/sources/report.final.v2.pdf`,
    );
  });

  test("throws StorageKeyError when no parts are given", () => {
    expect(() => storageKey(ws)).toThrow(StorageKeyError);
    expect(() => storageKey(ws)).toThrow(/at least one key segment/);
  });

  test.each([
    ["empty part", "", /empty/],
    ["slash", "a/b", /"\/"/],
    ["backslash", "a\\b", /"\\"/],
    ["dot-dot", "..", /"\.\."/],
    ["dot-dot inside a name", "a..b", /"\.\."/],
    ["single dot", ".", /"\."/],
    ["NUL", "a\0b", /NUL/],
  ])("rejects %s", (_label, part, message) => {
    expect(() => storageKey(ws, "sources", part)).toThrow(StorageKeyError);
    expect(() => storageKey(ws, "sources", part)).toThrow(message);
    expect(() => storageKey(ws, part)).toThrow(StorageKeyError);
  });

  test("exposes the offending part on the error", () => {
    try {
      storageKey(ws, "sources", "../etc/passwd");
      throw new Error("expected StorageKeyError");
    } catch (error) {
      expect(error).toBeInstanceOf(StorageKeyError);
      expect((error as StorageKeyError).part).toBe("../etc/passwd");
      expect((error as StorageKeyError).name).toBe("StorageKeyError");
    }
  });

  test("rejects a non-UUID workspace id smuggled through a cast", () => {
    expect(() => storageKey("tenant-1" as WorkspaceId, "sources")).toThrow(StorageKeyError);
    expect(() => storageKey("../x" as WorkspaceId, "sources")).toThrow(/workspaceId/);
  });
});

describe("parseStorageKey", () => {
  test("round-trips a key built with storageKey", () => {
    const key = storageKey(ws, "sources", "abc.pdf");
    const result = parseStorageKey(key);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.workspaceId).toBe(ws);
      expect(result.value.parts).toEqual(["sources", "abc.pdf"]);
    }
  });

  test.each([
    ["missing workspace prefix", "sources/abc.pdf", /workspace id/],
    ["bare workspace id", ws, /at least one segment/],
    ["trailing slash", `${ws}/sources/`, /empty/],
    ["double slash", `${ws}//abc.pdf`, /empty/],
    ["traversal", `${ws}/../abc.pdf`, /"\.\."/],
    ["backslash", `${ws}/a\\b`, /"\\"/],
    ["NUL", `${ws}/a\0b`, /NUL/],
    ["empty string", "", /workspace id/],
  ])("returns err for %s", (_label, key, message) => {
    const result = parseStorageKey(key);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error).toMatch(message);
  });
});

describe("StorageKeySchema", () => {
  test("accepts keys built with storageKey", () => {
    const key = storageKey(ws, "sources", "abc.pdf");
    expect(StorageKeySchema.parse(key)).toBe(key);
  });

  test.each([
    "sources/abc.pdf",
    ws,
    `${ws}/`,
    `${ws}//abc.pdf`,
    `${ws}/../abc.pdf`,
    `${ws}/a\\b`,
    `${ws}/a\0b`,
    `not-a-uuid/abc.pdf`,
  ])("rejects %j", (key) => {
    expect(StorageKeySchema.safeParse(key).success).toBe(false);
  });
});
