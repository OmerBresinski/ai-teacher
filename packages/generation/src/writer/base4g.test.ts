import { describe, expect, test } from "bun:test";
import type { Lesson } from "@tj/domain/documents";
import { isThemeId } from "@tj/slides";
import { writerObjectivesUser } from "../stages/objectives";
import { writerBrief } from "../stages/write";
import { sampleBriefLesson } from "../testing";
import { WRITER_BUNDLE_ID, type WriterBundleId, writerBundle } from "./bundle";
import { contractSystem, PINNED_LINES } from "./contract";
import fixture from "./fixtures/activities/y1-animals.json" with { type: "json" };
import { writerSchema } from "./schema";
import type { WriterReq, WriterServices } from "./services";
import { runWriter } from "./stage";

/*
 * base4g: base4f-p123 plus slot-fill (lab/slotfill round 2), the anatomy routing (t-anatomy
 * PROPOSAL.md C), the practice example cut (E), the curriculum block (F1) and the planner's
 * theme (ruling 202). Production stays on base4f-p123 until Greg switches WRITER_BUNDLE_ID.
 */

type J = Record<string, unknown>;
const SYSTEMS = ["systemKS1", "systemKS2", "systemKS3_5"] as const;
/** The only edits to each writer system text, verbatim; the theme list and practice example go. */
const SYSTEM_EDITS: [string, string][] = [
  [
    "1. Design. Choose the lesson's theme and picture style from the lists below,",
    "1. Design. Choose the lesson's picture style from the list below,",
  ],
  [
    "(a picture, a sequence of pictures, a diagram, or none)",
    "(a picture, picture sequence or diagram; none only if no visual would teach)",
  ],
  [
    "- photo: real photographs, for real-world science, geography, sources and artefacts.\n- illustration: painted pictures, for stories, imagined scenes and lessons with little a camera could show.\nA historical person or artefact is always a real image, whichever style the lesson has.\n",
    "- photo: real photographs of what a camera can show.\n- illustration: painted pictures, for stories, imagined scenes and things hidden inside or too small to see.\n",
  ],
  [PINNED_LINES.labelled, PINNED_LINES.labelledRoute],
  // HEART1 R3 (c, e): the title picture shows the topic in colour; the objectives restatement goes.
  [
    "Slide 1 is the title and slide 2 is the objectives, which code fills from the approved objectives.",
    "Slide 1 is the title and slide 2 the objectives.",
  ],
  [
    "a subtitle line, and a picture if one helps.",
    "a subtitle line, and a colour picture of what the title names, not a scene from the subtitle.",
  ],
];

describe("base4g against base4f-p123", () => {
  const a = writerBundle("base4f-p123") as unknown as Record<string, string>;
  const g = writerBundle("base4g") as unknown as Record<string, string>;

  test("the writer system texts differ only by the listed edits", () => {
    for (const k of SYSTEMS) {
      let want = a[k] as string;
      for (const [from, to] of SYSTEM_EDITS) {
        expect(want.split(from).length).toBe(2);
        want = want.replace(from, to);
      }
      want = want
        .replace(/\nThemes:\n(- [a-z-]+: [^\n]*\n)+/, "")
        .replace(/\n\{"template":"practice","heading":"Work out the speed"[^\n]*\}/, "");
      expect(g[k]).toBe(want);
    }
  });

  test("the objectives call gains the curriculum block and the theme; nothing else changes", () => {
    const skip = new Set([...SYSTEMS, "objectives", "objectivesUser", "objectivesSchema"]);
    for (const k of Object.keys(a)) {
      if (["id", "pins", "tHash", "features"].includes(k) || skip.has(k as never)) continue;
      expect(g[k]).toEqual(a[k]);
    }
    expect(g.objectivesUser).toBe(`${a.objectivesUser}\n{{curriculum}}`);
    expect(g.objectives).toContain("Within that, they cover each listed curriculum statement");
    expect(g.objectives).not.toContain("Each is one objective that a single lesson");
    const s = JSON.parse(g.objectivesSchema as string) as J;
    expect(s.required).toEqual(["objectives", "theme"]);
    const ids = ((s.properties as J).theme as { enum: string[] }).enum;
    // The planner picks from the live catalogue; chalk is retired (ruling 202), and the
    // room-led themes (night-lab, beacon) stay the teacher's choice.
    expect(ids).not.toContain("chalk");
    for (const id of ids) {
      expect(isThemeId(id)).toBe(true);
      expect(g.objectives).toContain(`\n- ${id}: `);
    }
  });

  test("its features: slot-fill on, the writer's design has no theme", () => {
    expect(writerBundle("base4g").features).toEqual({ slotFill: true, planTheme: true });
    expect(writerBundle("base4f-p123").features).toBeUndefined();
    const design = (st: WriterBundleId) =>
      (writerSchema("KS2", { min: 9, max: 12 }, writerBundle(st)).properties as J).design as J;
    expect(Object.keys(design("base4g").properties as J)).toEqual(["picture_style"]);
    expect(Object.keys(design("base4f-p123").properties as J)).toEqual(["theme", "picture_style"]);
  });

  test("the contract swaps the routed labelled line, from the drawer's limits", () => {
    for (const k of SYSTEMS) {
      const out = contractSystem(g[k] as string);
      expect(out).not.toContain(PINNED_LINES.labelledRoute);
      expect(out).toMatch(
        /- labelled-diagram: a drawing of one object with up to \d+ parts labelled, [^\n]*; a structure hidden inside or too small to see, or a route through it, is a picture\.\n/,
      );
    }
  });

  test("HEART1 R3: a route through a body goes to a picture, not the drawer's flow or cycle", () => {
    // R3 s5 drew a blood route as a labelled-diagram, and the old clause sent routes to flow or
    // cycle, both drawn free-hand. Only the labelled line changes; flow and cycle keep their lines.
    for (const k of SYSTEMS) {
      const out = contractSystem(g[k] as string);
      expect(out).not.toContain("a route or process is a flow or cycle");
      expect(out).toContain("or a route through it, is a picture.");
      expect(out).toContain("- flow: boxes joined by arrows");
      expect(out).toContain("- cycle: stages that loop back to the start.");
      expect(out).toContain(
        "a colour picture of what the title names, not a scene from the subtitle.",
      );
      expect(contractSystem(a[k] as string)).toContain(
        "a subtitle line, and a picture if one helps.",
      );
      // The trimmed "Slide 1 ..." sentence no longer says code fills slide 2; the objectives
      // layout line still does, so the writer is still told it writes nothing there.
      expect(out).toContain("Slide 1 is the title and slide 2 the objectives.");
      expect(out).toContain(
        "- objectives: slide 2, its own field before slides: code fills it from the approved objectives, so it has nothing to write.",
      );
    }
  });

  test("production still ships base4f-p123", () => expect(WRITER_BUNDLE_ID).toBe("base4f-p123"));
});

describe("the compiled writer request, base4g against base4f-p123", () => {
  const lesson = (yearGroup: string, ageBand: Lesson["ageBand"]): Lesson =>
    sampleBriefLesson({ yearGroup, ageBand, readingLevel: yearGroup });
  const req = async (bundle: WriterBundleId, l: Lesson) => {
    let writer: WriterReq | undefined;
    const services: WriterServices = {
      log: () => {},
      writer: async (r) => {
        writer = r;
        return { text: JSON.stringify(fixture.main), usd: 0, ms: 1, finishReason: "stop" } as never;
      },
      chat: async () => {
        throw new Error("no answers in this run");
      },
    };
    await runWriter({ brief: writerBrief(l), objectives: fixture.objectives, services, bundle });
    if (!writer) throw new Error("no writer call");
    return writer;
  };
  const CASES: [string, Lesson][] = [
    ["KS1", lesson("Year 2", "ks1")],
    ["KS2", lesson("Year 6", "ks2")],
    ["KS3-5", lesson("Year 9", "ks3")],
  ];

  test.each(CASES)("%s: the system text is no longer (Greg: no bloat)", async (_st, l) => {
    const old = await req("base4f-p123", l);
    const neu = await req("base4g", l);
    expect(neu.system.length).toBeLessThanOrEqual(old.system.length);
    // Slot-fill's wording is in, the replaced lines are gone, and no topic noun leaks in.
    expect(neu.system).toContain("then its shape (one idea,");
    expect(neu.system).toContain("Each slide carries one idea its Fits hold");
    expect(neu.system).not.toMatch(/Fits: [^\n]*\bline/);
    expect(neu.system).not.toContain("Themes:");
    expect(neu.system).not.toMatch(/\b(heart|blood|cell|eye)\b/i);
  });

  test("an old output (no fit) still lays every slide under base4g", async () => {
    const l = lesson("Year 1", "ks1");
    const run = async (bundle: WriterBundleId) => {
      const events: J[] = [];
      const services: WriterServices = {
        log: (e) => events.push(e as J),
        writer: async () =>
          ({ text: JSON.stringify(fixture.main), usd: 0, ms: 1, finishReason: "stop" }) as never,
        chat: async () => {
          throw new Error("no answers in this run");
        },
      };
      const out = await runWriter({
        brief: writerBrief(l),
        objectives: fixture.objectives,
        services,
        bundle,
      });
      return { out, events };
    };
    const off = await run("base4f-p123");
    const on = await run("base4g");
    expect(on.out.slides.length).toBe(off.out.slides.length);
    const sf = on.events.filter((e) => e.ev === "slot-fill");
    expect(sf.length).toBeGreaterThan(0);
    for (const e of sf) expect(e.breaches).toEqual(["fit: missing"]);
  });
});

describe("base4g's objectives user turn", () => {
  test("carries the year's statutory statements for the subject", () => {
    const l = sampleBriefLesson({ yearGroup: "Year 6", ageBand: "ks2", subject: "Science" });
    const filled = writerObjectivesUser(l, writerBundle("base4g").objectivesUser);
    expect(filled).toContain("Curriculum statements (statutory, Year 6 science):");
  });
});
