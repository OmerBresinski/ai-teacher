import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SLIDE_TIER_RANGES } from "@tj/domain/documents";
import { PILOT_PACKS, pilotRequest } from "./pilot-pack";
import { type WriterStage, writerSchema } from "./schema";

/*
 * Pilot pack v4.18 (layout-selection, 27 Oct 2026): v4.17 with the plan in units.
 * 1. Each flow entry names its group after `does`; a group's members share one slide.
 * 2. A Routes table (shape x what pupils look at) replaces the routing clauses on the menu lines.
 * 3. The caption-first rule holds for big-visual only; figure-slide states its facts in 2 lines.
 * 4. Lessons run in learning cycles with one practice slide (UX ruling 297), as one block.
 */
// biome-ignore lint/suspicious/noExplicitAny: a JSON schema read in tests
type J = Record<string, any>;
const STAGES: readonly WriterStage[] = ["KS1", "KS2", "KS3-5"];
const KS = { KS1: "KS1", KS2: "KS2", "KS3-5": "KS3" } as const;
const read = (name: string) =>
  readFileSync(new URL(`./bundles/pilot-v4.18-menu/${name}`, import.meta.url), "utf8");
const V418 = PILOT_PACKS["v4.18"];

describe("pilot pack v4.18", () => {
  for (const stage of STAGES) {
    const ks = KS[stage];
    const text = V418.system[ks];
    test(`${ks}: the assembled text is the pinned snapshot`, () =>
      expect(text).toBe(read(`system-${ks}.snapshot.txt`)));
    test(`${ks}: one Lesson structure block, no practice or hinge floors left`, () => {
      expect(text.split("Lesson structure: learning cycles.").length).toBe(2);
      expect(text).not.toContain("Plan at least one hinge slide");
      expect(text).not.toContain("second practice slide");
    });
    test(`${ks}: the Routes table replaces the routing clauses`, () => {
      expect(text.split("\nRoutes. ").length).toBe(2);
      for (const gone of [
        "Parts that work together go to items-row",
        "The reasons of a why or how question come here together",
        "go to split-compare.",
        "a picture or diagram slide whose words are only a caption",
      ])
        expect(text).not.toContain(gone);
    });
    test(`${ks}: the flow writes its group after does`, () => {
      const req = pilotRequest(
        "v4.18",
        stage,
        writerSchema(stage, SLIDE_TIER_RANGES.standard),
        (s) => s,
      );
      const items = (req.schema as J).properties.flow.items;
      expect(Object.keys(items.properties).slice(0, 3)).toEqual(["slide", "does", "group"]);
      expect(items.required).toContain("group");
      expect(items.properties.group.type).toEqual(["string", "null"]);
    });
  }
  test("v4.17's flow has no group", () => {
    const req = pilotRequest(
      "v4.17",
      "KS1",
      writerSchema("KS1", SLIDE_TIER_RANGES.standard),
      (s) => s,
    );
    expect(Object.keys((req.schema as J).properties.flow.items.properties)).not.toContain("group");
  });
});

describe("pilot pack v4.18b", () => {
  const V418B = PILOT_PACKS["v4.18b"];
  for (const stage of STAGES) {
    const ks = KS[stage];
    test(`${ks}: the assembled text is the pinned snapshot`, () =>
      expect(V418B.system[ks]).toBe(
        readFileSync(
          new URL(`./bundles/pilot-v4.18b-menu/system-${ks}.snapshot.txt`, import.meta.url),
          "utf8",
        ),
      ));
    test(`${ks}: group is a required string, never null`, () => {
      const req = pilotRequest(
        "v4.18b",
        stage,
        writerSchema(stage, SLIDE_TIER_RANGES.standard),
        (s) => s,
      );
      const items = (req.schema as J).properties.flow.items;
      expect(items.properties.group.type).toBe("string");
      expect(items.required).toContain("group");
    });
    test(`${ks}: at most half the checks are hinges`, () =>
      expect(V418B.system[ks]).toContain("at most half of a lesson's checks are hinges"));
  }
});
