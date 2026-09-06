import { describe, expect, test } from "bun:test";
import { SourceRefSchema } from "./source-ref";

describe("SourceRefSchema", () => {
  test("a file reference round-trips; a paste needs no storage key", () => {
    const file = {
      id: "src1",
      kind: "file" as const,
      name: "plan.pdf",
      storageKey: "ws/x/plan.pdf",
      pages: 3,
    };
    expect(SourceRefSchema.parse(file)).toEqual(file);
    const paste = { id: "src2", kind: "paste" as const, name: "Pasted text" };
    expect(SourceRefSchema.parse(paste)).toEqual(paste);
  });

  test("carries references only: extracted text is not a field (strict)", () => {
    expect(
      SourceRefSchema.safeParse({ id: "s", kind: "paste", name: "n", text: "the whole document" })
        .success,
    ).toBe(false);
  });

  test("rejects an unknown kind and a negative or fractional page count", () => {
    expect(SourceRefSchema.safeParse({ id: "s", kind: "url", name: "n" }).success).toBe(false);
    expect(SourceRefSchema.safeParse({ id: "s", kind: "file", name: "n", pages: -1 }).success).toBe(
      false,
    );
    expect(
      SourceRefSchema.safeParse({ id: "s", kind: "file", name: "n", pages: 1.5 }).success,
    ).toBe(false);
  });
});
