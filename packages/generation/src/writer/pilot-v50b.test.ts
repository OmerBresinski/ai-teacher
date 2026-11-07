import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { writerBrief } from "../stages/write";
import { sampleBriefLesson } from "../testing";
import { writerSystem } from "./ai-services";
import {
  PILOT_PACK_ID,
  PILOT_PACK_LIVE,
  PILOT_PACKS,
  packFromEnv,
  packRepairMenu,
  packWriter,
  pilotRequest,
} from "./pilot-pack";
import { V50A_MENU_LINES } from "./pilot-v50a";
import type { WriterReq, WriterServices } from "./services";
import { runWriter } from "./stage";
import { waveCMenu } from "./wave-c";

/*
 * Pilot pack v5.0b (6 Nov 2026, test runs only): v5.0a's code checks, run on v5.0b, then v5.0b's own
 * one change (below). v5.0a's checks: every key stage builds,
 * the schema is v4.17's exactly, every limit code checks reaches the model unchanged, and the live
 * pack: with TJ_PILOT_PACK unset production runs PILOT_PACK_LIVE (v5.0b since 7 Nov; revert v4.17).
 */
type J = Record<string, any>;
const KS = ["KS1", "KS2", "KS3"] as const;
const v417 = (ks: string) =>
  readFileSync(
    new URL(`bundles/pilot-v4.17-menu/system-${ks}.snapshot.txt`, import.meta.url),
    "utf8",
  );
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const fitsOf = (text: string) => text.match(/Fits: [^\n]*/g) ?? [];
// The prod-schema stand-ins every pilot test uses: a flow and slide range, a teaches enum.
const prod: J = {
  properties: {
    flow: { minItems: 9, maxItems: 13, items: { properties: { teaches: { type: "string" } } } },
    slides: { minItems: 6, maxItems: 10 },
  },
};

describe("the live pack", () => {
  test("TJ_PILOT_PACK unset: production runs v5.0b", () => {
    expect(process.env.TJ_PILOT_PACK ?? "").toBe("");
    expect(PILOT_PACK_LIVE).toBe("v5.0b");
    expect(PILOT_PACK_ID).toBe("v5.0b");
  });

  test("the selector: unset or empty is live, a pack id is that pack, a typo throws", () => {
    expect(packFromEnv(undefined, "v4.17")).toBe("v4.17");
    expect(packFromEnv("", "v4.17")).toBe("v4.17");
    expect(packFromEnv("v5.0b", "v4.17")).toBe("v5.0b");
    expect(packFromEnv("v5.0a", "v4.17")).toBe("v5.0a");
    expect(() => packFromEnv("v5.0", "v4.17")).toThrow("no pilot pack v5.0");
  });

  for (const ks of KS)
    test(`${ks}: v4.17's system text is byte-identical to its snapshot`, () => {
      expect(sha(PILOT_PACKS["v4.17"].system[ks])).toBe(sha(v417(ks)));
      expect(pilotRequest("v4.17", ks, prod, (s) => s).system).toBe(v417(ks));
    });
});

describe("v5.0b builds at every key stage", () => {
  for (const ks of KS) {
    const text = PILOT_PACKS["v5.0b"].system[ks];
    const live = v417(ks);

    test(`${ks}: assembled, no slot left, each menu line once with its new prose`, () => {
      expect(text).not.toContain("{{");
      for (const [layout, line] of Object.entries(V50A_MENU_LINES)) {
        expect(text.split(`\n- ${layout}: `).length, layout).toBe(2);
        expect(text).toContain(`\n- ${layout}: ${line} Fits: `);
      }
    });

    test(`${ks}: every Fits clause of v4.17 reaches the model unchanged`, () => {
      expect(fitsOf(text).sort()).toEqual(fitsOf(live).sort());
    });

    test(`${ks}: the diagram kinds and fill shapes are v4.17's, byte for byte`, () => {
      const tail = (s: string) => s.slice(s.indexOf("Diagram kinds:"));
      expect(tail(text)).toBe(tail(live));
    });

    test(`${ks}: the constraints code cannot repair are stated`, () => {
      for (const must of [
        "Nothing else on its slide gives the answer away.",
        "Code reveals the answer on a click, so no heading, instruction, label or picture gives it.",
        "the correct option comes first (code shuffles them)",
        "The slide draws list numbers, bullets and option letters, so each item is its text alone.",
        "A word count is a ceiling, not a target.",
        "The flow is final: add no slide it does not list.",
        "Words and labels go on the slide, not in the picture.",
        "never one year as both ends",
        "Answers on question-set, practice and exit-ticket are what a pupil should write",
      ])
        expect(text, must).toContain(must);
    });

    test(`${ks}: under 60% of v4.17's length (the code-kept floor is about 25%)`, () => {
      expect(text.length).toBeLessThan(live.length * 0.6);
    });
  }
});

describe("v5.0b's schema and writer are v4.17's", () => {
  for (const ks of KS)
    test(`${ks}: the request schema and caps are identical`, () => {
      const a = pilotRequest("v4.17", ks, prod, (s) => s);
      const b = pilotRequest("v5.0b", ks, prod, (s) => s);
      expect(JSON.stringify(b.schema)).toBe(JSON.stringify(a.schema));
      expect(JSON.stringify(b.caps ?? null)).toBe(JSON.stringify(a.caps ?? null));
      expect(b.system).toBe(PILOT_PACKS["v5.0b"].system[ks]);
    });

  test("same writer model and effort", () => {
    expect(packWriter("v5.0b")).toEqual(packWriter("v4.17"));
  });

  test("every switch but the system text matches v4.17", () => {
    const { system: _a, id: _i, ...a } = PILOT_PACKS["v4.17"] as J;
    const { system: _b, id: _j, ...b } = PILOT_PACKS["v5.0b"] as J;
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});

/*
 * The real request path (runWriter, stage.ts): libSystem splices the Models list after the diagram
 * kinds, withWaveCLibrary needs the model line once and a "\nKey cards. " line to put step-model's
 * line before, packRepairMenu needs the "Layouts. " line, and ai-services splits the text at the
 * Models header. The first paid v5.0a run threw in withWaveCLibrary ("Key cards:"), so each stage is
 * run here with library models on and off, stopping at the writer call.
 */
describe("v5.0b through runWriter's request path", () => {
  const LESSONS = [
    {
      ks: "KS1",
      stage: "KS1",
      yearGroup: "Year 2",
      ageBand: "ks1",
      subject: "History",
      obj: "Say where and when the Great Fire of London began.",
    },
    {
      ks: "KS2",
      stage: "KS2",
      yearGroup: "Year 4",
      ageBand: "ks2",
      subject: "History",
      obj: "Explain why the Romans built Hadrian's Wall.",
    },
    {
      ks: "KS3",
      stage: "KS3-5",
      yearGroup: "Year 8",
      ageBand: "ks3",
      subject: "Science",
      obj: "Describe how plants make glucose by photosynthesis.",
    },
  ] as const;
  const request = async (
    pack: "v5.0b" | "v4.17",
    l: (typeof LESSONS)[number],
    library: boolean,
  ) => {
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
    const lesson = sampleBriefLesson({
      yearGroup: l.yearGroup,
      ageBand: l.ageBand,
      subject: l.subject,
    } as never);
    let thrown: unknown;
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
    } as never).catch((e) => {
      thrown = e;
    });
    if (!got) throw new Error(`no writer request: ${String((thrown as Error)?.message ?? thrown)}`);
    return got.system;
  };
  for (const l of LESSONS) {
    test(`${l.ks}: with library models the request builds, and the model and step-model lines land`, async () => {
      const sys = await request("v5.0b", l, true);
      expect(sys).toContain("\nModels (id");
      const stepModel = waveCMenu(l.stage)["steps step-model"] ?? "";
      expect(stepModel.length).toBeGreaterThan(0);
      expect(sys.split("\n")).toContain(stepModel);
      expect(sys.indexOf(stepModel)).toBeLessThan(sys.indexOf("\nKey cards. "));
      expect(sys).toContain(
        "unless figure-slide or steps step-model takes it, as their lines say.",
      );
      expect(writerSystem(sys).length).toBe(2);
      expect(packRepairMenu(sys, ["hinge", "explain"])).toContain("\n- hinge: ");
      // Same splices as the live pack: v5.0b's text up to the Models list is its own pack text.
      const live = await request("v4.17", l, true);
      expect(live.split("\n")).toContain(stepModel);
    });
    test(`${l.ks}: without library models the request builds with no Models list or step-model line`, async () => {
      const sys = await request("v5.0b", l, false);
      expect(sys).not.toContain("\nModels (id");
      expect(sys.split("\n")).not.toContain(waveCMenu(l.stage)["steps step-model"] ?? "");
      expect(sys).toBe(PILOT_PACKS["v5.0b"].system[l.ks]);
    });
  }
});

/*
 * v5.0b's one change (6 Nov 2026, HOLD on split in the v5.0a promotion round): "one idea a slide" says
 * the members of one list are one idea on one slide, at KS2 and KS3 only (ruling 306 lets Years 1 and 2
 * give each member its own slide, so KS1 is v5.0a's byte for byte). The length is paid for by two
 * phrases the brief already says elsewhere and a write-time "two slides" that step 2 and step 3 cover.
 */
const ONE_IDEA = {
  was: "- Has one idea a slide. The slide's own words teach it, as a good teacher of this year group would: the facts a pupil needs, each concrete (a name, a date, a place, a number, a real example), in plain words a pupil of this age knows, and stops when the idea is taught. Each slide adds what the slides before it have not. How the teacher runs a slide goes in its notes.",
  now: "- Has one idea a slide, taught in the slide's own words: the facts a pupil needs, each concrete (a name, date, place, number or real example), stopping when it is taught. The members of one list (the reasons for one why, the kinds, the parts) are one idea on one slide, never a slide each; a member pupils must see may take a picture slide after. Each slide adds what earlier slides have not. How the teacher runs a slide goes in its notes.",
};
const SQUEEZE = {
  was: "; a hinge option or a card label may be a phrase. An idea that will not fit its words takes a roomier fit or two slides, never a squeezed sentence.",
  now: ", never squeezed to fit; a hinge option or a card label may be a phrase.",
};

describe("v5.0b is v5.0a with one change", () => {
  test("KS1: byte-identical to v5.0a (ruling 306)", () => {
    expect(PILOT_PACKS["v5.0b"].system.KS1).toBe(PILOT_PACKS["v5.0a"].system.KS1);
  });

  for (const ks of ["KS2", "KS3"] as const)
    test(`${ks}: only the one-idea bullet and the squeeze clause differ, and it is no longer`, () => {
      const a = PILOT_PACKS["v5.0a"].system[ks];
      const b = PILOT_PACKS["v5.0b"].system[ks];
      expect(b.split(ONE_IDEA.now).length).toBe(2);
      expect(b.split(SQUEEZE.now).length).toBe(2);
      expect(b).not.toContain("never a squeezed sentence");
      expect(b.replace(ONE_IDEA.now, ONE_IDEA.was).replace(SQUEEZE.now, SQUEEZE.was)).toBe(a);
      expect(b.length).toBeLessThanOrEqual(a.length);
    });
});
