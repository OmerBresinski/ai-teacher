import { describe, expect, test } from "bun:test";
import { resolveLimits } from "../types";
import { boundDocxConversion } from "./docx-limits";

const document = (children: unknown[]) => ({
  type: "document",
  children,
  notes: { resolve: () => null },
});

describe("DOCX pre-conversion admission", () => {
  test("rejects a large text before HTML conversion", () => {
    expect(() =>
      boundDocxConversion(
        document([{ type: "text", value: "x".repeat(10_000) }]),
        resolveLimits({ maxTextChars: 4096 }),
        100,
      ),
    ).toThrow(expect.objectContaining({ code: "too-large" }));
  });

  test("counts repeated note expansion, not just the unique ZIP part", () => {
    const note = { type: "note", body: [{ type: "text", value: "x".repeat(1000) }] };
    const doc = {
      ...document(Array.from({ length: 10 }, () => ({ type: "noteReference" }))),
      notes: { resolve: () => note },
    };
    expect(() => boundDocxConversion(doc, resolveLimits({ maxTextChars: 20_000 }), 100)).toThrow(
      expect.objectContaining({ code: "too-large" }),
    );
  });

  test("reserves repeated image reads before any converter can inflate them", () => {
    const doc = document(Array.from({ length: 40 }, () => ({ type: "image" })));
    expect(() =>
      boundDocxConversion(doc, resolveLimits({ maxImageBytesTotal: 4096 }), 1024),
    ).toThrow(expect.objectContaining({ code: "too-large" }));
  });

  test("valid content passes through unchanged", () => {
    const doc = document([
      { type: "paragraph", children: [{ type: "text", value: "Water evaporates." }] },
    ]);
    expect(boundDocxConversion(doc, resolveLimits(), 10_000)).toBe(doc);
  });
});
