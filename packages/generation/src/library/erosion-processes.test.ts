import { afterAll, describe, expect, test } from "bun:test";
import { svgAtBuild } from "@tj/slides/diagram-builds";
import { modelBodyRect } from "@tj/slides/templates";
import { getTheme } from "@tj/slides/themes";
import { type Element, Window } from "happy-dom";
import { catalogue } from "./catalogue";
import { capabilityRefusals, libraryDiagram, overlappingWords, questionStep } from "./fill";
import { endDrawThread } from "./guard";
import { kit, loadModel, renderLibraryModel } from "./render";
import type { J } from "./types";

/*
 * TEACH-247 part cl: erosion and transport processes. A Y9 rivers deck listed the four erosion
 * processes as numbered text with no pictures; the standard teaching is four small diagrams. The
 * model draws each process's own mechanism and names it one build at a time, each name first a
 * letter so a question slide can ask for it.
 */
afterAll(() => endDrawThread());

const model = async () => {
  const m = await loadModel("erosion_processes");
  if (!m) throw new Error("no erosion_processes model");
  return m;
};
const refusals = async (p: J) => {
  const m = await model();
  const v = m.validate((await kit()).withDefaults(m.params, p));
  return v.refusals.map((r) => `${r.path}: ${r.reason}`);
};
/** The words Present shows at build `k` (a passing letter only on its own frames). */
function wordsAt(svg: string, k: number): string[] {
  const doc = new Window().document;
  doc.body.innerHTML = svgAtBuild(svg, k, { answer: true, motion: false }).replace(
    /<style>[\s\S]*?<\/style>/g,
    "",
  );
  for (const el of [...doc.querySelectorAll("[data-s]")])
    if (Number(el.getAttribute("data-s")) > k) el.remove();
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

describe("erosion_processes refuses a process described as another", () => {
  test("the presets are true", async () => {
    const m = await model();
    for (const p of m.presets) expect(await refusals(p.params)).toEqual([]);
  });

  test("a process listed twice is refused", async () => {
    expect((await refusals({ erosion: ["abrasion", "attrition", "abrasion"] })).join("\n")).toMatch(
      /erosion\.2: Abrasion is in the list twice/,
    );
  });

  test("a reworded line that describes the wrong process is refused", async () => {
    const bad: [string, string, RegExp][] = [
      [
        "attrition",
        "Rocks wear away the river banks",
        /wearing the bed, banks or cliff is abrasion/,
      ],
      ["abrasion", "Rocks hit each other and break", /rocks hitting each other is attrition/],
      ["hydraulic", "Pebbles carried by the water hit the bank", /is abrasion/],
      ["solution", "Rocks scrape the bed", /dissolving/],
      ["solution", "The river wears the bed away", /must say so/],
      ["traction", "Boulders bounce along", /bouncing is saltation/],
      ["saltation", "Pebbles roll along the bed", /rolling is traction/],
      ["suspension", "Minerals dissolved in the water", /dissolved minerals are solution/],
      ["dissolved", "Silt floating in the water", /suspension/],
    ];
    for (const [id, line, why] of bad)
      expect((await refusals({ text: { [`label:line:${id}`]: line } })).join("\n"), line).toMatch(
        why,
      );
    expect(
      await refusals({ text: { "label:line:attrition": "Stones collide and get smaller" } }),
    ).toEqual([]);
    expect(
      await refusals({ text: { "label:line:solution": "Acidic water dissolves limestone" } }),
    ).toEqual([]);
  });

  test("a reworded name keeps its process's name", async () => {
    expect(await refusals({ text: { "label:name:solution": "Solution (corrosion)" } })).toEqual([]);
    expect((await refusals({ text: { "label:name:abrasion": "Scraping" } })).join("\n")).toMatch(
      /no longer names abrasion/,
    );
  });
});

describe("erosion_processes on a KS3 slide (the writer's path)", () => {
  test("every preset draws in Studio and Night Lab at the label floor, never falling back", async () => {
    for (const id of ["studio", "night-lab"]) {
      const theme = getTheme(id, "ks3" as never);
      const place = modelBodyRect("How rivers erode", undefined, theme, "ks3" as never);
      for (const pre of (await model()).presets) {
        const ask = {
          key: "d",
          model: "erosion_processes",
          intent: "Show the four erosion processes",
          words: "",
          heading: "",
          caption: "",
          yearGroup: "Year 9",
          lesson: "Geography: rivers",
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

describe("erosion_processes draws every build", () => {
  test("each preset draws one frame per build, words clear of each other, nothing cut", async () => {
    const m = await model();
    const K = await kit();
    for (const pre of m.presets) {
      const P = K.withDefaults(m.params, pre.params);
      const steps = m.builds?.(P).steps.map((s) => s.key) ?? [];
      expect(steps[0]).toBe("picture");
      const d = await renderLibraryModel("erosion_processes", P);
      expect(d.builds + 1).toBe(steps.length);
      expect(d.warnings).toEqual([]);
      expect(overlappingWords(d.svg)).toEqual([]);
    }
  });

  test("the pictures open with letters; each build names one process, in order", async () => {
    const m = await model();
    const P = (await kit()).withDefaults(m.params, {});
    const d = await renderLibraryModel("erosion_processes", P);
    const keys = m.builds?.(P).steps.map((s) => s.key) ?? [];
    expect(keys).toEqual(["picture", "hydraulic", "abrasion", "attrition", "solution"]);
    const at = (k: string) => wordsAt(d.svg, keys.indexOf(k)).join(" | ");
    expect(at("picture")).toBe("A | B | C | D");
    expect(at("hydraulic")).toMatch(/^Hydraulic action \| Water forces air into cracks/);
    expect(at("hydraulic")).not.toMatch(/Abrasion/);
    expect(at("abrasion")).toMatch(/Abrasion \| Rocks carried by the river scrape the bed/);
    expect(at("solution")).toMatch(/Solution \| Water dissolves some rocks/);
    expect(at("solution")).not.toMatch(/\b[ABCD]\b \|/);
  });

  test("names only, and the transport view", async () => {
    const m = await model();
    const K = await kit();
    const names = await renderLibraryModel(
      "erosion_processes",
      K.withDefaults(m.params, { explain: false }),
    );
    expect(wordsAt(names.svg, names.builds)).toEqual([
      "Hydraulic action",
      "Abrasion",
      "Attrition",
      "Solution",
    ]);
    const tr = await renderLibraryModel(
      "erosion_processes",
      K.withDefaults(m.params, { view: "transport", explain: false }),
    );
    expect(wordsAt(tr.svg, tr.builds)).toEqual(["Traction", "Saltation", "Suspension", "Solution"]);
  });
});

describe("erosion_processes in the writer's menu and on question slides", () => {
  test("the Year 9 geography menu lists it, first for an erosion lesson; not for Year 4", async () => {
    const entries = await catalogue("KS3-5", {
      yearGroup: "Year 9",
      subject: "Geography",
      objectives: ["Describe the processes of erosion: hydraulic action, abrasion and attrition"],
    });
    expect(entries[0]?.id).toBe("erosion_processes");
    const ks2 = await catalogue("KS2", { yearGroup: "Year 4", subject: "Geography" });
    expect(ks2.map((e) => e.id)).not.toContain("erosion_processes");
  });

  test("a question slide opens on the lettered pictures", async () => {
    const m = await model();
    expect(await questionStep("erosion_processes", (await kit()).withDefaults(m.params, {}))).toBe(
      0,
    );
  });

  test("what it cannot draw", () => {
    expect(
      capabilityRefusals("erosion_processes", "how an ox-bow lake forms").length,
    ).toBeGreaterThan(0);
    expect(
      capabilityRefusals("erosion_processes", "caves, arches and stacks").length,
    ).toBeGreaterThan(0);
    expect(capabilityRefusals("erosion_processes", "the four processes of erosion")).toEqual([]);
  });
});
