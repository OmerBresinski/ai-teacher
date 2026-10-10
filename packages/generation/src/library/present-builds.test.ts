import { afterAll, describe, expect, test } from "bun:test";
import { buildCount, PASSING_HIDDEN, svgAtBuild } from "@tj/slides/diagram-builds";
import { type Element, Window } from "happy-dom";
import { overlappingWords, questionStep } from "./fill";
import { endDrawThread } from "./guard";
import { MODEL_LOADERS } from "./models";
import { inspectDrawnSvg, kit, loadModel, renderLibraryModel } from "./render";
import type { J } from "./types";

/*
 * TEACH-247 part p: a library model plays its builds in Present, one per Next, from an opening
 * frame that already shows the picture (never a blank box), while the stored drawing, which every
 * other surface shows, is the finished picture. On a question slide the answer stays the reveal.
 */
const params = async (id: string, preset = 0): Promise<J> => {
  const m = await loadModel(id);
  return (await kit()).withDefaults(
    m?.params ?? { properties: {} },
    m?.presets[preset]?.params ?? {},
  );
};

const SHAPES = "path,rect,circle,ellipse,line,polyline,polygon,image,use";
/** What Present shows at frame `k`: the marks and the words, read from the markup. */
function frame(svg: string, k: number): { marks: number; words: string[] } {
  const doc = new Window().document;
  doc.body.innerHTML = svg.replace(/<style>[\s\S]*?<\/style>/g, "");
  const nums = (v: string | null) => (v ?? "").split(" ").filter(Boolean).map(Number);
  const hidden = (el: Element) =>
    Number(el.getAttribute("data-s") ?? 0) > k ||
    (el.hasAttribute("data-f") && !nums(el.getAttribute("data-f")).includes(k)) ||
    nums(el.getAttribute("data-x")).includes(k) ||
    el.hasAttribute("data-reveal");
  for (const el of [...doc.querySelectorAll("[data-s],[data-f],[data-x],[data-reveal]")])
    if (hidden(el)) el.remove();
  const root = doc.querySelector("svg");
  const words = [...(root?.querySelectorAll("text") ?? [])]
    .map((t) => (t.textContent ?? "").trim())
    .filter(Boolean);
  return { marks: root?.querySelectorAll(SHAPES).length ?? 0, words };
}

/** Every selector in a drawing's styles that depends on structure (`>`, `+`, `~`, `:nth-…`). */
function selectors(svg: string): string[] {
  const css = [...svg.matchAll(/<style>([\s\S]*?)<\/style>/g)]
    .map((m) => (m[1] ?? "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/\/\*[\s\S]*?\*\//g, ""))
    .join("\n");
  return [...css.matchAll(/([^{};]+)\{/g)]
    .map((m) => (m[1] ?? "").trim())
    .filter((sel) => !sel.startsWith("@") && !/^(from|to|[\d.]+%)/.test(sel))
    .filter((sel) => /[>+~]|:nth-|-child|-of-type|:has\(/.test(sel));
}

afterAll(() => endDrawThread());

describe("library models play their builds in Present", () => {
  test("every shipped model opens on a picture with words, then builds; hist_map falls back", async () => {
    const report: string[] = [];
    const stills: string[] = [];
    const failed: string[] = [];
    // `wrapClassed` moves a classed mark into a plain group: safe only while no rule selects on
    // structure (child, sibling or nth selectors), in the kit's tokens or a model's own style.
    const structural: string[] = [];
    for (const id of Object.keys(MODEL_LOADERS)) {
      const d = await renderLibraryModel(id, await params(id)).catch(() => undefined);
      if (!d) {
        failed.push(id);
        continue;
      }
      const open = frame(d.svg, 0);
      report.push(
        `${id}: ${d.builds} builds, opens on ${open.marks} marks, ${open.words.length} words`,
      );
      if (!d.builds) stills.push(id);
      for (const sel of selectors(d.svg)) structural.push(`${id}: ${sel}`);
      expect(open.words.length).toBeGreaterThan(0);
      expect(open.marks).toBeGreaterThan(2);
      expect(buildCount(d.svg)).toBe(d.builds);
    }
    console.log(report.join("\n"));
    // hist_map's coastline is over the slide's byte limit: the drawer draws that slide.
    expect(failed).toEqual(["hist_map"]);
    expect(stills).toEqual([]);
    expect(structural).toEqual([]);
  }, 120_000);

  test("the stored drawing is the finished picture: marks that come and go are hidden there", async () => {
    // counting_subitising counts "1, 2, 3 ..." on the dots and takes the numbers away at the end.
    const d = await renderLibraryModel("counting_subitising", await params("counting_subitising"));
    expect(d.svg).toContain(' data-f="');
    expect(d.svg).toContain(PASSING_HIDDEN);
    const end = frame(d.svg, d.builds);
    const opening = frame(d.svg, 0);
    expect(opening.words).toContain("1");
    expect(end.words).not.toContain("1");
    // Present shows a passing mark in its frames only.
    expect(svgAtBuild(d.svg, 0, { answer: false, motion: false })).toContain(
      '.slide [data-f~="0"][data-f][data-f]{opacity:1}',
    );
    // Words that never share a frame are not an overlap.
    expect(overlappingWords(d.svg)).toEqual([]);
    expect(inspectDrawnSvg(d.svg).words.some((w) => w.shown && !w.shown.includes(d.builds))).toBe(
      true,
    );
  });

  test("a mark the kit takes away for a build is away in that frame only (number_bonds)", async () => {
    const d = await renderLibraryModel("number_bonds", await params("number_bonds"));
    // The "Bonds to 5" list takes the stage for one build; the tree steps aside, then returns.
    const all = [...Array(d.builds + 1).keys()].map((k) => frame(d.svg, k));
    const list = all.findIndex((f) => f.words.some((w) => w.startsWith("Bonds to")));
    expect(list).toBeGreaterThan(0);
    expect(all[list]?.words).not.toContain("whole");
    expect(all[d.builds]?.words).toContain("whole");
    expect(all[d.builds]?.words.some((w) => w.startsWith("Bonds to"))).toBe(false);
  });

  test("no kit class shares a mark with the attribute Present hides it by (column_methods)", async () => {
    // `.slide .soft` outranks `[data-s="2"]{opacity:0}`: the carried 1 would show from the start.
    const d = await renderLibraryModel("column_methods", await params("column_methods"));
    const doc = new Window().document;
    doc.body.innerHTML = d.svg.replace(/<style>[\s\S]*?<\/style>/g, "");
    const classed = [...doc.querySelectorAll("[data-s],[data-reveal],[data-qn]")].filter((el) =>
      el.getAttribute("class")?.trim(),
    );
    expect(classed.length).toBe(0);
    const ones = (k: number) => frame(d.svg, k).words.filter((w) => w === "1").length;
    expect(ones(0)).toBeLessThan(ones(d.builds));
  });

  test("on a question slide the builds stop before the answer, which stays the reveal (bar_model)", async () => {
    const P = await params("bar_model", 2);
    const step = await questionStep("bar_model", P);
    const d = await renderLibraryModel("bar_model", P, { step });
    expect(d.builds).toBeGreaterThan(0);
    const doc = new Window().document;
    doc.body.innerHTML = d.svg.replace(/<style>[\s\S]*?<\/style>/g, "");
    // No answer mark is a build, and no build sits inside the answer.
    expect(doc.querySelectorAll("[data-reveal][data-s], [data-reveal] [data-s]").length).toBe(0);
    // Revealed, the drawing shows only its own marks, all inside its view box.
    const {
      viewBox: [vx, vy, vw, vh],
      words,
    } = inspectDrawnSvg(d.svg);
    const revealed = words.filter((w) => !w.shown || w.shown.includes(d.builds + 1));
    expect(revealed.some((w) => /\b24\b/.test(w.words))).toBe(true);
    for (const w of revealed) {
      expect(w.x0).toBeGreaterThanOrEqual(vx - 1);
      expect(w.y0).toBeGreaterThanOrEqual(vy - 1);
      expect(w.x1).toBeLessThanOrEqual(vx + vw + 1);
      expect(w.y1).toBeLessThanOrEqual(vy + vh + 1);
    }
    expect(revealed.some((w) => w.words.trim() === "20")).toBe(false);
    const last = frame(d.svg, d.builds);
    expect(last.words.some((w) => /\b24\b/.test(w))).toBe(false);
    expect(last.words.some((w) => /\b40\b/.test(w))).toBe(true);
  });

  test("a wrapped mark keeps its class and transform; the wrapper is a bare group", async () => {
    const d = await renderLibraryModel("column_methods", await params("column_methods"));
    const doc = new Window().document;
    doc.body.innerHTML = d.svg.replace(/<style>[\s\S]*?<\/style>/g, "");
    const wrapped = [...doc.querySelectorAll("g[data-s]")].filter(
      (g) => g.children.length === 1 && g.children[0]?.getAttribute("class")?.includes("soft"),
    );
    expect(wrapped.length).toBeGreaterThan(0);
    for (const g of wrapped) {
      expect([...g.attributes].map((a) => a.name).sort()).toEqual(["data-s"]);
      expect(g.children[0]?.hasAttribute("data-s")).toBe(false);
    }
  });

  test("over the byte limit with its builds, the drawing falls back to the still, not the drawer", async () => {
    const P = await params("counting_subitising");
    const full = await renderLibraryModel("counting_subitising", P);
    expect(full.builds).toBeGreaterThan(0);
    const still = await renderLibraryModel("counting_subitising", P, { maxBytes: full.bytes - 1 });
    expect(still.builds).toBe(0);
    expect(still.bytes).toBeLessThan(full.bytes);
    expect(still.svg).not.toMatch(/ data-(s|f|x|builds)="/);
    // The still is the finished picture: the same words as Present's last frame.
    expect(frame(still.svg, 0).words.sort()).toEqual(frame(full.svg, full.builds).words.sort());
    await expect(
      renderLibraryModel("counting_subitising", P, { maxBytes: still.bytes - 1 }),
    ).rejects.toThrow(/over the slide's limit/);
  });

  test("on a question slide the stored drawing is Present's question frame: passing marks match", async () => {
    const asks: [string, number][] = [
      ["bar_model", 2],
      ["fractions", 0],
      ["collision_theory", 0],
      ["equal_groups", 0],
    ];
    for (const [id, preset] of asks) {
      const P = await params(id, preset);
      const step = await questionStep(id, P);
      if (step === undefined) continue;
      const d = await renderLibraryModel(id, P, { step });
      const doc = new Window().document;
      doc.body.innerHTML = d.svg.replace(/<style>[\s\S]*?<\/style>/g, "");
      // A mark shown at the question frame is never a passing mark (it would be hidden on the
      // still): it is kept, or restored as data-qn and leaves at the reveal.
      for (const el of [...doc.querySelectorAll("[data-f]")])
        expect(el.getAttribute("data-f")?.split(" ").map(Number)).not.toContain(d.builds);
      // What the editor shows (no answer, no passing marks) is what Present shows before the reveal.
      for (const el of [...doc.querySelectorAll("[data-reveal],[data-f]")]) el.remove();
      const still = [...doc.querySelectorAll("text")]
        .map((t) => (t.textContent ?? "").trim())
        .filter(Boolean);
      expect(frame(d.svg, d.builds).words.sort()).toEqual(still.sort());
    }
  });
});
