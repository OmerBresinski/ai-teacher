import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SLIDE_TIER_RANGES } from "@tj/domain/documents";
import { withClose } from "./close";
import { PILOT_PACKS, pilotRequest } from "./pilot-pack";
import { type WriterStage, writerSchema } from "./schema";
import { writerMaxTokens } from "./services";

/*
 * Pilot pack v4.9 (TEACH-110 part aq): v4.8 with the slides its plan lists and a named vs generic
 * picture subject with examples (ruling 296). Paid check: three Detailed lessons wrote a 13-entry
 * flow and 13 slides each; v4.8's Detailed Great Fire spent its whole output on reasoning.
 */
type J = Record<string, any>;
const STAGES: readonly WriterStage[] = ["KS1", "KS2", "KS3-5"];
const KS = { KS1: "KS1", KS2: "KS2", "KS3-5": "KS3" } as const;
const dir = (v: string) => new URL(`./bundles/pilot-${v}-menu/`, import.meta.url);
const read = (v: string, name: string) => readFileSync(new URL(name, dir(v)), "utf8");

describe("pilot pack v4.9", () => {
  test("v4.9 stays registered for comparison (production runs v4.10)", () =>
    expect(PILOT_PACKS["v4.9"].id).toBe("v4.9"));

  for (const stage of STAGES) {
    const ks = KS[stage];
    test(`${ks}: the assembled text is the pinned snapshot`, () => {
      expect(PILOT_PACKS["v4.9"].system[ks]).toBe(read("v4.9", `system-${ks}.snapshot.txt`));
    });

    test(`${ks}: the template is v4.8's with three lines changed`, () => {
      const old = read("v4.8", `system-${ks}.template.txt`).split("\n");
      const now = read("v4.9", `system-${ks}.template.txt`).split("\n");
      expect(now).toHaveLength(old.length);
      const changed = now.filter((l, i) => l !== old[i]);
      expect(changed).toHaveLength(3);
      expect(changed[0]).toStartWith(
        "3. Write. Write one slide for each flow entry, in the flow's order",
      );
      expect(changed[0]).toContain("end the lesson only at its last entry");
      expect(changed[1]).toStartWith(
        "The context gives the number of slides, counting the title, the objectives and the close",
      );
      expect(changed[2]).toContain("a real site (the Pudding Lane bakery), a monument");
      expect(changed[2]).toContain(
        "an ordinary object of a period included (a leather fire bucket",
      );
    });

    for (const [tier, range] of Object.entries(SLIDE_TIER_RANGES)) {
      test(`${ks} ${tier}: the written deck can hold every count the plan may list`, () => {
        const prod = writerSchema(stage, range);
        for (const exitTicketOnSlides of [true, false]) {
          const s = withClose(
            pilotRequest("v4.9", stage, prod, (sc) => sc).schema,
            exitTicketOnSlides,
          ).properties as J;
          expect([s.flow.minItems, s.flow.maxItems]).toEqual([range.min, range.max]);
          // Title and objectives are their own fields, close the last: 3 + slides is the lesson.
          expect([3 + s.slides.minItems, 3 + s.slides.maxItems]).toEqual([range.min, range.max]);
        }
      });
    }
  }

  test("v4.8 is kept as shipped for comparison: slides stay at the pack base's 6..9 with close", () => {
    const prod = writerSchema("KS1", SLIDE_TIER_RANGES.detailed);
    const s = withClose(pilotRequest("v4.8", "KS1", prod, (sc) => sc).schema, true).properties as J;
    expect([s.slides.minItems, s.slides.maxItems]).toEqual([6, 9]);
  });

  test("a Detailed lesson's output cap holds the measured need with room to spare", () => {
    // Paid check, 26 Oct: 2,090 / 2,443 / 2,172 output tokens (reasoning included) at 13 slides,
    // at most 188 a slide, so about 3,010 at 16. The cap must keep at least 40% headroom over it.
    const need16 = Math.ceil((2443 / 13) * 16);
    expect(writerMaxTokens(SLIDE_TIER_RANGES.detailed.max)).toBeGreaterThanOrEqual(
      Math.ceil(need16 / 0.6),
    );
  });
});
