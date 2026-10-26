import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SLIDE_TIER_RANGES } from "@tj/domain/documents";
import { writerBrief } from "../stages/write";
import { sampleBriefLesson } from "../testing";
import { writerSystem } from "./ai-services";
import { withClose } from "./close";
import fixture from "./fixtures/pilot-v412-y4-romans.json" with { type: "json" };
import { PILOT_PACK_ID, PILOT_PACKS, pilotRequest } from "./pilot-pack";
import { type WriterStage, writerSchema } from "./schema";
import { type WriterReq, type WriterServices, writerMaxTokens } from "./services";
import { runWriter } from "./stage";

/*
 * Pilot pack v4.12 (TEACH-110 part at): v4.11 with fuller teaching slides, plain recall, plausible
 * wrong options, varied question openings and reconstructions marked generic. Real lessons under
 * v4.11 (verify3, both 5.5/10) taught Hadrian's Wall in one caption sentence, opened 5 Great Fire
 * questions with "Imagine", asked "Which city needs a memorial to this fire?" and offered "Narrow
 * streets made sparks cold". Schema and code are v4.11's, so only five template lines differ.
 */
type J = Record<string, any>;
const STAGES: readonly WriterStage[] = ["KS1", "KS2", "KS3-5"];
const KS = { KS1: "KS1", KS2: "KS2", "KS3-5": "KS3" } as const;
const dir = (v: string) => new URL(`./bundles/pilot-${v}-menu/`, import.meta.url);
const read = (v: string, name: string) => readFileSync(new URL(name, dir(v)), "utf8");
const STARTS = [
  "1. Flow. ",
  "2. Layout. ",
  "The questions and tasks climb in demand",
  "A worked example or question may invent its scenario",
  "- A picture says what it shows",
];

describe("pilot pack v4.12", () => {
  test("production runs v4.12", () => expect(PILOT_PACK_ID).toBe("v4.12"));

  for (const stage of STAGES) {
    const ks = KS[stage];

    test(`${ks}: the assembled text is the pinned snapshot`, () => {
      expect(PILOT_PACKS["v4.12"].system[ks]).toBe(read("v4.12", `system-${ks}.snapshot.txt`));
    });

    test(`${ks}: the template is v4.11's with five lines changed`, () => {
      const old = read("v4.11", `system-${ks}.template.txt`).split("\n");
      const now = read("v4.12", `system-${ks}.template.txt`).split("\n");
      expect(now).toHaveLength(old.length);
      const changed = now.filter((l, i) => l !== old[i]);
      expect(changed.map((l) => STARTS.find((s) => l.startsWith(s)))).toEqual(STARTS);
      const text = changed.join("\n");
      expect(text).toContain("A teaching slide's own words state the core knowledge of its point");
      expect(text).toContain("A reason, cause or effect says who or what it involves");
      expect(text).toContain("Those words teach the point even when its picture or diagram fails.");
      expect(text).toContain("A recall question asks plainly about a fact the lesson taught");
      expect(text).toContain("Every wrong option, in a hinge or in any question with options");
      expect(text).toContain("opens at most one question in the whole lesson");
      expect(text).toContain("which its shows calls a reconstruction");
      expect(text).toContain(
        "A monument is never a reconstruction: a picture of a monument is named.",
      );
      expect(text).toContain(
        "a task that opens with an instruction, such as Draw or Explain, counts as a question here",
      );
      // No word marks a made-up case by example any more, and the bakery example is gone.
      expect(text).not.toContain('"imagine"');
      expect(text).not.toContain('"suppose"');
      expect(text).not.toContain("Pudding Lane");
      // The rules are generic: no lesson topic is named in what changed.
      expect(text).not.toMatch(/Hadrian|Roman|London|memorial|spark|plant/i);
    });

    for (const [tier, range] of Object.entries(SLIDE_TIER_RANGES)) {
      test(`${ks} ${tier}: the request schema is v4.11's`, () => {
        const prod = writerSchema(stage, range);
        for (const exitTicketOnSlides of [true, false]) {
          const req = (v: "v4.11" | "v4.12") =>
            withClose(pilotRequest(v, stage, prod, (sc) => sc).schema, exitTicketOnSlides) as J;
          expect(req("v4.12")).toEqual(req("v4.11"));
        }
      });
    }
  }

  test("the paid check's Romans deck opens no question with a made-up-case word", () => {
    // gpt-6.1-sol, effort low, 26 Oct 2026, Y4 Hadrian's Wall Standard under this pack (11 slides).
    // v4.11's real lesson opened 2 of its tasks with "Imagine" and taught the wall's place and
    // date in one caption sentence.
    const slides = [...fixture.slides, fixture.close] as J[];
    const questions = slides.flatMap((s) => [
      ...((s.items ?? []) as J[]).flatMap((i) =>
        typeof i.question === "string" ? [i.question] : [],
      ),
      ...(s.template === "hinge" ? [s.heading as string] : []),
    ]);
    expect(questions.length).toBeGreaterThan(4);
    expect(questions.filter((q) => /^(imagine|suppose|pretend)\b/i.test(q))).toEqual([]);
    for (const h of slides.filter((s) => s.template === "hinge")) expect(h.options).toHaveLength(3);
    // The first teaching slide states who ordered the wall, when, and where it ran.
    const first = JSON.stringify(fixture.slides[0]);
    expect(first).toContain("Hadrian");
    expect(first).toContain("AD 122");
    expect(first).toContain("Solway");
    expect(fixture.close.template).toBe("exit-ticket");
    expect(3 + fixture.slides.length).toBeGreaterThanOrEqual(SLIDE_TIER_RANGES.standard.min);
    expect(3 + fixture.slides.length).toBeLessThanOrEqual(SLIDE_TIER_RANGES.standard.max);
  });

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
        pilotPack: "v4.12",
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
    expect(a.head).toContain("A recall question asks plainly about a fact the lesson taught");
  });

  test("a Detailed lesson's output cap keeps at least 40% headroom at v4.12's measured need", () => {
    // Paid checks, 26 Oct: v4.12 wrote 14 / 13 / 10 / 11 / 11 slides in 2,269 / 2,261 / 2,074 /
    // 2,446 / 2,282 output tokens (reasoning included), at most 223 a slide (Romans, 11 slides),
    // so about 3,558 at 16.
    const need16 = Math.ceil((2446 / 11) * 16);
    expect(writerMaxTokens(16)).toBeGreaterThanOrEqual(Math.ceil(need16 / 0.6));
  });
});
