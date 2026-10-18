import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { MenuWordCaps } from "../src/writer/layout-menu";
import { PILOT_PACK_ID } from "../src/writer/pilot-pack";
import type { WriterStage } from "../src/writer/schema";
import {
  deckFields,
  type FieldFill,
  fillReport,
  fillStats,
  menuSlideFields,
  PLAN_SHAPES,
  parseSize,
  planFit,
  type WriterEvent,
} from "./fill";

/*
 * Two saved live writer outputs on the v4.7 menu (lab voice-r2 A, 16 Oct 2026), with the stage's
 * own events. The expected numbers are what the lab's fill.py printed on the same two files with
 * master's v4.7 snapshots as its caps (`fill.py <dir> --system-dir bundles/pilot-v4.7-menu`):
 * 44 body fields, 18% at 90-100%, 2% over, median 75%; crammed: forces s5 over cap, forces s7 and
 * romans s6 dense. fill.py never scored the close; this port does.
 */
const DIR = join(import.meta.dir, "fixtures", "writer-fill");
const LESSONS: [string, WriterStage][] = [
  ["a-hinge-y9-forces", "KS3-5"],
  ["y4-romans", "KS2"],
];
/**
 * The v4.7 menu's caps, as master's `menuWordCaps` returned them at 0db793cbc (before TEACH-110
 * part ae showed 75% of each measured cap): the menu these two decks were written against and the
 * caps fill.py scored them with. Live scoring reads the current menu (`menuWordCaps`).
 */
const V47 = JSON.parse(readFileSync(join(DIR, "menu-word-caps-v4.7.json"), "utf8")) as Record<
  "KS2" | "KS3-5",
  MenuWordCaps
>;
const v47 = (stage: WriterStage) => V47[stage as "KS2" | "KS3-5"];
const load = (id: string) => ({
  writer: JSON.parse(readFileSync(join(DIR, `${id}.writer-raw.txt`), "utf8")) as Record<
    string,
    unknown
  >,
  events: readFileSync(join(DIR, `${id}.events.jsonl`), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as WriterEvent),
});

function pooled(withClose: boolean) {
  const fields: FieldFill[] = [];
  const events: WriterEvent[] = [];
  for (const [id, stage] of LESSONS) {
    const { writer, events: ev } = load(id);
    const last = (writer.slides as unknown[]).length + 2;
    for (const f of deckFields(writer, stage, ev, id, v47(stage)))
      if (withClose || f.slide <= last) fields.push(f);
    for (const e of ev) events.push({ ...e, lesson: id });
  }
  return { fields, events };
}

describe("fill score (fill.py port, caps from the menu data)", () => {
  test("matches fill.py on the same slides", () => {
    const { fields, events } = pooled(false);
    const r = fillReport(fields, events);
    expect(r.body.fields).toBe(44);
    expect(r.body.nearCapPct).toBe(18.2);
    expect(r.body.overPct).toBe(2.3);
    expect(r.body.medianFillPct).toBe(75);
    expect(Object.fromEntries(Object.entries(r.byLayout).map(([t, s]) => [t, s.fields]))).toEqual({
      "visual-text": 19,
      "equation-hero": 4,
      practice: 9,
      hinge: 8,
      "panel-list": 4,
    });
    const F = "a-hinge-y9-forces";
    expect(r.crammed).toEqual([
      { lesson: F, slide: 5, template: "equation-hero", why: "over cap" },
      { lesson: F, slide: 7, template: "visual-text", why: "dense" },
      { lesson: "y4-romans", slide: 6, template: "visual-text", why: "dense" },
    ]);
    // forces s5: slot-fill blamed the writer (formula 40 characters, room 28).
    expect(r.clippedSlides).toEqual([{ lesson: F, slide: 5 }]);
  });

  test("scores the close (exit ticket) too, against the menu's cap for its count", () => {
    const { writer, events } = load("y4-romans");
    const close = deckFields(writer, "KS2", events, "", v47("KS2")).filter(
      (f) => f.template === "exit-ticket",
    );
    expect(close.map((f) => `${f.path} ${f.words}/${f.cap}`)).toEqual([
      "items[0].question 8/13",
      "items[1].question 8/13",
      "items[2].question 11/13",
    ]);
    expect(pooled(true).fields.length).toBeGreaterThan(pooled(false).fields.length);
  });

  test("covers every menu layout's field kinds, caps read from the menu's data", () => {
    // menuWordCaps' shape, with the v4.7 numbers; menu-word-caps.test pins today's to the menu text.
    const caps = v47("KS2");
    const w = (n: number) => Array.from({ length: n }, () => "word").join(" ");
    const kinds = (s: Record<string, unknown>) =>
      menuSlideFields(s, caps)?.map((f) => `${f.path}:${f.words}/${f.cap}`);
    expect(
      kinds({
        template: "hinge",
        heading: w(10),
        options: [{ text: w(9) }, { text: w(3) }, { text: "x", icon: "sun" }],
      }),
    ).toEqual(["heading(question):10/16", "options[0]:9/9", "options[1]:3/9", "options[2]:1/2"]);
    expect(
      kinds({
        template: "practice",
        picture: { shows: "x" },
        items: [{ question: w(9) }, { question: w(10) }, { question: w(2) }],
      }),
    ).toEqual(["items[0].question:9/9", "items[1].question:10/9", "items[2].question:2/9"]);
    expect(
      kinds({
        template: "question-set",
        items: [1, 2, 3].map(() => ({ question: w(5), answer: w(2) })),
      }),
    ).toContain("items[2].answer:2/4");
    expect(kinds({ template: "exit-ticket", items: [{ question: w(30) }] })).toEqual([
      "items[0].question:30/25",
    ]);
    expect(
      kinds({
        template: "split-compare",
        sides: [
          { title: w(3), text: w(7), picture: {} },
          { title: w(2), text: w(9), picture: {} },
        ],
      }),
    ).toEqual([
      "sides[0].title:3/3",
      "sides[0].text:7/8",
      "sides[1].title:2/3",
      "sides[1].text:9/8",
    ]);
    expect(
      kinds({
        template: "panel-list",
        heading: w(3),
        lead: w(6),
        items: [1, 2, 3, 4].map(() => ({ text: w(4), picture: {} })),
      }),
      // Four picture rows beside a lead: 4 words each in the 313 column (TEACH-205 part d).
    ).toEqual(["heading:3/3", "lead:6/6", ...[0, 1, 2, 3].map((i) => `items[${i}].text:4/4`)]);
    expect(
      kinds({
        template: "items-row",
        heading: w(5),
        items: [1, 2, 3].map(() => ({ text: w(11), icon: "x" })),
      }),
    ).toEqual(["heading:5/5", ...[0, 1, 2].map((i) => `items[${i}].text:11/11`)]);
    // A count the menu never offers has no cap, and is left out of the score.
    expect(
      menuSlideFields(
        { template: "exit-ticket", items: [1, 2, 3, 4].map(() => ({ question: "q" })) },
        caps,
      )?.[0],
    ).toMatchObject({ path: "items[0].question", cap: undefined });
    expect(menuSlideFields({ template: "explain" }, caps)).toBeNull();
  });

  test("bands: exactly at cap is near-cap, past it is over", () => {
    const s = fillStats([0.4, 0.6, 0.8, 0.9, 1, 1.2]);
    expect(s.buckets).toEqual({
      "<50": 16.7,
      "50-70": 16.7,
      "70-90": 16.7,
      "90-100": 33.3,
      ">100": 16.7,
    });
    expect(s.overPct).toBe(16.7);
    expect(s.medianFillPct).toBe(85);
    expect(fillStats([]).medianFillPct).toBeNull();
  });
});

describe("plan-only fit check", () => {
  test("is labelled approximate, and every shape it maps is still in the writer prompt", () => {
    expect(planFit([], "KS2").approximate).toBe(true);
    for (const ks of ["KS1", "KS2", "KS3"]) {
      const system = readFileSync(
        join(
          import.meta.dir,
          "..",
          "src",
          "writer",
          "bundles",
          `pilot-${PILOT_PACK_ID}-menu`,
          `system-${ks}.snapshot.txt`,
        ),
        "utf8",
      );
      for (const shape of Object.values(PLAN_SHAPES)) expect(system).toContain(shape);
    }
  });

  test("reads the planned count and words and checks them against the layout's cap", () => {
    const { writer } = load("y4-romans");
    const r = planFit(writer.flow, "KS2", v47("KS2"));
    expect(r.planned).toBe(10);
    expect(r.counts).toEqual({ fits: 2, "near-cap": 3, over: 0, "no-cell": 0, unparsed: 0 });
    const s3 = r.slides.find((s) => s.slide === 3);
    expect(s3).toMatchObject({
      layout: "panel-list",
      count: 4,
      words: 4,
      cap: 4,
      verdict: "near-cap",
    });
    // The title and objectives slides are never checked.
    expect(r.slides.filter((s) => s.slide <= 2).every((s) => s.verdict === "unchecked")).toBe(true);
  });

  test("flags a plan over its cap and a count the menu does not offer", () => {
    const flow = [
      { slide: 1, shape: "hook", size: "Title" },
      { slide: 2, shape: "one big idea", size: "Objectives" },
      { slide: 3, shape: "a contrast", size: "Two sides, up to twenty-five words each" },
      { slide: 4, shape: "a set of kinds or examples", size: "Six kinds, five words each" },
      { slide: 5, shape: "explain", size: "A paragraph" },
      { slide: 6, shape: "check", size: "Three questions" },
    ];
    const r = planFit(flow, "KS2");
    expect(r.slides.map((s) => s.verdict)).toEqual([
      "unchecked",
      "unchecked",
      "over",
      "no-cell",
      "unchecked",
      "fits",
    ]);
    expect(r.slides[5]?.layout).toBe("exit-ticket");
  });

  test("a flow that names its layout is checked against that layout, not its shape", () => {
    const flow = [
      { slide: 1, shape: "hook", layout: "title", size: "Title" },
      { slide: 2, shape: "one big idea", layout: "objectives", size: "Objectives" },
      // The shape would say panel-list; the declared layout is split-compare.
      {
        slide: 3,
        shape: "a set of kinds or examples",
        layout: "split-compare",
        size: "Two sides, up to twenty-five words each",
      },
      { slide: 4, shape: "one big idea", layout: "visual-text points-2-fig", size: "Two points" },
      { slide: 5, shape: "check", layout: "hinge", size: "Three options, five words each" },
    ];
    const r = planFit(flow, "KS2");
    expect(r.slides.map((s) => s.layout)).toEqual([null, null, "split-compare", null, "hinge"]);
    expect(r.slides[2]?.verdict).toBe("over");
    expect(r.slides[3]?.verdict).toBe("unchecked");
  });

  test("a stem's or lead's words are not an item's; a run of per-item words gives its largest", () => {
    expect(parseSize("Stem 9 words; four options of 5, 5, 4, 5 words", ["options"])).toEqual({
      count: 4,
      words: 5,
    });
    expect(parseSize("Lead 7 words; 3 items, 6 words each", ["items"])).toEqual({
      count: 3,
      words: 6,
    });
    expect(parseSize("Three questions, 8, 9 and 10 words", ["questions"])).toEqual({
      count: 3,
      words: 10,
    });
    // "need out of fit": the need is what is checked.
    expect(parseSize("Stem 7 of 12 words; 3 options, 3 out of 5 words each", ["options"])).toEqual({
      count: 3,
      words: 3,
    });
  });

  test("parses number words and digits", () => {
    expect(parseSize("Four pictured items, four words each", ["items"])).toEqual({
      count: 4,
      words: 4,
    });
    expect(parseSize("2 tasks, up to 25 words each", ["tasks"])).toEqual({ count: 2, words: 25 });
    expect(parseSize("One question and three short options", ["options"])).toEqual({ count: 3 });
    expect(parseSize("A paragraph", ["items"])).toEqual({});
  });
});
