import { describe, expect, it } from "bun:test";
import type { DocumentSummary } from "@tj/domain/documents";
import { HOME_CARDS, homeShelves, RECENT_MS, SPLIT_AT, splitByRecency } from "./library-model";

const NOW = Date.parse("2026-09-06T12:00:00.000Z");
const hoursAgo = (hours: number) => new Date(NOW - hours * 60 * 60 * 1000).toISOString();

function doc(id: string, overrides: Partial<DocumentSummary> = {}): DocumentSummary {
  return {
    id,
    kind: "lesson",
    title: id,
    itemCount: 6,
    themeId: "chalk",
    cover: null,
    createdAt: hoursAgo(48),
    updatedAt: hoursAgo(1),
    ...overrides,
  };
}

describe("splitByRecency", () => {
  const shelf = Array.from({ length: SPLIT_AT + 2 }, (_, i) =>
    doc(`d${i}`, { updatedAt: i < 4 ? hoursAgo(i + 1) : hoursAgo(24 * 10 + i) }),
  );

  it("splits a deep shelf on the shared clock, not the wall clock", () => {
    const split = splitByRecency(shelf, NOW);
    expect(split?.recent.map((d) => d.id)).toEqual(["d0", "d1", "d2", "d3"]);
    expect(split?.earlier).toHaveLength(SPLIT_AT - 2);
    // Move the clock forward past the window: everything is "earlier", so no split.
    expect(splitByRecency(shelf, NOW + RECENT_MS)).toBeNull();
  });

  it("does not split shallow shelves or one-sided ones", () => {
    expect(splitByRecency(shelf.slice(0, SPLIT_AT), NOW)).toBeNull();
    expect(
      splitByRecency(
        shelf.map((d) => ({ ...d, updatedAt: hoursAgo(1) })),
        NOW,
      ),
    ).toBeNull();
  });
});

describe("homeShelves", () => {
  it("picks the newest lesson as hero, two beside it, and caps the kind rows", () => {
    const lessons = [
      doc("l1", { updatedAt: hoursAgo(1) }),
      doc("l2", { updatedAt: hoursAgo(2) }),
      doc("l3", { updatedAt: hoursAgo(3) }),
      doc("l4", { updatedAt: hoursAgo(4) }),
      doc("l5", { updatedAt: hoursAgo(5) }),
    ];
    const worksheets = [doc("w1", { kind: "worksheet", updatedAt: hoursAgo(0.5) })];
    const home = homeShelves(lessons, worksheets);
    expect(home.hero?.id).toBe("l1");
    expect(home.beside.map((d) => d.id)).toEqual(["w1", "l2"]);
    expect(home.lessons).toHaveLength(HOME_CARDS);
    expect(home.lessonCount).toBe(5);
    expect(home.worksheets.map((d) => d.id)).toEqual(["w1"]);
  });

  it("shows four beside when there is no lesson", () => {
    const worksheets = Array.from({ length: 5 }, (_, i) =>
      doc(`w${i}`, { kind: "worksheet", updatedAt: hoursAgo(i) }),
    );
    const home = homeShelves([], worksheets);
    expect(home.hero).toBeUndefined();
    expect(home.beside).toHaveLength(4);
  });
});
