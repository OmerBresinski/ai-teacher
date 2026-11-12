import { describe, expect, test } from "bun:test";
import type { Lesson } from "@tj/domain/documents";
import { pointsOf, writerObjectivesUser } from "../stages/objectives";
import { coverageFloor, writerBrief } from "../stages/write";
import { sampleBriefLesson } from "../testing";
import { packOwnBundleId, resolveWriterBundleId, WRITER_BUNDLE_ID, WRITER_BUNDLES } from "./bundle";
import { contextBlock, pointCount, pointLabels } from "./fixes";
import { PACK_WRITER_BUNDLE } from "./pilot-live";
import { PILOT_PACK_LIVE, PILOT_PACKS, pilotRequest } from "./pilot-pack";

/*
 * Pilot pack v5.3-gold (12 Nov 2026, scratchpad/tuning/v5.3-gold): v5.2-gold's switches with eight
 * drafted line edits in each system template, the flow's `points` and the worked row written line
 * first, and writer bundle base4f-p128 (the objectives call writes the lesson's points; the writer's
 * user turn lists them). Lab only: the live pack and the shipped bundle are as before.
 */

type J = Record<string, any>;
const KS: ("KS1" | "KS2" | "KS3")[] = ["KS1", "KS2", "KS3"];
/** The drafted edits (CHANGES.md S1-S8), each applied once to v5.2-gold's text as sent. */
const EDITS: [string, string][] = [
  [
    "A check puts the idea to a case, picture or question the teaching did not show, never straight after the slide that states its answer as a read-back of it.",
    "A check puts the idea to a case, picture or question the teaching did not show.",
  ],
  [
    "For each entry: what it does in up to 8 words;",
    "For each entry: what it does in up to 8 words, a check naming the new case it asks about;",
  ],
  [
    "its size; and the objectives it teaches or checks, none when it does neither.",
    "its size; the points it teaches, by label, none on a check; and the objectives it teaches or checks, none when it does neither.",
  ],
  [
    "- figure-slide: show one figure pupils study, filling the slide, its caption one line on what to take from it: a model from the Models list that shows the point, such as a loop, dated events, or parts with a place on a drawing or map (a problem being solved is worked); or one photo that carries the point without sentences.",
    "- figure-slide: teach what a model in the Models list draws on that model, filling the slide, its caption one line on what to take from it: a structure's named parts where they sit, a loop, dated events or places on a map, the parts' jobs following on items-row; or show one photo that carries the point without sentences.",
  ],
  [
    "Each row is the move in words, starting with its verb, then the line it gives; answer is true",
    "Each row is its line, then its move: what that line does, in words starting with its verb, any number in it one the line works with, written as the line writes it; answer is true",
  ],
  [
    "panel is null; code adds a bar model where the problem has one.",
    "panel is null (code adds a bar model only to an equation like 3x + 5 = 20); the diagram that shows why a method works is its own slide before the example.",
  ],
  [
    "- hinge: one multiple-choice question on the idea just taught.",
    "- hinge: one multiple-choice question putting the idea just taught to a new case.",
  ],
  [
    "- A picture says what it shows in a phrase and lists what pupils must see in it, each one thing in two to four words, clear at slide size.",
    "- A picture says what it shows in a phrase that keeps the lesson's facts about it (time of day, season, period) and lists what pupils must see in it, the thing the slide names first, each one thing in two to four words, clear at slide size.",
  ],
];

describe("v5.3-gold system text", () => {
  test.each(KS)("%s: v5.2-gold's text as sent with exactly the eight drafted edits", (ks) => {
    let text = PILOT_PACKS["v5.2-gold"].system[ks];
    for (const [from, to] of EDITS) {
      expect(text.split(from).length - 1).toBe(1);
      text = text.replace(from, to);
    }
    expect(PILOT_PACKS["v5.3-gold"].system[ks]).toBe(text);
  });
  test.each(KS)("%s: every slot filled; every limit as in v5.2-gold", (ks) => {
    const a = PILOT_PACKS["v5.2-gold"].system[ks];
    const b = PILOT_PACKS["v5.3-gold"].system[ks];
    expect(b).not.toContain("{{");
    // The one new run of digits is the example equation "3x + 5 = 20"; no limit moved.
    const nums = (t: string) => (t.match(/\d+/g) ?? []).sort().join(" ");
    expect(nums(b.replace("an equation like 3x + 5 = 20", "an equation"))).toBe(nums(a));
  });
  test("the switches are v5.2-gold's, plus the flow's points and the line-first worked row", () => {
    const { id: _a, system: _s, ...a } = PILOT_PACKS["v5.2-gold"];
    const { id: _b, system: _t, ...b } = PILOT_PACKS["v5.3-gold"];
    expect(b).toEqual({ ...a, flowPoints: true, workedLineFirst: true });
  });
});

describe("v5.3-gold schema", () => {
  test.each(KS)("%s: a flow entry lists its points before teaches; v5.2-gold has none", (ks) => {
    const flow = (id: "v5.2-gold" | "v5.3-gold") =>
      (pilotRequest(id, ks, {}, (sc) => sc).schema as J).properties.flow.items as J;
    const now = flow("v5.3-gold");
    expect(now.properties.points).toEqual({
      type: "array",
      items: { type: "string" },
      description: expect.stringContaining("labels of the context's points"),
    });
    expect(Object.keys(now.properties).slice(-2)).toEqual(["points", "teaches"]);
    expect((now.required as string[]).slice(-2)).toEqual(["points", "teaches"]);
    expect(flow("v5.2-gold").properties.points).toBeUndefined();
  });
  test.each(KS)(
    "%s: a worked row is written line first; nothing else in the schema moves",
    (ks) => {
      const of = (id: "v5.2-gold" | "v5.3-gold") =>
        pilotRequest(id, ks, {}, (sc) => sc).schema as J;
      const now = of("v5.3-gold");
      const before = of("v5.2-gold");
      const row = now.$defs.worked.properties.lines.items as J;
      expect(Object.keys(row.properties)).toEqual(["eq", "move", "answer"]);
      expect(row.required).toEqual(["eq", "move", "answer"]);
      expect(Object.keys(before.$defs.worked.properties.lines.items.properties)).toEqual([
        "move",
        "eq",
        "answer",
      ]);
      // Put v5.3-gold's two changes back: the rest is v5.2-gold's schema, key order included.
      const { points: _p, ...flowProps } = now.properties.flow.items.properties;
      now.properties.flow.items.properties = flowProps;
      now.properties.flow.items.required = (now.properties.flow.items.required as string[]).filter(
        (k) => k !== "points",
      );
      const { eq, move, ...rest } = row.properties;
      row.properties = { move, eq, ...rest };
      row.required = before.$defs.worked.properties.lines.items.required;
      expect(JSON.stringify(now)).toBe(JSON.stringify(before));
    },
  );
});

describe("v5.3-gold runs writer bundle base4f-p128", () => {
  test("the pack names it; v5.2-gold keeps base4f-p127", () => {
    expect(PACK_WRITER_BUNDLE).toEqual({ "v5.2-gold": "base4f-p127", "v5.3-gold": "base4f-p128" });
    expect(packOwnBundleId("v5.3-gold")).toBe("base4f-p128");
    expect(resolveWriterBundleId({ TJ_PILOT_PACK: "v5.3-gold" }, () => {})).toBe("base4f-p128");
    for (const pack of Object.keys(PACK_WRITER_BUNDLE)) expect(pack in PILOT_PACKS).toBe(true);
  });
  test("nothing live moved", () => {
    expect(PILOT_PACK_LIVE).toBe("v5.0b");
    expect(WRITER_BUNDLE_ID).toBe("base4f-p126");
  });
  test("p128 is p127 with five files replaced", () => {
    const a = WRITER_BUNDLES["base4f-p127"] as unknown as Record<string, unknown>;
    const b = WRITER_BUNDLES["base4f-p128"] as unknown as Record<string, unknown>;
    const changed = ["objectives", "objectivesUser", "objectivesSchema", "user", "notes"];
    for (const k of Object.keys(a)) {
      if (k === "id" || k === "pins") continue;
      if (changed.includes(k)) expect(b[k]).not.toEqual(a[k]);
      else expect(b[k]).toEqual(a[k]);
    }
    const schema = JSON.parse(WRITER_BUNDLES["base4f-p128"].objectivesSchema);
    expect(schema.required).toEqual(["builds_on", "objectives", "points"]);
    expect(Object.keys(schema.properties.points.items.properties)).toEqual(["objective", "point"]);
    expect(WRITER_BUNDLES["base4f-p128"].user).not.toContain("Depth:");
  });
});

const P128 = WRITER_BUNDLES["base4f-p128"];
const lesson = (tier: string, patch: Partial<Lesson> = {}): Lesson =>
  sampleBriefLesson({
    title: "Fractions of amounts",
    subject: undefined,
    yearGroup: "Year 5",
    ageBand: "ks2",
    readingLevel: "Year 5",
    brief: {
      topic: "Fractions of amounts",
      durationMin: 60,
      durationDefaulted: true,
      slideTier: tier,
    },
    ...patch,
  } as never);
const POINTS = [
  { objective: 1, text: "A bar of 10 cut into 4 equal parts shows each part is 2 1/2." },
  { objective: 1, text: "Find 3/4 of 10 by dividing by 4, then multiplying by 3." },
  { objective: 2, text: "Subtract the fraction used from the whole to find what is left." },
  { objective: 1, text: "Find 3/5 of 7 by multiplying by 3 first, then dividing by 5." },
];

describe("points: sized by the slide range, stored, listed for the writer", () => {
  test("the count follows the tier", () => {
    expect(pointCount({ slides: { min: 7, max: 8 } })).toEqual({ lo: 2, hi: 3 });
    expect(pointCount({ slides: { min: 10, max: 12 } })).toEqual({ lo: 4, hi: 6 });
    expect(pointCount({ slides: { min: 13, max: 16 } })).toEqual({ lo: 6, hi: 10 });
  });
  test("the objectives user turn asks for that many, after the objectives count", () => {
    const user = writerObjectivesUser(lesson("standard"), P128.objectivesUser, true);
    expect(user).toContain("\nObjectives: two or three\nPoints: 4 to 6\n");
    expect(user).not.toContain("{{");
    expect(writerObjectivesUser(lesson("detailed"), P128.objectivesUser, true)).toContain(
      "\nPoints: 6 to 10\n",
    );
  });
  test("stored points do not move the range the objectives call is sized by", () => {
    const withPoints = {
      ...lesson("standard"),
      facts: { objectives: [{ text: "First." }, { text: "Second." }], points: POINTS },
    } as never as Lesson;
    expect(writerObjectivesUser(withPoints, P128.objectivesUser, true)).toBe(
      writerObjectivesUser(lesson("standard"), P128.objectivesUser, true),
    );
  });
  test("pointsOf keeps usable points in order and drops the rest", () => {
    expect(
      pointsOf(
        [
          { objective: 1, point: "  One   thing. " },
          { objective: 3, point: "No such objective." },
          { objective: 2, point: "" },
          { objective: 2.5, point: "Not a whole number." },
          { objective: 2, point: "Another thing." },
          "nonsense",
        ],
        2,
      ),
    ).toEqual([
      { objective: 1, text: "One thing." },
      { objective: 2, text: "Another thing." },
    ]);
    expect(pointsOf(undefined, 2)).toBeUndefined();
    expect(pointsOf([], 2)).toBeUndefined();
    const long = pointsOf([{ objective: 1, point: `${"word ".repeat(60)}end` }], 1);
    expect(long?.[0]?.text.length).toBeLessThanOrEqual(200);
    expect(long?.[0]?.text.endsWith("word")).toBe(true);
    expect(pointsOf(Array(14).fill({ objective: 1, point: "A point." }), 1)?.length).toBe(10);
  });
  test("labels run a, b, c under each objective, in the order written", () => {
    expect(pointLabels(POINTS)).toEqual(["1a", "1b", "2a", "1c"]);
  });
  test("the writer's user turn lists the points under their labels, then Coverage", () => {
    const b = { ...writerBrief(lesson("standard")), points: POINTS, buildsOn: "Earlier work." };
    const user = contextBlock(
      b,
      [
        { teacher: "First.", pupil: "" },
        { teacher: "Second.", pupil: "" },
      ],
      P128.user,
    );
    expect(user).toContain(
      "\n\nPoints the lesson teaches, in order:\n1a. A bar of 10 cut into 4 equal parts shows each part is 2 1/2.\n1b. Find 3/4 of 10 by dividing by 4, then multiplying by 3.\n2a. Subtract the fraction used from the whole to find what is left.\n1c. Find 3/5 of 7 by multiplying by 3 first, then dividing by 5.\n\nPupils already know: Earlier work.\n\nCoverage: each point above is taught on a slide of its own",
    );
    expect(user).not.toContain("{{");
    const none = contextBlock(
      writerBrief(lesson("standard")),
      [{ teacher: "First.", pupil: "" }],
      P128.user,
    );
    expect(none).not.toContain("Points the lesson teaches");
    expect(none).toContain("\n\nCoverage: ");
  });
  test("the brief carries only points whose objective the lesson still has", () => {
    const base = lesson("standard");
    const objectives = [{ text: "First." }, { text: "Second." }];
    const two = {
      ...base,
      facts: { ...base.facts, objectives, points: POINTS },
    } as never as Lesson;
    expect(writerBrief(two).points).toEqual(POINTS);
    const one = {
      ...base,
      facts: { ...base.facts, objectives: [objectives[0]], points: POINTS },
    } as never as Lesson;
    expect(writerBrief(one).points?.map((p) => p.objective)).toEqual([1, 1, 1]);
    expect(writerBrief(base).points).toBeUndefined();
  });
  test("the count's floor: a slide a point, inside the tier's range", () => {
    expect(coverageFloor({ min: 10, max: 12 }, 0, 2)).toEqual({ min: 10, max: 12 });
    expect(coverageFloor({ min: 10, max: 12 }, 4, 2)).toEqual({ min: 10, max: 12 });
    expect(coverageFloor({ min: 10, max: 12 }, 6, 2)).toEqual({ min: 11, max: 12 });
    expect(coverageFloor({ min: 10, max: 12 }, 6, 3)).toEqual({ min: 12, max: 12 });
    expect(coverageFloor({ min: 13, max: 16 }, 10, 3)).toEqual({ min: 16, max: 16 });
    expect(coverageFloor({ min: 7, max: 8 }, 3, 1)).toEqual({ min: 8, max: 8 });
  });
});
