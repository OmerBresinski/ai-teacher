import { describe, expect, it } from "bun:test";
import { reorderVisible, stepVisible } from "./reorder";

const ids = ["a", "b", "c", "d"];

describe("reorderVisible", () => {
  it("moves a row to the top and bottom", () => {
    expect(reorderVisible(ids, ids, 2, 0)).toEqual(["c", "a", "b", "d"]);
    expect(reorderVisible(ids, ids, 0, 4)).toEqual(["b", "c", "d", "a"]);
  });

  it("returns null for no-op drops", () => {
    expect(reorderVisible(ids, ids, 1, 1)).toBeNull();
    expect(reorderVisible(ids, ids, 1, 2)).toBeNull();
    expect(reorderVisible(ids, ids, 9, 0)).toBeNull();
  });

  it("keeps trashed ids that are stored but not visible", () => {
    const stored = ["a", "trash", "b", "c"];
    const visible = ["a", "b", "c"];
    expect(reorderVisible(stored, visible, 2, 0)).toEqual(["c", "a", "trash", "b"]);
    expect(reorderVisible(stored, visible, 0, 3)).toEqual(["trash", "b", "c", "a"]);
    // The gap below "a" holds a hidden id, so dropping there hops over it (TeachDeck parity).
    expect(reorderVisible(["a", "trash", "b"], ["a", "b"], 0, 1)).toEqual(["trash", "a", "b"]);
  });
});

describe("stepVisible", () => {
  it("moves one step either way and refuses the edges", () => {
    expect(stepVisible(ids, ids, 1, -1)).toEqual(["b", "a", "c", "d"]);
    expect(stepVisible(ids, ids, 1, 1)).toEqual(["a", "c", "b", "d"]);
    expect(stepVisible(ids, ids, 0, -1)).toBeNull();
    expect(stepVisible(ids, ids, 3, 1)).toBeNull();
  });
});
