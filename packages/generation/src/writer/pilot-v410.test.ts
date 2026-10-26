import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SLIDE_TIER_RANGES } from "@tj/domain/documents";
import { withClose } from "./close";
import { PILOT_PACK_ID, PILOT_PACKS, pilotRequest } from "./pilot-pack";
import { type WriterStage, writerSchema } from "./schema";

/*
 * Pilot pack v4.10 (TEACH-110 part ar): v4.9 with pupil-facing wording. A teaching slide ends on
 * its explanation rather than a bare command, every line is a whole sentence for the age, each
 * slide and question adds something new, and a wrong option is one a half-learned pupil would
 * pick. Schema and code are v4.9's, so only the system text differs.
 */
type J = Record<string, any>;
const STAGES: readonly WriterStage[] = ["KS1", "KS2", "KS3-5"];
const KS = { KS1: "KS1", KS2: "KS2", "KS3-5": "KS3" } as const;
const dir = (v: string) => new URL(`./bundles/pilot-${v}-menu/`, import.meta.url);
const read = (v: string, name: string) => readFileSync(new URL(name, dir(v)), "utf8");

describe("pilot pack v4.10", () => {
  test("production runs v4.10", () => expect(PILOT_PACK_ID).toBe("v4.10"));

  for (const stage of STAGES) {
    const ks = KS[stage];
    const young = ks !== "KS3";

    test(`${ks}: the assembled text is the pinned snapshot`, () => {
      expect(PILOT_PACKS["v4.10"].system[ks]).toBe(read("v4.10", `system-${ks}.snapshot.txt`));
    });

    test(`${ks}: the template is v4.9's with only the wording lines changed`, () => {
      const old = read("v4.9", `system-${ks}.template.txt`).split("\n");
      const now = read("v4.10", `system-${ks}.template.txt`).split("\n");
      expect(now).toHaveLength(old.length);
      const changed = now.filter((l, i) => l !== old[i]);
      expect(changed).toHaveLength(young ? 4 : 3);
      expect(changed[0]).toStartWith("1. Flow.");
      expect(changed[0]).toContain("Each slide adds what the slides before it have not");
      expect(changed[1]).toContain(
        "Each question, the exit ticket's included, asks what no earlier",
      );
      expect(changed[1]).toContain(
        "a fact from the lesson that is true but does not answer this question",
      );
      expect(changed[2]).toStartWith("Every line is written for the pupils who read it");
      expect(changed[2]).toContain("A teaching slide explains and stops there");
      if (young) expect(changed[3]).toContain('("a shop", "imagine")');
    });

    test(`${ks}: the short-command rule is gone, and semicolons are ruled out only at KS1 and KS2`, () => {
      const text = PILOT_PACKS["v4.10"].system[ks];
      expect(text).not.toContain("A slide tells pupils what to do as a short command.");
      expect(text.includes("with no semicolons and no dropped words")).toBe(young);
    });

    for (const [tier, range] of Object.entries(SLIDE_TIER_RANGES)) {
      test(`${ks} ${tier}: the request schema is v4.9's`, () => {
        const prod = writerSchema(stage, range);
        for (const exitTicketOnSlides of [true, false]) {
          const at = (v: "v4.9" | "v4.10") =>
            withClose(pilotRequest(v, stage, prod, (sc) => sc).schema, exitTicketOnSlides) as J;
          expect(at("v4.10")).toEqual(at("v4.9"));
        }
      });
    }
  }
});
