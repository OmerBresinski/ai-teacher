import { afterAll, describe, expect, test } from "bun:test";
import { DIAGRAM_KINDS } from "@tj/slides/diagrams";
import { BASE_KIND, FALLBACK_KIND } from "./catalogue";
import { checkParams } from "./fill";
import { drawLibraryModel, endDrawThread } from "./guard";
import { clampToSchema, DEFAULT_MAX_ITEMS, DEFAULT_NUMBER_BOUND, kit, loadModel } from "./render";

/* TEACH-247 part h review: a drawing can't hold the worker, and params can't escape their bounds. */
describe("the draw has a deadline", () => {
  test("a draw that loops forever is ended at the deadline; the event loop keeps running", async () => {
    let ticks = 0;
    const tick = setInterval(() => ticks++, 50);
    const t0 = Date.now();
    const err = await drawLibraryModel(
      "fractions",
      {},
      {},
      { drawMs: 500, workerUrl: new URL("./testing/loop-worker.ts", import.meta.url).href },
    ).then(
      () => "",
      (e: unknown) => String(e),
    );
    clearInterval(tick);
    expect(err).toContain("draw missed its 500 ms deadline");
    expect(Date.now() - t0).toBeLessThan(2_500);
    expect(ticks).toBeGreaterThan(3);
  });

  test("a huge count is held to the schema and draws inside the deadline", async () => {
    const m = await loadModel("equal_groups");
    const base = (await kit()).withDefaults(m?.params ?? { properties: {} }, m?.presets[0]?.params);
    const huge = JSON.parse(JSON.stringify(base), (_k, v) => (typeof v === "number" ? 1e9 : v));
    const t0 = Date.now();
    const r = await drawLibraryModel("equal_groups", huge).then(
      (d) => d.bytes,
      (e: unknown) => String(e),
    );
    expect(Date.now() - t0).toBeLessThan(10_000);
    // Drawn small, or refused with a reason: never a hang.
    if (typeof r === "number") expect(r).toBeLessThan(400_000);
    else expect(r).not.toContain("deadline");
  }, 20_000);

  test("a real model draws in its thread", async () => {
    const m = await loadModel("fractions");
    const P = (await kit()).withDefaults(m?.params ?? { properties: {} }, m?.presets[0]?.params);
    const d = await drawLibraryModel("fractions", P);
    expect(d.src.startsWith("data:image/svg+xml")).toBe(true);
  }, 20_000);
});

describe("params are held to bounds", () => {
  test("lists, numbers and strings without bounds get defaults; ones with bounds keep theirs", () => {
    const schema = {
      type: "object",
      properties: {
        n: { type: "integer", maximum: 12 },
        free: { type: "number" },
        list: { type: "array", items: { type: "string", maxLength: 5 } },
      },
    };
    const out = clampToSchema(schema, {
      n: 1e9,
      free: -1e12,
      list: Array.from({ length: 1e4 }, () => "abcdefgh"),
    }) as { n: number; free: number; list: string[] };
    expect(out.n).toBe(12);
    expect(out.free).toBe(-DEFAULT_NUMBER_BOUND);
    expect(out.list.length).toBe(DEFAULT_MAX_ITEMS);
    expect(out.list[0]).toBe("abcde");
  });

  test("no __proto__ or constructor key reaches the kit", async () => {
    const evil = JSON.parse('{"__proto__": {"polluted": 1}, "constructor": {"x": 1}}');
    await checkParams("fractions", evil);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(clampToSchema({}, evil) as object)).toEqual([]);
  });

  test("every fallback is a kind the drawer draws", () => {
    for (const k of [...Object.values(BASE_KIND), FALLBACK_KIND])
      expect(DIAGRAM_KINDS as readonly string[]).toContain(k);
  });
});

afterAll(() => endDrawThread());
