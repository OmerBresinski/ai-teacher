import { afterAll, describe, expect, test } from "bun:test";
import { svgAtBuild } from "@tj/slides/diagram-builds";
import { modelBodyRect } from "@tj/slides/templates";
import { getTheme } from "@tj/slides/themes";
import { type Element, Window } from "happy-dom";
import { catalogue } from "./catalogue";
import { checkParams, libraryDiagram, overlappingWords } from "./fill";
import { endDrawThread } from "./guard";
import { kit, loadModel, renderLibraryModel } from "./render";
import type { J } from "./types";

/*
 * TEACH-247 part ax: the KS3 photosynthesis model. A Y8 lesson fell back to a freehand sketch with
 * no light input that drew glucose leaving the leaf as a gas; the model refuses that science and
 * draws where each substance goes.
 */
afterAll(() => endDrawThread());

const model = async () => {
  const m = await loadModel("photosynthesis");
  if (!m) throw new Error("no photosynthesis model");
  return m;
};
const refusals = async (p: J) => {
  const m = await model();
  const v = m.validate((await kit()).withDefaults(m.params, p));
  return v.refusals.map((r) => `${r.path}: ${r.reason}`);
};
/** The words Present shows at build `k`. */
function wordsAt(svg: string, k: number): string[] {
  const doc = new Window().document;
  doc.body.innerHTML = svgAtBuild(svg, k, { answer: true, motion: false }).replace(
    /<style>[\s\S]*?<\/style>/g,
    "",
  );
  for (const el of [...doc.querySelectorAll("[data-s]")])
    if (Number(el.getAttribute("data-s")) > k) el.remove();
  // a wrapped label's lines are tspans: read them as one label, a space between lines
  const read = (t: Element) => {
    const lines = [...t.querySelectorAll("tspan")].filter((s) => s.hasAttribute("x"));
    return (
      lines.length ? lines.map((s) => s.textContent ?? "").join(" ") : (t.textContent ?? "")
    ).trim();
  };
  return [...doc.querySelectorAll("text")]
    .map((t) => read(t as unknown as Element))
    .filter(Boolean);
}

describe("photosynthesis refuses false science", () => {
  test("the presets are true", async () => {
    const m = await model();
    for (const p of m.presets) expect(await refusals(p.params)).toEqual([]);
  });

  test("glucose drawn leaving the leaf as a gas is refused", async () => {
    const r = await refusals({
      outputs: [
        { substance: "glucose", leavesAsGas: true },
        { substance: "oxygen", leavesAsGas: true },
      ],
    });
    expect(r.join("\n")).toMatch(/outputs\.0\.leavesAsGas: Glucose is not a gas/);
  });

  test("oxygen or glucose as an input is refused", async () => {
    expect(
      (await refusals({ inputs: ["light", "carbon_dioxide", "water", "oxygen"] })).join("\n"),
    ).toMatch(/inputs\.3: Oxygen is not an input/);
    expect(
      (await refusals({ inputs: ["light", "glucose", "carbon_dioxide", "water"] })).join("\n"),
    ).toMatch(/inputs\.1: Glucose is not an input/);
  });

  test("a missing light input is refused, even for an inputs-only slide", async () => {
    const r = await refusals({
      inputs: ["carbon_dioxide", "water"],
      outputs: [],
      wordEquation: false,
    });
    expect(r.join("\n")).toMatch(/needs light/);
  });

  test("products from fewer inputs than the reaction needs are refused", async () => {
    const r = await refusals({ inputs: ["light", "water"] });
    expect(r.join("\n")).toMatch(/missing: carbon dioxide/);
  });

  test("carbon dioxide or water as a product, and oxygen kept in the leaf, are refused", async () => {
    const r = (
      await refusals({
        outputs: [
          { substance: "glucose" },
          { substance: "oxygen", leavesAsGas: false },
          { substance: "water", leavesAsGas: true },
        ],
      })
    ).join("\n");
    expect(r).toMatch(/outputs\.1\.leavesAsGas: Oxygen made/);
    expect(r).toMatch(/outputs\.2\.substance: Water is used up/);
  });

  test("a symbol equation must be photosynthesis, balanced", async () => {
    expect(await refusals({ symbolEquation: "6CO2 + 6H2O → C6H12O6 + 6O2" })).toEqual([]);
    expect(await refusals({ symbolEquation: "6CO₂ + 6H₂O -> C₆H₁₂O₆ + 6O₂" })).toEqual([]);
    expect((await refusals({ symbolEquation: "CO2 + H2O → C6H12O6 + O2" })).join("\n")).toMatch(
      /does not balance \(C: 1 on the left, 6 on the right/,
    );
    expect((await refusals({ symbolEquation: "C6H12O6 + 6O2 → 6CO2 + 6H2O" })).join("\n")).toMatch(
      /equation for respiration/,
    );
    expect((await refusals({ symbolEquation: "6CO2 + 6H2O → C6H12O6" })).join("\n")).toMatch(
      /exactly those/,
    );
    expect(
      (await refusals({ symbolEquation: "6CO2 + 6H2O → C6H12O6 + 6O2", wordEquation: false })).join(
        "\n",
      ),
    ).toMatch(/turn the word equation on/);
  });

  test("a reworded label keeps its substance and its direction", async () => {
    expect(await refusals({ text: { "label:oxygen": "O₂ out of the leaf" } })).toEqual([]);
    expect((await refusals({ text: { "label:glucose": "Sugar" } })).join("\n")).toMatch(
      /no longer names glucose/,
    );
    expect(
      (await refusals({ text: { "label:glucose": "Glucose gas given off" } })).join("\n"),
    ).toMatch(/not a gas/);
    expect((await refusals({ text: { "label:oxygen": "Oxygen taken in" } })).join("\n")).toMatch(
      /goes out of the leaf/,
    );
  });

  test("the fill path refuses the same (what the writer's filler sends)", async () => {
    const r = await checkParams("photosynthesis", {
      outputs: [{ substance: "glucose", leavesAsGas: true }],
    });
    expect(r.refusals.length).toBeGreaterThan(0);
    expect(
      (await checkParams("photosynthesis", { labels: "short", chloroplast: false })).refusals,
    ).toEqual([]);
  });
});

describe("photosynthesis on a KS3 slide (the writer's path)", () => {
  test("every preset draws in Studio and Night Lab at the label floor, never falling back", async () => {
    for (const id of ["studio", "night-lab"]) {
      const theme = getTheme(id, "ks3" as never);
      const place = modelBodyRect(
        "Photosynthesis",
        "Light, carbon dioxide and water become glucose and oxygen.",
        theme,
        "ks3" as never,
      );
      for (const pre of (await model()).presets) {
        const ask = {
          key: "d",
          model: "photosynthesis",
          intent: "Show how a leaf makes glucose",
          words: "",
          heading: "",
          caption: "",
          yearGroup: "Year 8",
          lesson: "Science: photosynthesis",
          labelOverlap: true,
          labelFloor: true,
          font: theme.fonts.body,
          place,
        };
        const r = await libraryDiagram(ask, async () => ({ ...pre.params }));
        expect(r.ok ? "ok" : `${id}/${pre.id}: ${r.reason}`).toBe("ok");
      }
    }
  }, 120_000);
});

describe("photosynthesis draws every build", () => {
  const BUILDS = [
    "leaf",
    "light",
    "carbon_dioxide",
    "water",
    "chloroplast",
    "glucose",
    "oxygen",
    "equation",
    "symbol",
  ];
  test("each preset draws one frame per build, words clear of each other, nothing cut", async () => {
    const m = await model();
    const K = await kit();
    for (const pre of m.presets) {
      const P = K.withDefaults(m.params, pre.params);
      const steps = m.builds?.(P).steps.map((s) => s.key) ?? [];
      expect(steps).toEqual(BUILDS.filter((k) => steps.includes(k)));
      const d = await renderLibraryModel("photosynthesis", P);
      expect(d.builds + 1).toBe(steps.length);
      expect(d.warnings).toEqual([]);
      expect(overlappingWords(d.svg)).toEqual([]);
      // each build adds its own words, in teaching order
      const seen = steps.map((_, k) => wordsAt(d.svg, k).join(" | "));
      for (let k = 1; k < seen.length; k++) expect(seen[k]).not.toBe(seen[k - 1]);
    }
  });

  test("what each build names: light first, glucose stays, oxygen leaves, the equation in order", async () => {
    const m = await model();
    const P = (await kit()).withDefaults(m.params, m.presets[2]?.params ?? {});
    const d = await renderLibraryModel("photosynthesis", P);
    const at = (k: string) =>
      wordsAt(d.svg, m.builds?.(P).steps.findIndex((s) => s.key === k) ?? -1).join(" | ");
    expect(at("leaf")).toMatch(/Leaf/);
    expect(at("leaf")).not.toMatch(/Light energy/);
    expect(at("light")).toMatch(/Light energy, absorbed by chlorophyll/);
    expect(at("carbon_dioxide")).toMatch(/Carbon dioxide in through stomata/);
    expect(at("water")).toMatch(/Water from the roots, up the xylem/);
    expect(at("chloroplast")).toMatch(/Chloroplast/);
    expect(at("glucose")).toMatch(/Glucose \| stored as starch|stored as/);
    expect(at("glucose")).not.toMatch(/Oxygen/);
    expect(at("oxygen")).toMatch(/Oxygen out through stomata/);
    expect(at("equation")).toMatch(
      /carbon dioxide \| \+ \| water \| light \| chlorophyll \| glucose \| \+ \| oxygen/,
    );
    // the symbol equation is runs of text (subscripts dropped and smaller), one row in order
    const symWords = (k: string) =>
      wordsAt(d.svg, m.builds?.(P).steps.findIndex((s) => s.key === k) ?? -1);
    const added = symWords("symbol")
      .slice(symWords("equation").length)
      .join("")
      .replace(/\u00a0/g, " ");
    expect(added.replace(/\s/g, "")).toBe("6CO2+6H2O→C6H12O6+6O2");
    // no arrow or word draws glucose leaving: its only arrow runs down the stem, inside the plant
    expect(d.svg).not.toMatch(/Glucose out|glucose gas/i);
  });

  test("the writer sees it for a Year 8 science lesson, and not for Year 4", async () => {
    const ks3 = await catalogue("KS3-5", { yearGroup: "Year 8", subject: "Science" });
    expect(ks3.map((e) => e.id)).toContain("photosynthesis");
    const ks2 = await catalogue("KS2", { yearGroup: "Year 4", subject: "Science" });
    expect(ks2.map((e) => e.id)).not.toContain("photosynthesis");
  });
});
