import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SLIDE_TIER_RANGES } from "@tj/domain/documents";
import { writerBrief } from "../stages/write";
import { sampleBriefLesson } from "../testing";
import { writerSystem } from "./ai-services";
import { withClose } from "./close";
import fixture from "./fixtures/pilot-v410-y2-greatfire.json" with { type: "json" };
import { PILOT_PACKS, pilotRequest } from "./pilot-pack";
import { type WriterStage, writerSchema } from "./schema";
import { type WriterReq, type WriterServices, writerMaxTokens } from "./services";
import { runWriter } from "./stage";

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
      expect(changed[0]).toContain("the same method with new numbers or a new setting");
      expect(changed[1]).toContain(
        "Each question, the exit ticket's included, asks what no earlier",
      );
      // The hinge layout's own rule (a belief pupils plausibly hold, named in its why) stays.
      expect(changed[1]).toContain("A hinge's wrong option is the belief its layout asks for");
      expect(changed[2]).toStartWith("Every line is written for the pupils who read it");
      expect(changed[2]).toContain("A teaching slide explains and stops there");
      // KS1's 3 hinge options at 5 words each stay legal: options and labels may be phrases.
      expect(changed[2]).toContain("a hinge option or a card label may be a short phrase");
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

  test("two lessons at one key stage share the cached first system message", async () => {
    const head = async (yearGroup: string, subject: string, objectives: string[]) => {
      let got: WriterReq | undefined;
      const services = {
        log: () => {},
        chat: async () => {
          throw new Error("no chat in this test");
        },
        writer: async (r: WriterReq) => {
          got = r;
          throw new Error("stop after the request");
        },
      } as unknown as WriterServices;
      const l = sampleBriefLesson({ yearGroup, ageBand: "ks1", subject } as never);
      await runWriter({
        brief: writerBrief(l),
        objectives,
        services,
        pilotPack: "v4.10",
        drawDiagrams: { callDrawer: async () => ({ out: undefined, usd: 0, ms: 0 }) },
        library: true,
        libraryMenuFilter: true,
        libraryMenuRank: true,
        libraryModelBody: true,
        libraryPanelsOff: true,
        checks: "log",
      } as never).catch(() => {});
      if (!got) throw new Error("no writer request");
      return { system: got.system, head: writerSystem(got.system)[0]?.content as string };
    };
    const a = await head("Year 2", "History", ["Say where and when the Great Fire began."]);
    const b = await head("Year 1", "Science", ["Name the parts of a plant.", "Say what roots do."]);
    expect(a.system).not.toBe(b.system);
    expect(b.head).toBe(a.head);
    expect(a.head).toContain("A teaching slide explains and stops there");
  });

  test("the paid check's Great Fire deck has no bare trailing command and no semicolon", () => {
    // gpt-6.1-sol, effort low, 26 Oct 2026, Y2 Great Fire Detailed under this pack (13 slides).
    // v4.9 on the same brief wrote "... in 1666. Say the name." and a semicolon exit question.
    const lines: string[] = [];
    const skip = new Set(["why", "must_see", "shows", "template", "fit", "subject", "icon"]);
    const walk = (n: unknown, key = ""): void => {
      if (typeof n === "string") {
        if (!skip.has(key)) lines.push(n);
      } else if (Array.isArray(n)) for (const v of n) walk(v, key);
      else if (n && typeof n === "object")
        for (const [k, v] of Object.entries(n)) if (!skip.has(k)) walk(v, k);
    };
    walk({ slides: fixture.slides, close: fixture.close });
    const bare =
      /(?:^|[.!?]\s+)(?:Look|Say|Explain|Describe|Write|Name|Tell|Talk|Point|Think|Discuss|Find|Draw|Show|Read)(?:\s+\w+){0,3}\.\s*$/;
    const trailing = lines.filter((l) => /[.!?]\s+\S/.test(l) && bare.test(l));
    expect(trailing).toEqual([]);
    expect(lines.filter((l) => l.includes(";"))).toEqual([]);
    expect(3 + fixture.slides.length).toBe(13);
  });

  test("a Detailed lesson's output cap keeps at least 40% headroom at v4.10's measured need", () => {
    // Paid checks, 26 Oct: v4.10 wrote 13 slides in 2,511 / 2,212 / 2,279 / 2,109 / 2,276 output
    // tokens (reasoning included), at most 194 a slide, so about 3,091 at 16 slides.
    const need16 = Math.ceil((2511 / 13) * 16);
    expect(writerMaxTokens(16)).toBeGreaterThanOrEqual(Math.ceil(need16 / 0.6));
  });
});
