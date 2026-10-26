import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SLIDE_TIER_RANGES } from "@tj/domain/documents";
import { withClose } from "./close";
import { PILOT_PACK_ID, PILOT_PACKS, pilotRequest } from "./pilot-pack";
import { type WriterStage, writerSchema } from "./schema";

/*
 * Pilot pack v4.16 (TEACH-251 part aq): v4.15 with sharper shape reading in the flow step. Under
 * v4.15 (verify7, verify9) a Year 2 lesson gave each reason why something spread its own picture
 * slide (up to four picture-and-text slides in a row), a two-street contrast was squeezed into one
 * painting, a Year 4 "where" objective planned no map, and two practice slides asked the same
 * answers again. The fix reads shapes better; it adds no quota, cap or forced swap (rulings of
 * 10 Oct). Schema and code are v4.15's: each template differs in two lines.
 */
type J = Record<string, unknown>;
const STAGES: readonly WriterStage[] = ["KS1", "KS2", "KS3-5"];
const KS = { KS1: "KS1", KS2: "KS2", "KS3-5": "KS3" } as const;
const dir = (v: string) => new URL(`./bundles/pilot-${v}-menu/`, import.meta.url);
const read = (v: string, name: string) => readFileSync(new URL(name, dir(v)), "utf8");

const REASONS =
  " The reasons that answer one why or how question are one slide together, never a slide a reason, even when a picture could show each; a reason pupils must see may take a picture slide after it.";
const CONTRAST =
  " A point that sets two cases side by side to show how they differ, such as two places or a before and an after, is a contrast with a picture per side, never one picture holding both; a task on two such cases asks in words, not from a picture of both.";
const MAP =
  " A point about where something is or was, such as its place, a route or journey, the land it covered or held, or a border or frontier, is learnt from a map: its slide looks at a library map model when the Models list has one that fits, else a picture of a map of it, rather than a photo of the place.";
const CHECK =
  " A check slide's does names the fact, reason or step it asks pupils for, one no earlier check asked for.";
const OLD_REPEAT =
  "asks what no earlier question or task asked, checking the same objective through a new case, picture or wording;";
const NEW_REPEAT =
  "asks for an answer no earlier question or task asked for, a different fact, reason, step or use of the idea: the same answer asked again through a new case, picture or wording is a repeat;";
const ANCHOR = "is reasons or causes, never one big idea.";

describe("pilot pack v4.16", () => {
  test("production runs v4.16", () => expect(PILOT_PACK_ID).toBe("v4.16"));

  for (const stage of STAGES) {
    const ks = KS[stage];

    test(`${ks}: the assembled text is the pinned snapshot`, () => {
      expect(PILOT_PACKS["v4.16"].system[ks]).toBe(read("v4.16", `system-${ks}.snapshot.txt`));
    });

    test(`${ks}: the template is v4.15's with only the shape-reading edits`, () => {
      const old = read("v4.15", `system-${ks}.template.txt`).split("\n");
      const now = read("v4.16", `system-${ks}.template.txt`).split("\n");
      expect(now).toHaveLength(old.length);
      const changed = now.map((l, i) => [l, old[i] as string] as const).filter(([l, o]) => l !== o);
      expect(changed).toHaveLength(2);
      const back = (l: string) =>
        l
          .replace(ANCHOR + REASONS + CONTRAST + MAP + CHECK, ANCHOR)
          .replace(NEW_REPEAT, OLD_REPEAT);
      for (const [l, o] of changed) expect(back(l)).toBe(o);
      const all = changed.map(([l]) => l).join("\n");
      for (const s of [REASONS, CONTRAST, MAP, CHECK, NEW_REPEAT]) expect(all).toContain(s);
      // General wording: no lesson's names.
      expect(all).not.toMatch(
        /\b(Hadrian|Roman|London|Pudding|street|wind|bucket|firebreak|1666|AD \d+)\b/i,
      );
    });

    for (const [tier, range] of Object.entries(SLIDE_TIER_RANGES)) {
      test(`${ks} ${tier}: the request schema is v4.15's`, () => {
        const prod = writerSchema(stage, range);
        for (const exitTicketOnSlides of [true, false]) {
          const req = (v: "v4.15" | "v4.16") =>
            withClose(pilotRequest(v, stage, prod, (sc) => sc).schema, exitTicketOnSlides) as J;
          expect(req("v4.16")).toEqual(req("v4.15"));
        }
      });
    }
  }

  test("no quota, cap or forced swap: the new lines never count layouts", () => {
    const added = REASONS + CONTRAST + MAP + CHECK + NEW_REPEAT;
    expect(added).not.toMatch(/\b(at most|no more than|in a row|times|per lesson|quota)\b/i);
  });

  test("v4.16's wording grows v4.15's by at most 1000 characters at each key stage", () => {
    for (const ks of ["KS1", "KS2", "KS3"] as const) {
      const grow = PILOT_PACKS["v4.16"].system[ks].length - PILOT_PACKS["v4.15"].system[ks].length;
      expect(grow).toBeGreaterThan(0);
      expect(grow).toBeLessThanOrEqual(1000);
    }
  });
});
