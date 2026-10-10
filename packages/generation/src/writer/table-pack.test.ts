import { describe, expect, test } from "bun:test";
import { TABLE_ROWS_MAX, writerCaps } from "./contract";
import { continueTable, MAX_SLIDES, renumberSlideRefs } from "./table-pack";

type S = Record<string, unknown>;
const list = (n: number) => Array.from({ length: n }, (_, k) => [String(k + 1), `w${k + 1}`]);
const slide = (n: number): S => ({
  template: "big-visual",
  heading: "Numbers",
  figure: { kind: "table", header: ["N", "Word"], rows: list(n) },
});
const rowsOf = (s: S) => (s.figure as { rows: string[][] }).rows;
/** A fake slot that holds `cap` drawn rows; counts the layouts the search asks for. */
const slot = (cap: number) => {
  const calls = { n: 0 };
  const fits = (s: S, _first: boolean, asWritten?: boolean) => {
    calls.n += 1;
    return !asWritten && rowsOf(s).length <= cap;
  };
  return { fits, calls };
};

describe("table rows cap in the writer schema", () => {
  test("rows are capped at what 4 slides of 8 rows hold (32), not uncapped", () => {
    expect(TABLE_ROWS_MAX).toBe(32);
    const def = { properties: { rows: { type: "array", maxItems: 5 } } };
    const out = writerCaps(def, "table", "KS3-5", "full") as { properties: { rows: S } };
    expect(out.properties.rows.maxItems).toBe(32);
  });
});

describe("continueTable search", () => {
  test("bounded: a 30-entry list on 5-row slides takes a handful of layouts per slide, in order", () => {
    const { fits, calls } = slot(5);
    const r = continueTable(slide(30), fits);
    expect(r).toBeDefined();
    const parts = [r?.first, ...(r?.rest ?? [])] as S[];
    expect(parts.length).toBeLessThanOrEqual(MAX_SLIDES);
    // left column down, then right, slide after slide
    const order = parts.flatMap((p) => [
      ...rowsOf(p).map((x) => x[0]),
      ...rowsOf(p).map((x) => x[2]),
    ]);
    const nums = order.filter(Boolean).map(Number);
    expect(nums).toEqual(Array.from({ length: 30 }, (_, k) => k + 1));
    expect(calls.n).toBeLessThan(40);
  });
  test("a table that needs more than 4 slides is not split (it takes the old path)", () => {
    expect(continueTable(slide(32), slot(2).fits)).toBeUndefined();
  });
});

describe("slide references follow inserted continuations", () => {
  test("'slide 7' in notes and on a slide points where slide 7 now sits", () => {
    const at = new Map([
      [6, 6],
      [7, 8],
    ]);
    const out = renumberSlideRefs(
      [
        {
          notes: "Come back to this on slide 7.",
          elements: [{ type: "text", text: "See Slide 7" }],
        },
      ],
      at,
    );
    expect(out[0]?.notes).toBe("Come back to this on slide 8.");
    expect((out[0]?.elements[0] as S | undefined)?.text).toBe("See Slide 8");
  });
  test("no continuation: slides are returned untouched", () => {
    const s = [{ notes: "slide 3", elements: [] }];
    expect(renumberSlideRefs(s, new Map([[3, 3]]))).toBe(s);
  });
});

describe("the stage lays a long table over continuation slides (y8 French replay, its table written whole)", () => {
  test("continuations follow their slide, in order, drawn, and later slide references move with them", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { runWriter } = await import("./stage");
    const dir = join(import.meta.dir, "fixtures/replay/y8-french-my-family");
    const read = (f: string) => JSON.parse(readFileSync(join(dir, f), "utf8"));
    const main = read("main.json");
    const w = JSON.parse(main.text);
    const t = w.slides[1].figure;
    t.header = (t.header ?? ["Nombre", "Français"]).slice(0, 2);
    t.rows =
      "un deux trois quatre cinq six sept huit neuf dix onze douze treize quatorze quinze seize dix-sept dix-huit dix-neuf vingt"
        .split(" ")
        .map((x: string, k: number) => [String(k + 1), x]);
    // A later slide's words point at a slide after the table: it must follow the inserted slides.
    w.slides[4].instruction = "Use the numbers from slide 8.";
    const out = await runWriter({
      brief: read("brief.json"),
      objectives: read("objectives.json").objectives.map((o: { teacher: string }) => o.teacher),
      services: {
        log: () => {},
        writer: () => Promise.reject(new Error("no writer")),
        chat: async () => {
          throw new Error("no paid call");
        },
      },
      visual: () => ({ status: "failed" }),
      recordedWriter: { text: JSON.stringify(w), finishReason: "stop" },
      // Writer specs are drawn by code; a drawer call is refused ($0).
      drawDiagrams: {
        callDrawer: async () => {
          throw new Error("no drawer");
        },
      },
    });
    const ids = out.slides.map((s) => s.id);
    const k = ids.indexOf("s4");
    const conts = ids.filter((id) => /^s4t\d$/.test(id));
    expect(conts.length).toBeGreaterThan(0);
    expect(ids.slice(k + 1, k + 1 + conts.length)).toEqual(conts);
    for (const id of conts) {
      const s = out.slides.find((x) => x.id === id) as { elements: S[] };
      expect(s.elements.some((e) => e.name === "Diagram")).toBe(true);
      expect(JSON.stringify(s.elements)).toContain("(continued)");
    }
    const said = JSON.stringify(out.slides.find((s) => s.id === "s7"));
    expect(said).toContain(`slide ${8 + conts.length}`);
  });
});
