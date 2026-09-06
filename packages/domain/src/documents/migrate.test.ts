import { describe, expect, test } from "bun:test";
import { lesson } from "./fixtures.test-helpers";
import { CURRENT_VERSION, migrate } from "./migrate";

describe("migrate", () => {
  test("a version-less document is treated as the current shape", () => {
    const { version: _v, ...doc } = lesson();
    expect(migrate(doc)).toEqual({ ...doc, version: CURRENT_VERSION });
  });

  test("the current version passes through untouched", () => {
    const doc = lesson();
    expect(migrate(doc)).toBe(doc);
  });

  test("a document from a future version is refused with TeachDeck's message", () => {
    expect(() => migrate({ ...lesson(), version: 2 })).toThrow(
      "This file was made with a newer version of TeachDeck (document version 2).",
    );
  });

  test("non-objects pass through so the schema reports them", () => {
    expect(migrate(null)).toBeNull();
    expect(migrate("text")).toBe("text");
  });
});
