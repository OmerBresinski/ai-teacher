import { describe, expect, test } from "bun:test";
import type { SlideElement } from "@tj/domain/documents";

import { isAtEdge } from "./ElementContextMenu";

const els = (...ids: string[]) => ids.map((id) => ({ id })) as unknown as SlideElement[];
const four = els("a", "b", "c", "d");

describe("isAtEdge", () => {
  test("nothing picked counts as at the edge", () => {
    expect(isAtEdge(four, [], "top")).toBe(true);
    expect(isAtEdge(four, ["zz"], "bottom")).toBe(true);
  });

  test("a single element at either end", () => {
    expect(isAtEdge(four, ["d"], "top")).toBe(true);
    expect(isAtEdge(four, ["a"], "bottom")).toBe(true);
    expect(isAtEdge(four, ["b"], "top")).toBe(false);
    expect(isAtEdge(four, ["b"], "bottom")).toBe(false);
  });

  test("a contiguous band at the edge, but not one with a gap", () => {
    expect(isAtEdge(four, ["c", "d"], "top")).toBe(true);
    expect(isAtEdge(four, ["d", "c"], "top")).toBe(true);
    expect(isAtEdge(four, ["b", "d"], "top")).toBe(false);
    expect(isAtEdge(four, ["a", "b"], "bottom")).toBe(true);
    expect(isAtEdge(four, ["a", "c"], "bottom")).toBe(false);
  });

  test("everything picked is at both edges", () => {
    expect(isAtEdge(four, ["a", "b", "c", "d"], "top")).toBe(true);
    expect(isAtEdge(four, ["a", "b", "c", "d"], "bottom")).toBe(true);
  });
});
