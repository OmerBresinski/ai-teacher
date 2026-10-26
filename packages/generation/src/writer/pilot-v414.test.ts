import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SLIDE_TIER_RANGES } from "@tj/domain/documents";
import { writerBrief } from "../stages/write";
import { sampleBriefLesson } from "../testing";
import { writerSystem } from "./ai-services";
import { withClose } from "./close";
import fixture from "./fixtures/pilot-v414-y2-greatfire.json" with { type: "json" };
import { PILOT_PACK_ID, PILOT_PACKS, pilotRequest } from "./pilot-pack";
import { type WriterStage, writerSchema } from "./schema";
import { type WriterReq, type WriterServices, writerMaxTokens } from "./services";
import { runWriter } from "./stage";

/*
 * Pilot pack v4.14 (TEACH-110 part av): v4.13 with taught answers and lighter KS1 teaching slides.
 * Under v4.13 (verify5) a Romans practice question asked for a place the slides never showed, and
 * Year 2 teaching slides ran to 3 sentences (18-22 words) at large type. Schema and code are
 * v4.13's: KS2 and KS3 templates differ in one line, KS1 in two.
 */
type J = Record<string, unknown>;
const STAGES: readonly WriterStage[] = ["KS1", "KS2", "KS3-5"];
const KS = { KS1: "KS1", KS2: "KS2", "KS3-5": "KS3" } as const;
const dir = (v: string) => new URL(`./bundles/pilot-${v}-menu/`, import.meta.url);
const read = (v: string, name: string) => readFileSync(new URL(name, dir(v)), "utf8");
const QUESTIONS = "The questions and tasks climb in demand";
const TAUGHT =
  "Its answer is stated in the text of an earlier slide, a lead, point, card or caption: a fact found only in the notes or a picture is not yet taught, so teach it on a slide or ask about something else.";
const YOUNG =
  "In Years 1 and 2, a teaching slide's lead, or the text of a slide with no items, is at most two short sentences and the picture shows the rest; a layout of several items, such as steps, a comparison or cards, keeps its own fits, one short sentence or phrase per item. A further fact goes in the notes or on a slide of its own.";

describe("pilot pack v4.14", () => {
  test("v4.14 was production until v4.15 (TEACH-251 part aj)", () =>
    expect(PILOT_PACK_ID).toBe("v4.15"));

  for (const stage of STAGES) {
    const ks = KS[stage];

    test(`${ks}: the assembled text is the pinned snapshot`, () => {
      expect(PILOT_PACKS["v4.14"].system[ks]).toBe(read("v4.14", `system-${ks}.snapshot.txt`));
    });

    test(`${ks}: the template is v4.13's with only the taught-answer (and KS1 two-sentence) rule added`, () => {
      const old = read("v4.13", `system-${ks}.template.txt`).split("\n");
      const now = read("v4.14", `system-${ks}.template.txt`).split("\n");
      expect(now).toHaveLength(old.length);
      const changed = now.map((l, i) => [l, old[i] as string] as const).filter(([l, o]) => l !== o);
      const starts = ks === "KS1" ? ["1. Flow. ", QUESTIONS] : [QUESTIONS];
      expect(changed.map(([l]) => starts.find((s) => l.startsWith(s)))).toEqual(starts);
      // Each changed line is its v4.13 text with one sentence added.
      for (const [l, o] of changed) {
        const added = l.startsWith(QUESTIONS) ? TAUGHT : YOUNG;
        expect(l).toContain(added);
        expect(l.replace(` ${added}`, "")).toBe(o);
      }
      expect(changed.map(([l]) => l).join("\n")).not.toMatch(
        /\b(Hadrian|Roman|London|Wallsend|Solway|bucket)\b/i,
      );
    });

    for (const [tier, range] of Object.entries(SLIDE_TIER_RANGES)) {
      test(`${ks} ${tier}: the request schema is v4.13's`, () => {
        const prod = writerSchema(stage, range);
        for (const exitTicketOnSlides of [true, false]) {
          const req = (v: "v4.13" | "v4.14") =>
            withClose(pilotRequest(v, stage, prod, (sc) => sc).schema, exitTicketOnSlides) as J;
          expect(req("v4.14")).toEqual(req("v4.13"));
        }
      });
    }
  }

  test("the paid check's Great Fire deck keeps Year 2 teaching slides to two sentences", () => {
    // gpt-6.1-sol, effort low, 26 Oct 2026, Y2 Great Fire Detailed under this pack (13 slides).
    // v4.13's real lesson had a 3-sentence, 19-word slide; this deck's longest is 18 words.
    const teach = (fixture.slides as { template: string; lead?: string }[]).filter(
      (s) => s.template === "visual-text",
    );
    expect(teach.length).toBeGreaterThan(3);
    for (const s of teach) {
      const lead = s.lead ?? "";
      expect(lead.split(/(?<=[.?!])\s+/).filter(Boolean).length).toBeLessThanOrEqual(2);
    }
    expect(fixture.close.items).toHaveLength(2);
    expect(3 + fixture.slides.length).toBeGreaterThanOrEqual(SLIDE_TIER_RANGES.detailed.min);
    expect(3 + fixture.slides.length).toBeLessThanOrEqual(SLIDE_TIER_RANGES.detailed.max);
  });

  test("v4.14's wording grows v4.13's by at most 550 characters at each key stage", () => {
    // Same cap as question-offer.test.ts, kept beside the pack it guards.
    for (const ks of ["KS1", "KS2", "KS3"] as const) {
      const grow = PILOT_PACKS["v4.14"].system[ks].length - PILOT_PACKS["v4.13"].system[ks].length;
      expect(grow).toBeGreaterThan(0);
      expect(grow).toBeLessThanOrEqual(550);
    }
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
        pilotPack: "v4.14",
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
    expect(a.head).toContain("a fact found only in the notes or a picture is not yet taught");
  });

  test("a Detailed lesson's output cap keeps at least 40% headroom at v4.14's measured need", () => {
    // Paid checks, 26 Oct: v4.14 wrote 13 / 13 / 11 / 10 slides in 2,374 / 2,661 / 2,409 / 2,428
    // output tokens (reasoning included), at most 243 a slide (Romans, 10 slides), about 3,885 at 16.
    const need16 = Math.ceil((2428 / 10) * 16);
    expect(writerMaxTokens(16)).toBeGreaterThanOrEqual(Math.ceil(need16 / 0.6));
  });
});
