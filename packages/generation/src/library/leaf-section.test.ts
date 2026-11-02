import { afterAll, describe, expect, test } from "bun:test";
import { svgAtBuild } from "@tj/slides/diagram-builds";
import { modelBodyRect } from "@tj/slides/templates";
import { getTheme } from "@tj/slides/themes";
import { type Element, Window } from "happy-dom";
import { catalogue, catalogueLines, WRITER_WORDS } from "./catalogue";
import {
  capabilityRefusals,
  checkParams,
  libraryDiagram,
  overlappingWords,
  panelsOff,
  questionStep,
} from "./fill";
import { endDrawThread } from "./guard";
import { kit, loadModel, renderLibraryModel } from "./render";
import type { J } from "./types";

/*
 * TEACH-247 part cl: the leaf cross-section. Y8 photosynthesis decks taught the leaf's layers and
 * stomata with no picture, or beside a stem cross-section labelled as chloroplasts or stomata; the
 * library had no leaf model. The model draws each layer where it is and names it one build at a
 * time, each name first a letter so a question slide can ask for it.
 */
afterAll(() => endDrawThread());

const model = async () => {
  const m = await loadModel("leaf_section");
  if (!m) throw new Error("no leaf_section model");
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
  // a mark that passes (a letter until its name is given) shows only on its frames (`data-f`)
  for (const el of [...doc.querySelectorAll("[data-f]")])
    if (!(el.getAttribute("data-f") ?? "").split(" ").includes(String(k))) el.remove();
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

describe("leaf_section refuses false science", () => {
  test("the presets are true", async () => {
    const m = await model();
    for (const p of m.presets) expect(await refusals(p.params)).toEqual([]);
  });

  test("a reworded name keeps its part", async () => {
    expect(await refusals({ text: { "label:palisade": "Palisade cells" } })).toEqual([]);
    expect((await refusals({ text: { "label:spongy": "Middle layer" } })).join("\n")).toMatch(
      /text\.label:spongy: .*no longer names the spongy layer/,
    );
  });

  test("chloroplasts in the epidermis, or most photosynthesis in the spongy layer, are refused", async () => {
    expect(
      (
        await refusals({ text: { "label:epidermis": "Upper epidermis: does photosynthesis" } })
      ).join("\n"),
    ).toMatch(/has no chloroplasts/);
    expect(
      (await refusals({ text: { "label:spongy": "Spongy layer: most photosynthesis" } })).join(
        "\n",
      ),
    ).toMatch(/Most photosynthesis happens in the palisade layer/);
    expect(
      (await refusals({ text: { "label:palisade": "Palisade layer: air spaces" } })).join("\n"),
    ).toMatch(/air spaces are in the spongy layer/);
  });

  test("water in through the stomata, or gases in the vein, are refused", async () => {
    expect(
      (await refusals({ text: { "label:stoma": "Stoma: takes in water" } })).join("\n"),
    ).toMatch(/comes up from the roots/);
    expect((await refusals({ text: { "label:vein": "Vein: carries oxygen" } })).join("\n")).toMatch(
      /not gases/,
    );
  });

  test("each gas keeps its direction", async () => {
    expect(await refusals({ text: { "label:o2": "Oxygen given off" } })).toEqual([]);
    expect((await refusals({ text: { "label:co2": "Carbon dioxide out" } })).join("\n")).toMatch(
      /into the leaf/,
    );
    expect((await refusals({ text: { "label:o2": "Oxygen in" } })).join("\n")).toMatch(
      /out of the leaf/,
    );
    expect(
      (await refusals({ text: { "label:water": "Water vapour taken in" } })).join("\n"),
    ).toMatch(/transpiration/);
  });

  test("a true rewording is kept; only a false claim is refused (review of #743)", async () => {
    const fine: [string, string][] = [
      ["epidermis", "Upper epidermis: no chloroplasts"],
      ["epidermis", "Upper epidermis: does not photosynthesise"],
      ["palisade", "Palisade layer: few air spaces"],
      ["palisade", "Palisade cells: not loosely packed"],
      ["spongy", "Spongy layer: not most of the photosynthesis"],
      ["stoma", "Stoma: no water comes in here"],
      ["vein", "Vein: carries water, not gases like oxygen"],
      ["o2", "Oxygen made in photosynthesis"],
      ["o2", "Oxygen made in the leaf goes out"],
      ["co2", "Carbon dioxide used in photosynthesis"],
      ["water", "Water vapour lost in transpiration"],
    ];
    for (const [id, words] of fine)
      expect(await refusals({ text: { [`label:${id}`]: words } }), words).toEqual([]);
    const bad: [string, string][] = [
      ["epidermis", "Upper epidermis: full of chloroplasts"],
      ["palisade", "Palisade layer: big air spaces"],
      ["palisade", "Palisade layer: loosely packed"],
      ["palisade", "Palisade layer: few chloroplasts"],
      ["spongy", "Spongy layer: most photosynthesis"],
      ["stoma", "Stoma: takes in water"],
      ["vein", "Vein: carries oxygen"],
      ["o2", "Oxygen diffuses in"],
      ["o2", "Oxygen taken in through the stoma"],
      ["co2", "Carbon dioxide given off"],
      ["water", "Water vapour enters the leaf"],
    ];
    for (const [id, words] of bad)
      expect((await refusals({ text: { [`label:${id}`]: words } })).join("\n"), words).toMatch(
        new RegExp(`text.label:${id}`),
      );
  });

  test("the fill path refuses the same (what the writer's filler sends)", async () => {
    const r = await checkParams("leaf_section", {
      text: { "label:epidermis": "Upper epidermis: chloroplasts" },
    });
    // the filler never sets wording (text is the teacher's), so it is dropped, not refused
    expect(r.refusals).toEqual([]);
    expect((await checkParams("leaf_section", { level: "ks5" })).refusals.length).toBeGreaterThan(
      0,
    );
    expect(
      (await checkParams("leaf_section", { level: "ks4", labels: "names", gases: false })).refusals,
    ).toEqual([]);
  });
});

describe("leaf_section on a KS3 slide (the writer's path)", () => {
  test("every preset draws in Studio and Night Lab at the label floor, never falling back", async () => {
    for (const id of ["studio", "night-lab"]) {
      const theme = getTheme(id, "ks3" as never);
      const place = modelBodyRect("Inside a leaf", undefined, theme, "ks3" as never);
      for (const pre of (await model()).presets) {
        const ask = {
          key: "d",
          model: "leaf_section",
          intent: "Show the layers inside a leaf",
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

describe("leaf_section draws every build", () => {
  const BUILDS = ["section", "epidermis", "palisade", "spongy", "vein", "stomata", "gases"];
  test("each preset draws one frame per build, words clear of each other, nothing cut", async () => {
    const m = await model();
    const K = await kit();
    for (const pre of m.presets) {
      const P = K.withDefaults(m.params, pre.params);
      const steps = m.builds?.(P).steps.map((s) => s.key) ?? [];
      expect(steps).toEqual(BUILDS.filter((k) => steps.includes(k)));
      const d = await renderLibraryModel("leaf_section", P);
      expect(d.builds + 1).toBe(steps.length);
      expect(d.warnings).toEqual([]);
      expect(overlappingWords(d.svg)).toEqual([]);
      const seen = steps.map((_, k) => wordsAt(d.svg, k).join(" | "));
      for (let k = 1; k < seen.length; k++) expect(seen[k]).not.toBe(seen[k - 1]);
    }
  });

  test("the section opens with letters; each build swaps one letter for its name, top down", async () => {
    const m = await model();
    const P = (await kit()).withDefaults(m.params, {});
    const d = await renderLibraryModel("leaf_section", P);
    const keys = m.builds?.(P).steps.map((s) => s.key) ?? [];
    const at = (k: string) => wordsAt(d.svg, keys.indexOf(k)).join(" | ");
    expect(at("section")).toBe("A | B | C | D | E | F");
    expect(at("epidermis")).toMatch(/Upper epidermis: thin and clear/);
    expect(at("epidermis")).not.toMatch(/\bA\b/);
    expect(at("epidermis")).not.toMatch(/Palisade/);
    expect(at("palisade")).toMatch(/Palisade layer: packed with chloroplasts/);
    expect(at("spongy")).toMatch(/Spongy layer: air spaces/);
    expect(at("vein")).toMatch(/Vein: brings water/);
    expect(at("stomata")).toMatch(/Guard cells open and close the stoma/);
    expect(at("stomata")).toMatch(/Stoma: a pore/);
    expect(at("stomata")).not.toMatch(/Carbon dioxide/);
    expect(at("gases")).toMatch(/Carbon dioxide in \| Oxygen out \| Water vapour out/);
  });

  test("KS4 names the cuticle and the mesophyll, xylem and phloem", async () => {
    const m = await model();
    const P = (await kit()).withDefaults(m.params, { level: "ks4", labels: "names" });
    const d = await renderLibraryModel("leaf_section", P);
    const all = wordsAt(d.svg, (d.builds ?? 0) + 1).join(" | ");
    for (const w of ["Waxy cuticle", "Palisade mesophyll", "Spongy mesophyll", "Xylem and phloem"])
      expect(all).toContain(w);
  });
});

describe("leaf_section in the writer's menu and on question slides", () => {
  test("the Year 8 science menu lists it, first for a leaf lesson; not for Year 4", async () => {
    const entries = await catalogue("KS3-5", {
      yearGroup: "Year 8",
      subject: "Science",
      objectives: ["Describe how a leaf is adapted: palisade cells, spongy layer and stomata"],
    });
    expect(entries[0]?.id).toBe("leaf_section");
    const m = await model();
    const line = catalogueLines(entries).find((l) => l.startsWith("- leaf_section,"));
    expect(line).toBe(
      `- leaf_section, KS3, KS4: ${WRITER_WORDS.teaches?.leaf_section ?? m.meta.teaches}`,
    );
    const ks2 = await catalogue("KS2", { yearGroup: "Year 4", subject: "Science" });
    expect(ks2.map((e) => e.id)).not.toContain("leaf_section");
  });

  test("a question slide shows the lettered section and names nothing until the reveal", async () => {
    const m = await model();
    const P = (await kit()).withDefaults(m.params, {});
    const q = await questionStep("leaf_section", P);
    expect(q).toBe(0);
    const d = await renderLibraryModel("leaf_section", P, { step: q });
    const doc = new Window().document;
    doc.body.innerHTML = d.svg.replace(/<style>[\s\S]*?<\/style>/g, "");
    const open = [...doc.querySelectorAll("text")]
      .filter((t) => !t.closest("[data-reveal]"))
      .map((t) => (t.textContent ?? "").trim())
      .filter(Boolean);
    expect(open).toEqual(["A", "B", "C", "D", "E", "F"]);
  });

  test("KS4 lists it; Year 8 geography does not (the menu filters by subject)", async () => {
    const ks4 = await catalogue("KS3-5", { yearGroup: "Year 10", subject: "Biology" });
    expect(ks4.map((e) => e.id)).toContain("leaf_section");
    const geo = await catalogue("KS3-5", { yearGroup: "Year 8", subject: "Geography" });
    expect(geo.map((e) => e.id)).not.toContain("leaf_section");
  });

  test("question slides stay lettered at KS4, without the vein and without the gases", async () => {
    const m = await model();
    const K = await kit();
    const cases: [J, string[]][] = [
      [{ level: "ks4" }, ["A", "B", "C", "D", "E", "F", "G"]],
      [{ vein: false }, ["A", "B", "C", "D", "E"]],
      [{ gases: false }, ["A", "B", "C", "D", "E", "F"]],
    ];
    for (const [sent, letters] of cases) {
      const P = K.withDefaults(m.params, sent);
      const q = await questionStep("leaf_section", P);
      expect(q).toBe(0);
      const d = await renderLibraryModel("leaf_section", P, { step: q });
      const doc = new Window().document;
      doc.body.innerHTML = d.svg.replace(/<style>[\s\S]*?<\/style>/g, "");
      const open = [...doc.querySelectorAll("text")]
        .filter((t) => !t.closest("[data-reveal]"))
        .map((t) => (t.textContent ?? "").trim())
        .filter(Boolean);
      expect(open, JSON.stringify(sent)).toEqual(letters);
    }
  });

  test("what it cannot draw, and the gases only when the intent asks for them", () => {
    expect(capabilityRefusals("leaf_section", "the parts of a plant cell").length).toBeGreaterThan(
      0,
    );
    expect(
      capabilityRefusals("leaf_section", "the word equation for photosynthesis").length,
    ).toBeGreaterThan(0);
    expect(capabilityRefusals("leaf_section", "the layers inside a leaf")).toEqual([]);
    expect(panelsOff("leaf_section", {}, "the layers inside a leaf")).toEqual({ gases: false });
    expect(panelsOff("leaf_section", {}, "how carbon dioxide gets into a leaf")).toEqual({});
  });
});
