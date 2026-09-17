import { describe, expect, test } from "bun:test";
import { YEAR_GROUPS } from "@tj/domain/documents";
import { mergeModelFields, parseBriefRules } from "./parse-brief";

/*
 * The deterministic half of `POST /briefs/parse` (ADR 0029 item 13, TEACH-16) without a fake:
 * the rules, the topic they leave behind, and the output guard that decides which model strings
 * survive. The model call itself is exercised through the route (`apps/api` `briefs.test.ts`).
 */

describe("parseBriefRules", () => {
  test("reads the year group and the subject and leaves the rest as the topic", () => {
    expect(parseBriefRules("Year 8 history: causes of the First World War")).toEqual({
      topic: "causes of the First World War",
      yearGroup: "Year 8",
      subject: "History",
      hits: ["yearGroup", "subject"],
    });
  });

  test("reads minutes, clamps them to the Brief's bounds and falls back to the full text", () => {
    expect(parseBriefRules("Year 5 maths, 45 minutes")).toEqual({
      topic: "Year 5 maths, 45 minutes",
      yearGroup: "Year 5",
      subject: "Maths",
      durationMin: 45,
      hits: ["yearGroup", "subject", "durationMin"],
    });
    expect(parseBriefRules("fractions in 3 mins").durationMin).toBe(5);
    expect(parseBriefRules("fractions, a 400 minute epic").durationMin).toBe(180);
    expect(parseBriefRules("a 50 minute lesson on fractions")).toMatchObject({
      topic: "a lesson on fractions",
      durationMin: 50,
    });
  });

  test("accepts Y8, yr 8 and Reception/EYFS; ignores years outside 1–13", () => {
    expect(parseBriefRules("Y8 rivers").yearGroup).toBe("Year 8");
    expect(parseBriefRules("yr 13 statistics").yearGroup).toBe("Year 13");
    expect(parseBriefRules("reception phonics").yearGroup).toBe("Reception");
    expect(parseBriefRules("EYFS: colours").yearGroup).toBe("Reception");
    expect(parseBriefRules("Year 14 rivers").yearGroup).toBeUndefined();
    expect(parseBriefRules("Day 8 of the trip").yearGroup).toBeUndefined();
  });

  test("a year group the form does not offer is not a hit and stays in the topic", () => {
    const rules = parseBriefRules("Year 8 rivers", ["Year 7", "Year 9"]);
    expect(rules.yearGroup).toBeUndefined();
    expect(rules.topic).toBe("Year 8 rivers");
    expect(parseBriefRules("year 8 rivers", YEAR_GROUPS).yearGroup).toBe("Year 8");
  });

  test("subjects match as whole words, case-insensitively, multi-word included", () => {
    expect(parseBriefRules("ART AND DESIGN: colour wheels")).toMatchObject({
      subject: "Art and design",
      topic: "colour wheels",
    });
    expect(parseBriefRules("hope and repentance").subject).toBeUndefined();
    expect(parseBriefRules("PE warm-ups").subject).toBe("PE");
    expect(parseBriefRules("music and history of jazz").subject).toBe("Music");
  });

  test("nothing found: no hits, the text is the topic", () => {
    expect(parseBriefRules("the water cycle")).toEqual({ topic: "the water cycle", hits: [] });
  });
});

describe("mergeModelFields", () => {
  const rules = parseBriefRules("Year 5 maths, 45 minutes");

  test("a rule hit is never overwritten; level is taken", () => {
    const merged = mergeModelFields(
      rules,
      { yearGroup: "Year 9", subject: "Science", durationMin: 60, level: "harder" },
      YEAR_GROUPS,
    );
    expect(merged).toEqual({ fields: { level: "harder" }, inferred: ["level"], dropped: 0 });
  });

  test("a string off the offered lists is dropped and counted — a name can never be on them", () => {
    const blank = parseBriefRules("a lesson for Amelia Jones on fractions");
    const merged = mergeModelFields(blank, { subject: "Amelia Jones" }, YEAR_GROUPS);
    expect(merged).toEqual({ fields: {}, inferred: [], dropped: 1 });
    const email = mergeModelFields(blank, { yearGroup: "amelia@school.test" }, YEAR_GROUPS);
    expect(email.dropped).toBe(1);
  });

  test('offered options are normalised to the list\'s spelling; "Other" is blank, not a drop', () => {
    const blank = parseBriefRules("the water cycle");
    expect(
      mergeModelFields(blank, { subject: "science", yearGroup: "year 4" }, YEAR_GROUPS),
    ).toEqual({
      fields: { subject: "Science", yearGroup: "Year 4" },
      inferred: ["yearGroup", "subject"],
      dropped: 0,
    });
    expect(mergeModelFields(blank, { subject: "Other", level: null }, YEAR_GROUPS)).toEqual({
      fields: {},
      inferred: [],
      dropped: 0,
    });
  });
});
