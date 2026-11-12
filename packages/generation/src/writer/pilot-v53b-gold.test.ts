import { describe, expect, test } from "bun:test";
import type { Lesson } from "@tj/domain/documents";
import { buildsOnOf, writerObjectivesUser } from "../stages/objectives";
import { sampleBriefLesson } from "../testing";
import { packOwnBundleId, resolveWriterBundleId, WRITER_BUNDLE_ID, WRITER_BUNDLES } from "./bundle";
import { PACK_WRITER_BUNDLE } from "./pilot-live";
import { PILOT_PACK_LIVE, PILOT_PACKS, pilotRequest } from "./pilot-pack";

/*
 * Pilot pack v5.3b-gold (12 Nov 2026, scratchpad/tuning/v5.3b-gold): v5.3-gold with one fix. The
 * objectives call gets England's curriculum statements only on the England year-group path; its
 * text said "an expert teacher in England" and filled builds_on from the national curriculum even
 * when none were listed. Bundle base4f-p129 is base4f-p128 with that one text changed (C1-C4).
 */

const P128 = WRITER_BUNDLES["base4f-p128"];
const P129 = WRITER_BUNDLES["base4f-p129"];
/** The four edits (CHANGES.md C1-C4), each applied once to base4f-p128's objectives text. */
const EDITS: [string, string][] = [
  [
    "You're an expert teacher in England and head of department for this subject. Write the learning objectives for the lesson in the context, as a head of department writes them for a colleague to teach from, in the number the context gives.",
    "You're an expert teacher and head of department for this subject. Write the learning objectives for the lesson in the context, as a head of department writes them for a colleague to teach from, in the number the context gives. When the context lists curriculum statements, the class is in England, and its national curriculum and the usual schemes of work set the level; when it lists none, assume no country the context does not name: the year group or age it states and the rest of the context set the level.",
  ],
  [
    'First write builds_on: one sentence on what pupils of this year group already learned about the topic in earlier years, from the statements the context lists as taught before, else from the national curriculum and the usual schemes of work; "New to this year group." when earlier years taught none of it.',
    'First write builds_on. When the context lists curriculum statements, it is one sentence on what pupils of this year group already learned about the topic in earlier years, from the statements it lists as taught before, else from the national curriculum and the usual schemes of work; "New to this year group." when earlier years taught none of it. When it lists none, builds_on is "" unless the context itself says what pupils learned before; never infer it.',
  ],
  [
    "at the level the national curriculum (its statements for this year are in the context when it has them) and the usual schemes of work set for this year,",
    "at the level set for this year,",
  ],
  ["for this year group in England, pitched", "for this year group, pitched"],
];

describe("v5.3b-gold is v5.3-gold with its own bundle", () => {
  test("templates, switches and model blocks are v5.3-gold's", () => {
    const { id: _a, ...a } = PILOT_PACKS["v5.3-gold"];
    const { id: _b, ...b } = PILOT_PACKS["v5.3b-gold"];
    expect(b).toEqual(a);
  });
  test.each(["KS1", "KS2", "KS3"])(
    "%s: the writer request's system and schema are v5.3-gold's",
    (ks) => {
      const a = pilotRequest("v5.3-gold", ks, {}, (s) => s);
      const b = pilotRequest("v5.3b-gold", ks, {}, (s) => s);
      expect(b.system).toBe(a.system);
      expect(JSON.stringify(b.schema)).toBe(JSON.stringify(a.schema));
    },
  );
  test("the pack runs base4f-p129; nothing live moved", () => {
    expect(PACK_WRITER_BUNDLE["v5.3b-gold"]).toBe("base4f-p129");
    expect(PACK_WRITER_BUNDLE["v5.3-gold"]).toBe("base4f-p128");
    expect(packOwnBundleId("v5.3b-gold")).toBe("base4f-p129");
    expect(resolveWriterBundleId({ TJ_PILOT_PACK: "v5.3b-gold" }, () => {})).toBe("base4f-p129");
    expect(PILOT_PACK_LIVE).toBe("v5.0b");
    expect(WRITER_BUNDLE_ID).toBe("base4f-p126");
  });
  test("p129 is p128 with only the objectives text replaced", () => {
    const a = P128 as unknown as Record<string, unknown>;
    const b = P129 as unknown as Record<string, unknown>;
    expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort());
    for (const k of Object.keys(a)) {
      if (k === "id" || k === "pins") continue;
      if (k === "objectives") expect(b[k]).not.toEqual(a[k]);
      else expect(b[k]).toEqual(a[k]);
    }
  });
});

describe("base4f-p129 objectives text", () => {
  test("is p128's with the four edits and nothing else", () => {
    let text = P128.objectives;
    for (const [from, to] of EDITS) {
      expect(text.split(from).length - 1).toBe(1);
      text = text.replace(from, to);
    }
    expect(P129.objectives).toBe(text);
  });
  test("England is named once, inside the statements-listed condition", () => {
    expect(P129.objectives.split("England").length - 1).toBe(1);
    expect(P129.objectives).toContain(
      "When the context lists curriculum statements, the class is in England",
    );
    // the national curriculum is read only on the statements-listed branch of builds_on
    expect(P129.objectives.split("national curriculum").length - 1).toBe(2);
    expect(P129.objectives).toContain('When it lists none, builds_on is "" unless the context');
  });
});

/** A lesson for the objectives user turn: maths, a defaulted length, the given year group. */
const lessonFor = (
  yearGroup: string,
  ageBand: string | undefined,
  topic = "Fractions of amounts",
): Lesson =>
  sampleBriefLesson({
    title: topic,
    subject: "Maths",
    yearGroup,
    ageBand,
    readingLevel: yearGroup,
    brief: { topic, durationMin: 60, durationDefaulted: true, slideTier: "standard" },
  } as never);

describe("the condition the text reads matches what code sends", () => {
  test("England Year 5: the statements are listed", () => {
    const user = writerObjectivesUser(lessonFor("Year 5", "ks2"), P129.objectivesUser, true);
    expect(user).toContain("Curriculum statements (statutory, England, mathematics):");
  });
  test.each([
    ["P5", undefined],
    ["Grade 4", undefined],
    ["Year 12", "post16"],
    ["Reception", "eyfs"],
    ["", undefined],
  ])("%s: no statements, so no England and builds_on empty", (y, band) => {
    const user = writerObjectivesUser(lessonFor(y, band), P129.objectivesUser, true);
    expect(user).not.toContain("Curriculum statements");
    expect(user).not.toContain("England");
  });
  test("the user turn is p128's: only the system text moved", () => {
    for (const [y, band] of [
      ["Year 5", "ks2"],
      ["P5", undefined],
      ["Year 12", "post16"],
    ] as const)
      expect(writerObjectivesUser(lessonFor(y, band), P129.objectivesUser, true)).toBe(
        writerObjectivesUser(lessonFor(y, band), P128.objectivesUser, true),
      );
  });
  test('an empty builds_on is stored as none, so the writer gets no "Pupils already know" line', () => {
    expect(buildsOnOf("")).toBeUndefined();
    expect(buildsOnOf("   ")).toBeUndefined();
  });
});
