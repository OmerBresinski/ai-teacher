import { afterEach, describe, expect, it } from "bun:test";
import { leaveStage, READING, readingOrder } from "./planning-stage";

describe("readingOrder", () => {
  it("picks the brief up, then reads three lines per page, looking up every third page", () => {
    const next = readingOrder();
    const beats: number[] = [];
    let beat: number = READING.pickUp;
    for (let i = 0; i < 18; i++) {
      beat = next(beat);
      beats.push(beat);
    }
    const { line, page, lookUp } = READING;
    expect(beats).toEqual([
      line,
      line,
      line,
      page,
      line,
      line,
      line,
      lookUp,
      line,
      line,
      line,
      page,
      line,
      line,
      line,
      page,
      line,
      line,
    ]);
  });

  it("keeps reading until told to stop: it never lowers the brief on its own", () => {
    const next = readingOrder();
    let beat: number = READING.pickUp;
    for (let i = 0; i < 200; i++) {
      beat = next(beat);
      expect<number[]>([READING.line, READING.page, READING.lookUp]).toContain(beat);
    }
  });
});

describe("leaveStage", () => {
  const original = globalThis.matchMedia;
  afterEach(() => {
    globalThis.matchMedia = original;
  });

  it("changes the step straight away under reduced motion", () => {
    globalThis.matchMedia = ((query: string) => ({
      matches: query.includes("reduce"),
    })) as unknown as typeof matchMedia;
    let updated = 0;
    leaveStage(() => {
      updated++;
    });
    expect(updated).toBe(1);
    expect(document.documentElement.dataset.planExit).toBeUndefined();
  });
});
