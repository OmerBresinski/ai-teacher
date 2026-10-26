import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SLIDE_TIER_RANGES } from "@tj/domain/documents";
import { withClose } from "./close";
import { PILOT_PACK_ID, PILOT_PACKS, pilotRequest } from "./pilot-pack";
import { type WriterStage, writerSchema } from "./schema";

/*
 * Pilot pack v4.15 (TEACH-251 part aj): v4.14 with picture asks that can be placed. Under v4.14
 * (romans verify7) a row of a frontier's forts, milecastles and gates asked no pictures (items-row
 * has no picture field), a stages slide asked three generic reconstructions at a surviving monument
 * (ruling 296 keeps real places real-only, so none could be placed), and a library map's intent
 * gave one year, so the filler set the same year at both ends and was refused twice. Schema and
 * code are v4.14's: each template differs in three lines.
 */
type J = Record<string, unknown>;
const STAGES: readonly WriterStage[] = ["KS1", "KS2", "KS3-5"];
const KS = { KS1: "KS1", KS2: "KS2", "KS3-5": "KS3" } as const;
const dir = (v: string) => new URL(`./bundles/pilot-${v}-menu/`, import.meta.url);
const read = (v: string, name: string) => readFileSync(new URL(name, dir(v)), "utf8");

const ROWS =
  " Parts that are each a real building, structure or site, even ones that work together, take panel-list with a named picture on every item, as items-row has none; its shows names one real surviving example and the part (a named site's gate, not a gate).";
const MAP =
  " A map model's intent gives a span of years around the lesson's period, never one year as both ends.";
const OLD_GENERIC =
  "even one set at a real place or in a real event, which its shows calls a reconstruction. A monument is never a reconstruction: a picture of a monument is named.";
const NEW_GENERIC =
  "even one set in a real town or event, which its shows calls a reconstruction. A monument, building or site that survives, whole or as remains, is never reconstructed, nor are its parts: a picture of it or of what happened there is named and shows its remains today, by the site's name and the part.";

describe("pilot pack v4.15", () => {
  test("production runs v4.15", () => expect(PILOT_PACK_ID).toBe("v4.15"));

  for (const stage of STAGES) {
    const ks = KS[stage];

    test(`${ks}: the assembled text is the pinned snapshot`, () => {
      expect(PILOT_PACKS["v4.15"].system[ks]).toBe(read("v4.15", `system-${ks}.snapshot.txt`));
    });

    test(`${ks}: the template is v4.14's with only the three picture-ask edits`, () => {
      const old = read("v4.14", `system-${ks}.template.txt`).split("\n");
      const now = read("v4.15", `system-${ks}.template.txt`).split("\n");
      expect(now).toHaveLength(old.length);
      const changed = now.map((l, i) => [l, old[i] as string] as const).filter(([l, o]) => l !== o);
      expect(changed).toHaveLength(3);
      const back = (l: string) =>
        l.replace(ROWS, "").replace(MAP, "").replace(NEW_GENERIC, OLD_GENERIC);
      for (const [l, o] of changed) expect(back(l)).toBe(o);
      const all = changed.map(([l]) => l).join("\n");
      for (const s of [ROWS, MAP, NEW_GENERIC]) expect(all).toContain(s);
      // General wording: no lesson's names.
      expect(all).not.toMatch(/\b(Hadrian|Roman|London|milecastle|Housesteads|1666|AD \d+)\b/i);
    });

    for (const [tier, range] of Object.entries(SLIDE_TIER_RANGES)) {
      test(`${ks} ${tier}: the request schema is v4.14's`, () => {
        const prod = writerSchema(stage, range);
        for (const exitTicketOnSlides of [true, false]) {
          const req = (v: "v4.14" | "v4.15") =>
            withClose(pilotRequest(v, stage, prod, (sc) => sc).schema, exitTicketOnSlides) as J;
          expect(req("v4.15")).toEqual(req("v4.14"));
        }
      });
    }
  }

  test("a scene in a real town or event stays generic (a painted 1666 street is still allowed)", () => {
    for (const ks of ["KS1", "KS2", "KS3"] as const) {
      const sys = PILOT_PACKS["v4.15"].system[ks];
      expect(sys).toContain(
        "even one set in a real town or event, which its shows calls a reconstruction",
      );
      expect(sys).not.toContain("even one set at a real place");
    }
  });

  test("v4.15's wording grows v4.14's by at most 550 characters at each key stage", () => {
    for (const ks of ["KS1", "KS2", "KS3"] as const) {
      const grow = PILOT_PACKS["v4.15"].system[ks].length - PILOT_PACKS["v4.14"].system[ks].length;
      expect(grow).toBeGreaterThan(0);
      expect(grow).toBeLessThanOrEqual(550);
    }
  });
});
