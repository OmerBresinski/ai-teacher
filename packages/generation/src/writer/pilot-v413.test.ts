import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SLIDE_TIER_RANGES } from "@tj/domain/documents";
import { writerBrief } from "../stages/write";
import { sampleBriefLesson } from "../testing";
import { writerSystem } from "./ai-services";
import { withClose } from "./close";
import fixture from "./fixtures/pilot-v413-y4-romans.json" with { type: "json" };
import { PILOT_PACKS, pilotRequest } from "./pilot-pack";
import { type WriterStage, writerSchema } from "./schema";
import { type WriterReq, type WriterServices, writerMaxTokens } from "./services";
import { runWriter } from "./stage";

/*
 * Pilot pack v4.13 (TEACH-110 part au): v4.12 with no repeat slides, named people and clear
 * questions. Real lessons under v4.12 (verify4) taught the firebreak twice in a row (a teaching
 * slide, then a big picture of the same gap: v4.12 counted "a new picture" as adding something),
 * called the wall's enemies only "attackers", and asked a muddled fire-hook question. Schema and
 * code are v4.12's, so only three template lines differ.
 */
type J = Record<string, unknown>;
const STAGES: readonly WriterStage[] = ["KS1", "KS2", "KS3-5"];
const KS = { KS1: "KS1", KS2: "KS2", "KS3-5": "KS3" } as const;
const dir = (v: string) => new URL(`./bundles/pilot-${v}-menu/`, import.meta.url);
const read = (v: string, name: string) => readFileSync(new URL(name, dir(v)), "utf8");
const STARTS = [
  "1. Flow. ",
  "The questions and tasks climb in demand",
  "Every line is written for the pupils who read it",
];

describe("pilot pack v4.13", () => {
  for (const stage of STAGES) {
    const ks = KS[stage];

    test(`${ks}: the assembled text is the pinned snapshot`, () => {
      expect(PILOT_PACKS["v4.13"].system[ks]).toBe(read("v4.13", `system-${ks}.snapshot.txt`));
    });

    test(`${ks}: the template is v4.12's with three lines changed`, () => {
      const old = read("v4.12", `system-${ks}.template.txt`).split("\n");
      const now = read("v4.13", `system-${ks}.template.txt`).split("\n");
      expect(now).toHaveLength(old.length);
      const changed = now.filter((l, i) => l !== old[i]);
      expect(changed.map((l) => STARTS.find((s) => l.startsWith(s)))).toEqual(STARTS);
      const text = changed.join("\n");
      // A new picture of a point already taught no longer counts as adding something.
      expect(text).toContain(
        "Each slide adds what the slides before it have not: a new idea, case or use of one;",
      );
      expect(text).not.toContain("a new idea, case, picture or use of one");
      expect(text).toContain(
        "A picture is new only when it shows a case, place or stage no earlier slide showed.",
      );
      expect(text).toContain("Two teaching slides never teach the same point");
      expect(text).toContain(
        "When it involves people, it names who they were by the name pupils of this age are taught for them",
      );
      expect(text).toContain(
        "Only when no such name exists does it say where they came from instead",
      );
      expect(text).toContain("The exit ticket asks one question per objective");
      expect(text).toContain(
        "Choose the everyday word a child of this age knows over a harder one",
      );
      expect(text).toContain("Decide each wrong belief before writing its option");
      expect(text).toContain("A question asks one clear thing");
      // Every v4.12 sentence of the two lines is kept, apart from the picture clause.
      for (const [i, l] of now.entries()) {
        if (l === old[i]) continue;
        for (const s of (old[i] as string).split(". ")) {
          expect(l).toContain(
            s.replace("a new idea, case, picture or use of one", "a new idea, case or use of one"),
          );
        }
      }
      expect(text).not.toMatch(/\b(Hadrian|Roman|London|firebreaks?|Picts?|Caledonians?)\b/i);
    });

    for (const [tier, range] of Object.entries(SLIDE_TIER_RANGES)) {
      test(`${ks} ${tier}: the request schema is v4.12's`, () => {
        const prod = writerSchema(stage, range);
        for (const exitTicketOnSlides of [true, false]) {
          const req = (v: "v4.12" | "v4.13") =>
            withClose(pilotRequest(v, stage, prod, (sc) => sc).schema, exitTicketOnSlides) as J;
          expect(req("v4.13")).toEqual(req("v4.12"));
        }
      });
    }
  }

  test("the paid check's Romans deck teaches each point once and names the raiders and asks one exit question per objective", () => {
    // gpt-6.1-sol, effort low, 26 Oct 2026, Y4 Hadrian's Wall Standard under this pack (10 slides).
    const slides = fixture.slides as { template: string; heading: string }[];
    const teach = slides.filter((s) => s.template === "visual-text");
    expect(new Set(teach.map((s) => s.heading)).size).toBe(teach.length);
    expect(JSON.stringify(fixture.slides)).toMatch(/Britons living north of the wall/);
    expect(fixture.close.items).toHaveLength(3);
    expect(JSON.stringify(fixture.slides)).not.toMatch(/\battackers\b/);
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
        pilotPack: "v4.13",
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
    expect(a.head).toContain("A question asks one clear thing");
  });

  test("a Detailed lesson's output cap keeps at least 40% headroom at v4.13's measured need", () => {
    // Paid checks, 26 Oct: v4.13 wrote 13 / 13 / 10 / 10 slides in 2,231 / 2,226 / 2,108 / 2,278
    // (and 2,469 / 2,583 at 10 after the naming and exit-ticket lines)
    // output tokens (reasoning included), at most 259 a slide (Romans, 10 slides), about 4,133 at 16.
    const need16 = Math.ceil((2583 / 10) * 16);
    expect(writerMaxTokens(16)).toBeGreaterThanOrEqual(Math.ceil(need16 / 0.6));
  });
});
