import { describe, expect, test } from "bun:test";
import { buildCount, svgOfDataUrl } from "@tj/slides/diagram-builds";
import { BASE_KIND, catalogue, EXCLUDED, FALLBACK_KIND, libSchema, libSystem } from "./catalogue";
import { checkParams, fillSchema, libraryDiagram, questionStep } from "./fill";
import { MODEL_LOADERS } from "./models";
import { kit, loadModel, MAX_SVG_BYTES, renderLibraryModel } from "./render";

/*
 * TEACH-247 part h: library models drawn without a browser, the writer's catalogue, the fill and
 * check, and the drawer fallback.
 */
const preset = async (id: string, n = 0) => {
  const m = await loadModel(id);
  if (!m) throw new Error(id);
  return (await kit()).withDefaults(m.params, (m.presets[n] ?? m.presets[0])?.params ?? {});
};

describe("shipped models", () => {
  test("52 models ship; none of the excluded ones does", () => {
    expect(Object.keys(MODEL_LOADERS).length).toBe(52);
    for (const id of Object.keys(EXCLUDED)) expect(MODEL_LOADERS[id]).toBeUndefined();
  });

  test("every shipped model's every preset draws an SVG the slide can hold, with no browser", async () => {
    const bad: string[] = [];
    for (const id of Object.keys(MODEL_LOADERS)) {
      const m = await loadModel(id);
      for (const [n, p] of (m?.presets ?? []).entries()) {
        try {
          const r = await renderLibraryModel(id, await preset(id, n));
          const svg = svgOfDataUrl(r.src) ?? "";
          if (!svg.startsWith("<svg") || !svg.includes("<style><![CDATA[@font-face"))
            bad.push(`${id}/${p.id}: not a self-contained svg`);
          if (r.bytes > MAX_SVG_BYTES) bad.push(`${id}/${p.id}: ${r.bytes} bytes`);
          if (buildCount(svg) !== r.builds) bad.push(`${id}/${p.id}: builds`);
          if (/&nbsp;| class="[^"]*\boff\b/.test(svg))
            bad.push(`${id}/${p.id}: hidden marks or html`);
          if (!(r.aspect > 0.3 && r.aspect < 7)) bad.push(`${id}/${p.id}: aspect ${r.aspect}`);
        } catch (e) {
          // hist_map's world journey preset is a 2 MB coastline: refused, so the drawer draws it.
          if (!(id === "hist_map" && /over the slide's limit/.test(String(e))))
            bad.push(`${id}/${p.id}: ${String(e).slice(0, 120)}`);
        }
      }
    }
    expect(bad).toEqual([]);
  }, 120_000);

  test("the draw leaves no browser globals behind", async () => {
    await renderLibraryModel("fractions", await preset("fractions"));
    expect((globalThis as Record<string, unknown>).document).toBeUndefined();
    expect((globalThis as Record<string, unknown>).getComputedStyle).toBeUndefined();
  });

  test("a question slide's step draws fewer builds than the still", async () => {
    const P = await preset("fractions");
    const step = await questionStep("fractions", P);
    expect(step).toBeDefined();
    const still = await renderLibraryModel("fractions", P);
    const q = await renderLibraryModel("fractions", P, { step });
    expect(q.builds).toBeLessThanOrEqual(step as number);
    expect(q.builds).toBeLessThan(still.builds + 1);
  });
});

describe("writer catalogue", () => {
  test("each stage lists only shipped models, in the prompt-engineer's line form", async () => {
    const ks2 = await catalogue("KS2");
    expect(ks2.length).toBeGreaterThan(10);
    for (const e of ks2) expect(MODEL_LOADERS[e.id]).toBeDefined();
    const sys = libSystem("Intro\nDiagram kinds:\n- bar-model: x\n- pie: y\n\nRest", ks2);
    expect(sys).toContain("- pie: y\n- model: a ready-made teaching model");
    expect(sys).toContain("Models (id, years: what it shows):\n- ");
    expect(sys).toContain("\n- fractions, Y1-Y6: ");
    expect(sys.endsWith("\nRest")).toBe(true);
  });

  test("the schema offers dg-model in both diagram slots", () => {
    const base = {
      $defs: { "diagram-side": { anyOf: [{ $ref: "#/$defs/a" }] }, "diagram-full": { anyOf: [] } },
    };
    const s = libSchema(base, ["fractions"]) as { $defs: Record<string, { anyOf?: unknown[] }> };
    expect(s.$defs["diagram-side"]?.anyOf).toContainEqual({ $ref: "#/$defs/dg-model-side" });
    expect(s.$defs["diagram-full"]?.anyOf).toContainEqual({ $ref: "#/$defs/dg-model-full" });
    expect(libSchema(base, [])).toBe(base);
  });
});

describe("fill and check", () => {
  test("the filler never sees the title or wording overrides", async () => {
    const m = await loadModel("fractions");
    const s = fillSchema(m?.params ?? { properties: {} }) as { properties: object };
    expect(Object.keys(s.properties)).not.toContain("title");
    expect(Object.keys(s.properties)).not.toContain("text");
  });

  test("params that break the schema are refused with a path", async () => {
    const r = await checkParams("fractions", { representation: 42 });
    expect(r.params).toBeUndefined();
    expect(r.refusals.length).toBeGreaterThan(0);
    expect((await checkParams("fractions", "x")).refusals[0]?.reason).toBe("no params object");
  });

  const ask = {
    key: "figure",
    model: "fractions",
    intent: "a half of a pizza",
    alt: "A pizza with one of two equal parts shaded.",
    words: "One half",
    yearGroup: "Year 2",
    lesson: "Maths: halves",
  };

  test("filled params draw; the writer's alt is kept", async () => {
    const m = await loadModel("fractions");
    const params = m?.presets[0]?.params;
    const r = await libraryDiagram(ask, async () => params);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.drawing.alt).toBe(ask.alt);
      expect(r.drawing.src.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    }
  });

  test("refused twice: the drawer's kind for the model, after one repair told the reasons", async () => {
    const users: string[] = [];
    const r = await libraryDiagram(ask, async (req) => {
      users.push(req.user);
      return { representation: 42 };
    });
    expect(r).toMatchObject({ ok: false, fallbackKind: BASE_KIND.fractions });
    expect(users.length).toBe(2);
    expect(users[1]).toContain("The model refused them.");
  });

  test("a model with no base kind falls back to a labelled drawing; so does a failed call", async () => {
    const r = await libraryDiagram({ ...ask, model: "circuits" }, async () => {
      throw new Error("timeout");
    });
    expect(r).toMatchObject({ ok: false, fallbackKind: FALLBACK_KIND });
    const none = await libraryDiagram({ ...ask, model: "water_cycle" }, async () => "x");
    expect(none).toMatchObject({ ok: false, fallbackKind: "cycle" });
  });
});
