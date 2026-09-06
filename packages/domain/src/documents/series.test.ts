import { describe, expect, test } from "bun:test";
import { isSeries, parseSeries } from "./series";

const series = {
  id: "series-romans",
  title: "The Romans",
  lessonIds: ["roman-roads", "roman-army", "roman-empire"],
  createdAt: "2026-09-01T09:00:00.000Z",
  updatedAt: "2026-09-05T15:30:00.000Z",
};

describe("parseSeries", () => {
  test("round-trips a series through JSON", () => {
    expect(parseSeries(JSON.parse(JSON.stringify(series)))).toEqual(series);
    expect(isSeries(series)).toBe(true);
  });

  test("accepts a series with no lessons in it yet", () => {
    expect(parseSeries({ ...series, lessonIds: [] }).lessonIds).toEqual([]);
  });

  test("strips fields the schema does not know, such as a storage-only trash flag", () => {
    const parsed = parseSeries({ ...series, deleted: true });
    expect("deleted" in parsed).toBe(false);
  });

  test("rejects a record with the wrong shape", () => {
    expect(isSeries({})).toBe(false);
    expect(() => parseSeries({ id: "x", title: 3 })).toThrow(
      /^This file is not a valid TeachDeck series\. /,
    );
  });
});
