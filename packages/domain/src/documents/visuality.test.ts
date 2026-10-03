import { describe, expect, test } from "bun:test";
import { visualityFor } from "./visuality";

describe("visualityFor (ruling 147)", () => {
  test("Y1 science is the most visual: 3 options, short text, picture tasks", () => {
    expect(visualityFor({ yearGroup: "Year 1", subject: "Science", topic: "Animals" })).toEqual({
      level: 5,
      pictureShare: 0.7,
      textLoad: "short",
      options: 3,
      pictureTasks: true,
    });
  });

  test("Y4 history, harder: the floor holds", () => {
    const v = visualityFor({ yearGroup: "Year 4", subject: "History", level: "harder" });
    expect([v.options, v.textLoad, v.pictureTasks]).toEqual([3, "short", true]);
  });

  test("Y12 psychology is the least visual", () => {
    const v = visualityFor({ yearGroup: "Year 12", subject: "Psychology", topic: "Memory" });
    expect(v).toMatchObject({ level: 1, options: 4, textLoad: "full" });
  });

  test("a younger reading level is one step more visual, never more", () => {
    const standard = visualityFor({ yearGroup: "Year 8" });
    const reading = visualityFor({ yearGroup: "Year 8", readingLevel: "Year 5", level: "easier" });
    expect(reading.level - standard.level).toBe(1);
  });

  test("bands by key stage (VIS147A); an abstract topic takes the band's low end", () => {
    const share = (yearGroup: string, topic = "Rivers") =>
      visualityFor({ yearGroup, topic }).pictureShare;
    expect([share("Year 2"), share("Year 8"), share("Year 10"), share("Year 13")]).toEqual([
      0.7, 0.45, 0.4, 0.35,
    ]);
    expect(share("Year 8", "Persuasive writing")).toBe(0.35);
    expect(share("Year 10", "Electrolysis")).toBe(0.4);
  });

  test("an override sets the level", () => {
    expect(visualityFor({ yearGroup: "Year 1", override: 2 }).level).toBe(2);
  });

  test("the age band alone when there is no year", () => {
    expect(visualityFor({ ageBand: "post16" }).level).toBe(1);
  });
});
