import { describe, expect, it } from "bun:test";
import { absoluteTime, relativeTime, sizeOf, yearAndSubject } from "./format";

const now = new Date("2026-09-06T12:00:00.000Z").getTime();

describe("relativeTime", () => {
  it("formats every relative-time branch", () => {
    expect(relativeTime("2026-09-06T11:59:30.000Z", now)).toBe("just now");
    expect(relativeTime("2026-09-06T11:55:00.000Z", now)).toBe("5m ago");
    expect(relativeTime("2026-09-06T09:00:00.000Z", now)).toBe("3h ago");
    expect(relativeTime("2026-09-05T12:00:00.000Z", now)).toBe("Yesterday");
    expect(relativeTime("2026-09-03T12:00:00.000Z", now)).toBe("3d ago");
    expect(relativeTime("2026-08-20T12:00:00.000Z", now)).toBe("20 Aug");
  });
});

describe("library formatting", () => {
  it("formats document metadata", () => {
    expect(sizeOf({ kind: "lesson", count: 1 })).toBe("1 slide");
    expect(sizeOf({ kind: "lesson", count: 3 })).toBe("3 slides");
    expect(sizeOf({ kind: "worksheet", count: 1 })).toBe("1 block");
    expect(sizeOf({ kind: "worksheet", count: 3 })).toBe("3 blocks");
    expect(yearAndSubject({ yearGroup: "Year 4", subject: "Science" })).toBe("Year 4 Science");
    expect(yearAndSubject({ subject: "Science" })).toBe("Science");
    expect(absoluteTime("2026-09-06T12:00:00.000Z")).toContain("September");
  });
});
