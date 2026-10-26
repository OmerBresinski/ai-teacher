import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { writerBrief } from "../stages/write";
import { sampleBriefLesson } from "../testing";
import {
  type Brief,
  FLOW_LOOKAHEAD,
  flowLayoutOf,
  flowMatcher,
  lookOf,
  templateOfLayout,
  withLook,
} from "./fixes";
import { PILOT_PACKS } from "./pilot-pack";
import { replayServices } from "./replay-fixture";
import type { WriterReq, WriterServices } from "./services";
import { runWriter } from "./stage";

/*
 * genlab Y1 plants (26 Oct): the writer wrote 11 slides and its close against a 13-slide flow, so
 * flow entry 12 (a practice slide's picture) was read for slide 12, the exit ticket. The picture
 * was generated (31 s, $0.0063) and never shown. Each written slide now takes the flow entry that
 * plans it: the next one whose layout names the template the writer wrote.
 */
const pic = (shows: string) => ({ kind: "picture", shows });
const Y1 = [
  { slide: 1, layout: "title", look_at: pic("a flowering garden plant") },
  { slide: 2, layout: "objectives" },
  { slide: 3, layout: "discussion fig", look_at: pic("flowers in soil") },
  { slide: 4, layout: "figure-slide", look_at: { kind: "diagram", shows: "plant parts" } },
  { slide: 5, layout: "visual-text points-0-fig", look_at: pic("roots taking water") },
  { slide: 6, layout: "practice", look_at: pic("seedling and flowering plant in rain") },
  { slide: 7, layout: "exit-ticket", look_at: { kind: "none", shows: null } },
];

describe("flowMatcher: each written slide reads the entry that plans it", () => {
  test("an early close skips the unwritten entry: the exit ticket gets its own (no picture)", () => {
    const of = flowMatcher(() => Y1);
    expect(of(0, "title")?.slide).toBe(1);
    expect(of(2, "discussion")?.slide).toBe(3);
    // figure-slide is written as `figure` (FLOW_LAYOUT_TEMPLATE).
    expect(of(3, "figure")?.slide).toBe(4);
    expect(of(4, "visual-text")?.slide).toBe(5);
    // Slide 6 is the close: the practice entry was never written.
    const exit = of(5, "exit-ticket");
    expect(exit?.slide).toBe(7);
    expect(withLook({ template: "exit-ticket", items: [] }, lookOf(exit)).how).toBeUndefined();
  });

  test("an entry for a later slide with the same template is not read out of order", () => {
    const flow = [
      { slide: 3, layout: "practice", look_at: pic("A") },
      { slide: 4, layout: "hinge" },
      { slide: 5, layout: "practice", look_at: pic("B") },
    ];
    const of = flowMatcher(() => flow);
    // Slide 3 is a practice slide: entry 3, never entry 5's picture.
    expect(lookOf(of(2, "practice"))?.shows).toBe("A");
    expect(of(3, "hinge")?.slide).toBe(4);
    expect(lookOf(of(4, "practice"))?.shows).toBe("B");
  });

  test("an activity's template is matched as the writer wrote it, before its rewrite", () => {
    const of = flowMatcher(() => [{ slide: 3, layout: "pair", look_at: pic("cards") }]);
    expect(of(2, "pair")?.slide).toBe(3);
  });

  test("a slide whose template no near entry plans gets none; the next slide still matches", () => {
    const flow = [
      { slide: 3, layout: "hinge" },
      { slide: 4, layout: "practice", look_at: pic("C") },
    ];
    const of = flowMatcher(() => flow);
    expect(of(2, "myth")).toBeUndefined();
    expect(of(3, "practice")?.slide).toBe(4);
    // Asked again, the same answer.
    expect(of(3, "practice")?.slide).toBe(4);
  });

  test(`it looks at most ${FLOW_LOOKAHEAD} entries past the next unmatched one`, () => {
    const flow = [
      ...Array.from({ length: FLOW_LOOKAHEAD + 1 }, (_, k) => ({ slide: 3 + k, layout: "hinge" })),
      { slide: 9, layout: "practice", look_at: pic("far") },
    ];
    expect(flowMatcher(() => flow)(2, "practice")).toBeUndefined();
  });

  test("a flow without layouts is read by index, as before", () => {
    const of = flowMatcher(() => [{ slide: 6, look_at: pic("D") }]);
    expect(lookOf(of(5, "exit-ticket"))?.shows).toBe("D");
  });
});

/** The writer request's schema for one pack and year (the request is caught, nothing is called). */
async function schemaOf(pack: string, yearGroup: string, ageBand: string) {
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
  await runWriter({
    brief: writerBrief(sampleBriefLesson({ yearGroup, ageBand } as never)),
    objectives: ["Name the parts."],
    services,
    pilotPack: pack as never,
  }).catch(() => {});
  if (!got) throw new Error(`no writer request for ${pack} ${yearGroup}`);
  return got.schema as {
    $defs: Record<string, { properties?: { template?: { enum?: string[] } } }>;
    properties: { flow: { items: { properties: { layout?: { enum?: string[] } } } } };
  };
}

describe("every pack layout's flow name gives its def's template", () => {
  const cases = Object.keys(PILOT_PACKS).flatMap((p) =>
    [
      ["Year 1", "ks1"],
      ["Year 5", "ks2"],
      ["Year 9", "ks3"],
    ].map(([y, a]) => [p, y as string, a as string] as const),
  );
  let withLayouts = 0;
  test.each(cases)("pack %s, %s", async (pack, year, band) => {
    const schema = await schemaOf(pack, year, band);
    // Packs before v4.8 plan no layout: their flow is read by index.
    const named = schema.properties.flow.items.properties.layout;
    if (!named) return;
    withLayouts++;
    const offered = new Set(named.enum ?? []);
    let checked = 0;
    for (const [key, def] of Object.entries(schema.$defs)) {
      const tpl = def.properties?.template?.enum;
      if (tpl?.length !== 1) continue;
      const layout = flowLayoutOf(key);
      if (!offered.has(layout)) continue;
      expect(`${layout} -> ${templateOfLayout(layout)}`).toBe(`${layout} -> ${tpl[0]}`);
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
    // And every layout the flow may name, but the objectives slide code lays, has a def.
    const templates = new Set(
      Object.values(schema.$defs).flatMap((d) => d.properties?.template?.enum ?? []),
    );
    for (const layout of offered)
      if (layout !== "objectives")
        expect(templates.has(templateOfLayout(layout)), layout).toBe(true);
  });
  test("the current pack plans layouts, so the check above ran", () => {
    expect(withLayouts).toBeGreaterThan(0);
  });
});

/* The stage wiring: a recorded deck whose flow plans one slide more than was written. */
const B = "y1-science-animals-young";
const DIR = join(import.meta.dir, "fixtures/replay", B);
const read = (f: string) => JSON.parse(readFileSync(join(DIR, f), "utf8"));

describe("runWriter: an unwritten flow entry's picture is never asked for", () => {
  test("the extra entry's look reaches no slide; the written slides keep their own", async () => {
    const main = read("main.json") as { text: string };
    const out = JSON.parse(main.text) as {
      flow: { slide: number; layout?: string; look_at?: unknown }[];
      slides: { template: string }[];
    };
    // Layouts as the pack writes them: slide k of the flow is slides[k - 3] (1 and 2 by code).
    for (const f of out.flow)
      f.layout =
        f.slide === 1 ? "title" : f.slide === 2 ? "objectives" : out.slides[f.slide - 3]?.template;
    const last = out.flow[out.flow.length - 1] as { slide: number };
    const lastTpl = out.slides[out.slides.length - 1]?.template;
    const extra = {
      ...out.flow[out.flow.length - 1],
      slide: last.slide,
      layout: lastTpl === "practice" ? "question-set" : "practice",
      look_at: { kind: "picture", shows: "UNWRITTEN SLIDE PICTURE" },
    };
    last.slide += 1;
    out.flow.splice(out.flow.length - 1, 0, extra);
    const asked: string[] = [];
    const events: { ev?: string }[] = [];
    await runWriter({
      brief: read("brief.json") as Brief,
      objectives: (read("objectives.json") as { objectives: { teacher: string }[] }).objectives.map(
        (o) => o.teacher,
      ),
      services: {
        ...replayServices(B),
        log: (e: { ev?: string }) => events.push(e),
        writer: async () => ({ text: JSON.stringify(out), finishReason: "stop", usd: 0, ms: 0 }),
      },
      onAsks: (_i, asks) => {
        for (const a of asks) if (a.type === "photo") asked.push(a.shows);
      },
    });
    expect(asked.some((s) => s.includes("UNWRITTEN SLIDE PICTURE"))).toBe(false);
    // The deck still asks for the pictures its own entries plan.
    expect(asked.length).toBeGreaterThan(0);
    expect(events.some((e) => e.ev === "look-other-slide")).toBe(true);
  });
});
