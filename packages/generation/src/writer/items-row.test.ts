import { describe, expect, test } from "bun:test";
import { getTheme } from "@tj/slides/themes";
import { sampleBriefLesson } from "../testing";
import { withActivities } from "./activities";
import { answerFirstMain, charsOver, fitTable } from "./fixes";
import fixture from "./fixtures/activities/y1-animals.json" with { type: "json" };
import { ITEMS_ROW_MAX, rowCaps } from "./items-row-fits";
import { materialise, type Plan, visualsOf } from "./materialise";
import { writerSchema } from "./schema";
import { validate } from "./strict-subset";

/*
 * items-row on the writer's side (TEACH-75 part u): live in the schema (no off switch, Greg
 * 12 Oct), older outputs still parse, 2-4 items, caps from the renderer's measured table, icons
 * are labels (no picture asks), and a miss numbers the row and is reported.
 */
type S = Record<string, unknown>;
type J = Record<string, unknown>;

const row: S = {
  template: "items-row",
  heading: "Three parts work together",
  accentWord: "work together",
  lead: null,
  ordered: false,
  items: [
    { name: "Heart", text: "A muscle that pumps blood.", icon: "heart" },
    { name: "Blood", text: "Carries oxygen and nutrients.", icon: "blood" },
    { name: "Blood vessels", text: "Tubes that blood travels through.", icon: "vessels" },
  ],
};
const SLIDES = (fixture as { brief: { slides: { min: number; max: number } } }).brief.slides;

describe("the items-row schema", () => {
  const s = writerSchema("KS2", SLIDES) as J;
  const defs = s.$defs as Record<string, J>;
  const def = defs["items-row"] as J;

  test("is live: in the slide menu with no option", () => {
    expect(def).toBeDefined();
    expect(JSON.stringify(s.properties)).toContain("#/$defs/items-row");
    expect(JSON.stringify(writerSchema("KS2", SLIDES, undefined, { pinned: true }))).not.toContain(
      "items-row",
    );
  });

  test("older outputs still validate (round trip)", () => {
    const k1 = writerSchema("KS1", SLIDES) as J;
    // Answer first (ANSWER-BUG.md): older outputs carry `correct`, as activities.test.ts reads them.
    expect(
      validate(withActivities(k1, "KS1"), answerFirstMain((fixture as { main: unknown }).main)),
    ).toEqual([]);
  });

  test("2 to 4 items validate; 1 or 5 do not; icons null or a lower-case label", () => {
    const items = row.items as S[];
    expect(validate(def, row, s)).toEqual([]);
    expect(validate(def, { ...row, items: items.slice(0, 2) }, s)).toEqual([]);
    expect(validate(def, { ...row, items: items.slice(0, 1) }, s)).not.toEqual([]);
    const five = [...items, ...items].slice(0, 5);
    expect(validate(def, { ...row, items: five }, s)).not.toEqual([]);
    const nul = items.map((it) => ({ ...it, icon: null }));
    expect(validate(def, { ...row, items: nul }, s)).toEqual([]);
    const bad = items.map((it) => ({ ...it, icon: "Heart!" }));
    expect(validate(def, { ...row, items: bad }, s)).not.toEqual([]);
    expect(ITEMS_ROW_MAX).toBe(4);
  });

  test("the caps are the renderer's: a line past them fails the schema", () => {
    const caps = rowCaps("KS2");
    expect(caps.text).toBeGreaterThan(40);
    const items = (row.items as S[]).map((it) => ({ ...it, text: "w".repeat(caps.text + 1) }));
    expect(validate(def, { ...row, items }, s)).not.toEqual([]);
  });
});

describe("items-row on the writer's layout", () => {
  const brief = { ...sampleBriefLesson().brief, keyStage: "KS2" } as never;
  const base = {
    brief,
    theme: getTheme(undefined as never, "KS2" as never),
    stage: "KS2" as never,
  };
  const plan = { slides: [] } as unknown as Plan;
  /** The slide's elements as laid, a layout group taken apart (materialise keeps it whole). */
  const run = (s: S) => {
    const m = materialise(s, { ...base, index: 3, plan, visual: () => ({ status: "failed" }) });
    const elements = m.slide.elements.flatMap((e) =>
      e.type === "group" && "layout" in e
        ? e.children.map((c) => ({ ...c, x: c.x + e.x, y: c.y + e.y }))
        : [e],
    );
    return { ...m, slide: { ...m.slide, elements } };
  };

  test("the row stays one re-layable group in the editor (TEACH-205 part b prototype)", () => {
    const m = materialise(row, { ...base, index: 3, plan, visual: () => ({ status: "failed" }) });
    expect(m.slide.elements).toHaveLength(1);
    const g = m.slide.elements[0] as { type: string; layout?: { template: string; input: S } };
    expect(g.type).toBe("group");
    expect(g.layout?.template).toBe("items-row");
    expect((g.layout?.input.items as S[] | undefined)?.length).toBe((row.items as S[]).length);
  });

  test("icons are labels for the library, never picture asks", () => {
    expect(visualsOf(row, 3, { ...base, plan })).toEqual([]);
  });

  test("lays out the row: three names, three medals, nothing over", () => {
    const r = run(row);
    expect(r.over).toEqual([]);
    expect(r.slide.elements.filter((e) => e.name === "Item name")).toHaveLength(3);
  });

  test("a named line style is drawn; an unknown one is plain", () => {
    const names = (m: string) =>
      run({ ...row, motif: m })
        .slide.elements.filter((e) => e.type === "path")
        .map((e) => e.name);
    expect(names("road")).toEqual(["Connecting line", "Connecting dots"]);
    const stem = run({ ...row, motif: "stem" }).slide.elements.map((e) => e.name);
    expect(stem).toContain("Leaf");
    expect(names("lightning")).toEqual(["Connecting line"]);
  });

  test("a writer's placeholder icon is dropped: the row is numbered", () => {
    const items = (row.items as S[]).map((it, i) =>
      i === 0 ? { ...it, icon: "placeholder" } : it,
    );
    const r = run({ ...row, items, ordered: true });
    expect(r.slide.elements.filter((e) => e.type === "image")).toHaveLength(0);
    expect(r.slide.elements.filter((e) => e.name === "Number")).toHaveLength(3);
  });

  test("unordered with no icons: neutral marks, no numbers", () => {
    const items = (row.items as S[]).map((it) => ({ ...it, icon: null }));
    const r = run({ ...row, items, ordered: false });
    expect(r.slide.elements.filter((e) => e.name === "Number")).toHaveLength(0);
    expect(r.slide.elements.filter((e) => e.name === "Mark")).toHaveLength(3);
  });

  test("an icon the library misses numbers every item", () => {
    const items = (row.items as S[]).map((it, i) => (i === 2 ? { ...it, icon: "kitten" } : it));
    const r = run({ ...row, items, ordered: true });
    expect(r.slide.elements.filter((e) => e.type === "icon")).toHaveLength(0);
    expect(r.slide.elements.filter((e) => e.name === "Number")).toHaveLength(3);
  });
});

describe("the items row's fit", () => {
  test("the fit table has the row from the renderer's table, 2 to 4 items", () => {
    const v = fitTable().KS2?.layouts["items-row"]?.variants ?? [];
    expect(v.map((x) => x.counts.items)).toEqual([2, 3, 4]);
    expect(v.every((x) => x.chars > 0)).toBe(true);
  });

  test("an overlong line is reported for repair", () => {
    const items = (row.items as S[]).map((it) => ({ ...it, text: "word ".repeat(40).trim() }));
    const over = charsOver({ ...row, items }, "KS2");
    expect(over.some((o) => o.startsWith("items[1]"))).toBe(true);
  });
});
