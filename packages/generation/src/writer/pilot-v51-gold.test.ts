import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { KEY_FIT, PT_CAPS } from "@tj/slides/templates/picture-text";
import { writerBrief } from "../stages/write";
import { sampleBriefLesson } from "../testing";
import { fitSlots, headingWords } from "./fit-fits";
import { fitTable } from "./fixes";
import { NO_FIGURE, normalise } from "./materialise";
import { PILOT_PACK_ID, PILOT_PACK_LIVE, PILOT_PACKS, type PilotPackId } from "./pilot-pack";
import { v51Heading, v51Routed, v51Slots } from "./pilot-v51-gold";
import type { WriterStage } from "./schema";
import type { WriterReq, WriterServices } from "./services";
import { runWriter } from "./stage";

/*
 * Pilot pack v5.1-gold (11 Nov 2026): wired as a new id only. The live pack's three system texts
 * stay byte-identical to origin/master 55e777fb2 (scratchpad/tuning/v5.0b/system-KS*.txt), and the
 * new pack's every stated limit is the gold table's.
 */
const V50B_SHA256 = {
  KS1: "40a6287736e7774ab10d2a1edb705bdc9f019c3f825de40e89183799dea5ecb1",
  KS2: "949880649b72c58e8b0eea6f9a4dd3d40b30510934b930cbb7f1c9d63c3b593e",
  KS3: "710bb97f9edc1c33be472696def916fb2f7679fcc80f92f7e0b7d80b210c7838",
} as const;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const STAGES: [keyof typeof V50B_SHA256, WriterStage][] = [
  ["KS1", "KS1"],
  ["KS2", "KS2"],
  ["KS3", "KS3-5"],
];

describe("v5.0b stays as shipped", () => {
  test("the live pack is still v5.0b and its system texts are master's bytes", () => {
    expect(PILOT_PACK_LIVE).toBe("v5.0b");
    if (!process.env.TJ_PILOT_PACK) expect(PILOT_PACK_ID).toBe("v5.0b");
    for (const [ks] of STAGES) expect(sha(PILOT_PACKS["v5.0b"].system[ks])).toBe(V50B_SHA256[ks]);
  });
  test("the frozen fit table is still the default; the gold one only on request", () => {
    expect(fitTable().KS2?.heading).toBe(68);
    expect(fitTable({ gold: true }).KS2?.heading).toBe(160);
  });
});

describe("v5.1-gold system text", () => {
  for (const [ks, stage] of STAGES) {
    const text = PILOT_PACKS["v5.1-gold"].system[ks];
    test(`${ks}: every slot filled, no retired layout described`, () => {
      expect(text).not.toContain("{{");
      for (const gone of ["explain", "big-visual", "picture-sequence", "points-1-key-fig"])
        expect(text).not.toContain(`\n- ${gone}:`);
      expect(text.includes("\n- equation-hero:")).toBe(stage !== "KS1");
      expect(text).not.toMatch(/Fits: as (explain|big-visual|picture-sequence)/);
    });
    test(`${ks}: each stated limit is the gold table's`, () => {
      const s = v51Slots(stage);
      const pt = PT_CAPS[stage];
      expect(s.heading).toBe(String(Math.min(pt.title, headingWords(stage))));
      expect(text).toContain(`a heading with no number there is up to ${v51Heading(stage)} words`);
      // Picture and text: the gold title, then the gold fit table's Fits as code generates them.
      const gold = fitSlots(stage, v51Routed(stage), { gold: true })["visual-text"] as string;
      expect(s["visual-text"]).toBe(
        gold.replace(/^Fits: /, `Fits: heading up to ${pt.title} words; `),
      );
      expect(text).toContain(s["visual-text"] as string);
      // Key card: the gold key-card look's measured lead, meaning and card count.
      const kf = KEY_FIT[stage];
      expect(s["key-card"]).toContain(`the lead up to ${kf.words["1"]} words`);
      expect(s["key-card"]).toContain(`a meaning up to ${kf.words["1"]} words`);
      expect(s["key-card"]).toContain(kf.cards === 1 ? "; one card;" : `up to ${kf.cards} cards`);
      if (stage !== "KS1") {
        const F = fitTable({ gold: true })[stage] as unknown as { formula: number };
        expect(s["equation-hero"]).toContain(`the formula up to ${F.formula} characters`);
      }
      expect(s.worked).toContain("the check counted");
      expect(s["items-row"]).not.toContain("with a lead");
    });
  }
  test("the old Fits differ where the gold numbers moved (KS2 lead 22 -> gold)", () => {
    const old = fitSlots("KS2")["visual-text"];
    const gold = fitSlots("KS2", v51Routed("KS2"), { gold: true })["visual-text"];
    expect(old).toContain("points-0-fig 22");
    expect(gold).not.toBe(old);
  });
});

describe("normalise: a null visual-text figure", () => {
  const slide = {
    template: "visual-text",
    heading: "Roots",
    lead: "Roots take in water.",
    points: [],
  };
  test("written by v5.1-gold (marked at arrival): the gold picture-and-text, no figure", () => {
    const out = normalise({ ...slide, figure: null, [NO_FIGURE]: true });
    expect(out.template).toBe("picture-text");
    expect(NO_FIGURE in out).toBe(false);
  });
  test("any other null figure (a lost-figure fallback, older JSON) lays out as before", () => {
    expect(normalise({ ...slide, figure: null }).template).toBe("explain");
  });
});

/** The writer request on the real path (as prompt-budget.test), stopped at the writer call. */
async function writerRequest(
  pack: PilotPackId,
  l: { yearGroup: string; ageBand: string; subject: string; obj: string },
  library: boolean,
): Promise<WriterReq> {
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
  const lesson = sampleBriefLesson(l as never);
  await runWriter({
    brief: writerBrief(lesson),
    objectives: [l.obj],
    services,
    pilotPack: pack,
    drawDiagrams: { callDrawer: async () => ({ out: undefined, usd: 0, ms: 0 }) },
    library,
    libraryMenuFilter: true,
    libraryMenuRank: true,
    libraryModelBody: true,
    libraryPanelsOff: true,
    checks: "log",
  } as never).catch(() => {});
  if (!got) throw new Error("no writer request");
  return got;
}

const LESSONS = [
  {
    ks: "KS1",
    yearGroup: "Year 2",
    ageBand: "ks1",
    subject: "History",
    obj: "Say where and when the Great Fire of London began.",
  },
  {
    ks: "KS2",
    yearGroup: "Year 5",
    ageBand: "ks2",
    subject: "Maths",
    obj: "Add fractions with the same denominator.",
  },
  {
    ks: "KS3",
    yearGroup: "Year 9",
    ageBand: "ks3",
    subject: "Maths",
    obj: "Solve two-step linear equations.",
  },
] as const;

describe("v5.1-gold request (real path, no model call)", () => {
  let modelsSeen = 0;
  for (const l of LESSONS)
    for (const library of [false, true])
      test(`${l.ks} library ${library ? "on" : "off"}: schema and text agree`, async () => {
        const r = await writerRequest("v5.1-gold", l, library);
        expect(r.system).not.toContain("{{");
        const flow = (r.schema as any).properties.flow.items.properties;
        const layouts: string[] = flow.layout.enum;
        for (const gone of [
          "explain",
          "big-visual",
          "picture-sequence",
          "visual-text points-1-key-fig",
          "visual-text points-2-key-fig",
        ])
          expect(layouts.some((x) => x === gone || x.startsWith(`${gone} `))).toBe(false);
        expect(layouts.some((x) => x.startsWith("equation-hero"))).toBe(l.ks !== "KS1");
        if (l.ks !== "KS1") expect(layouts).toContain("equation-hero points-2");
        expect(flow.look_at.properties.kind.enum).not.toContain("picture-sequence");
        const defs = (r.schema as any).$defs;
        for (const k of ["visual-text~points-0-fig", "visual-text~key-card-fig"])
          expect(JSON.stringify(defs[k].properties.figure)).toContain('{"type":"null"}');
        if (r.system.includes("\nModels (id")) {
          modelsSeen += 1;
          expect(r.system).toContain("A model fills the lesson's one figure-slide");
          expect(r.system).not.toContain("a model always fills");
          const lines = r.system.split("\n");
          const at = lines.findIndex((x) => x.startsWith("- steps: "));
          expect(
            lines[at + 1]?.startsWith("- steps step-model: show one step of a practical"),
          ).toBe(true);
          expect(lines[at + 1]).toContain("Fits: do up to");
        }
      });
  test("at least one lesson carried a Models list (so the model lines were exercised)", () => {
    expect(modelsSeen).toBeGreaterThan(0);
  });
  test("v5.0b's request keeps the library model line as it was", async () => {
    const r = await writerRequest("v5.0b", LESSONS[1], true);
    if (r.system.includes("\nModels (id"))
      expect(r.system).toContain("unless figure-slide or steps step-model takes it");
    expect(r.system).not.toContain("A model fills the lesson's one figure-slide");
  });
});
