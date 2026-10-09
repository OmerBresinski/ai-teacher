import { afterAll, describe, expect, test } from "bun:test";
import { hasRevealPart, svgAtBuild } from "@tj/slides/diagram-builds";
import { Window } from "happy-dom";
import { questionSafe } from "../writer/diagrams";
import { libraryDiagram, questionStep } from "./fill";
import { endDrawThread } from "./guard";
import { kit, loadModel, renderLibraryModel } from "./render";
import type { J } from "./types";

/*
 * TEACH-247 part i: a library model on a question slide is a still that opens complete except for
 * its answer, which the slide's reveal shows. The editor and exports show the question (the
 * drawing's own style hides the answer), as the drawer's question slides do.
 */
const params = async (id: string, sent: J, preset?: number) => {
  const m = await loadModel(id);
  const base = preset === undefined ? {} : (m?.presets[preset]?.params ?? {});
  return (await kit()).withDefaults(m?.params ?? { properties: {} }, { ...base, ...sent });
};

/** The words a pupil sees at the opening frame and after the reveal, read from the markup. */
function seen(svg: string): { open: string[]; reveal: string[]; openMarks: number } {
  const win = new Window();
  const doc = win.document;
  doc.body.innerHTML = svg.replace(/<style>[\s\S]*?<\/style>/g, "");
  const open: string[] = [];
  const reveal: string[] = [];
  for (const t of [...doc.querySelectorAll("text")]) {
    const w = (t.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!w) continue;
    if (!t.closest("[data-reveal]")) open.push(w);
    if (!t.closest("[data-qn]")) reveal.push(w);
  }
  const openMarks = [...doc.querySelectorAll("circle,rect,path")].filter(
    (e) => !e.closest("[data-reveal]"),
  ).length;
  win.close();
  return { open, reveal, openMarks };
}
const hasNumber = (words: string[], n: number) =>
  words.some((w) => new RegExp(`(^|[^\\d.])${n}([^\\d.]|$)`).test(w));

describe("a library model on a question slide", () => {
  test("equal_groups, one half of 16: opens on the counters and rings, the 8 only at the reveal", async () => {
    const P = await params("equal_groups", { groups: 2, size: 8, division: "sharing" });
    const step = await questionStep("equal_groups", P);
    expect(step).toBeDefined();
    const d = await renderLibraryModel("equal_groups", P, { step });
    expect(d.builds === 0).toBe(true);
    expect(hasRevealPart(d.svg)).toBe(true);
    const s = seen(d.svg);
    expect(s.openMarks).toBeGreaterThan(16); // never an empty box: the 16 counters and the rings
    expect(hasNumber(s.open, 8)).toBe(false);
    expect(hasNumber(s.reveal, 8)).toBe(true);
    // the stored drawing (editor, thumbnails, PDF, PPTX) hides the answer by its own style
    expect(d.svg).toContain('[data-reveal="1"]{opacity:0}');
    // Present: closed before the reveal, open after it (the reveal rule outranks the hold)
    expect(svgAtBuild(d.svg, 0, { answer: false, motion: false })).not.toContain(
      "[data-reveal]{opacity:1}",
    );
    expect(svgAtBuild(d.svg, 0, { answer: true, motion: false })).toContain(
      '[data-reveal="1"][data-reveal]{opacity:1}',
    );
  });

  test("bar_model, 3/5 of 40: opens on the bar and what is known, the answer 24 only at the reveal", async () => {
    const P = await params("bar_model", {}, 2);
    const step = await questionStep("bar_model", P);
    expect(step).toBeDefined();
    const d = await renderLibraryModel("bar_model", P, { step });
    expect(d.builds === 0).toBe(true);
    const s = seen(d.svg);
    expect(s.openMarks).toBeGreaterThan(3);
    expect(hasNumber(s.open, 40)).toBe(true);
    expect(hasNumber(s.open, 24)).toBe(false);
    expect(hasNumber(s.reveal, 24)).toBe(true);
  });

  test("a slide that is not a question keeps a plain still: no held answer, builds === 0", async () => {
    const d = await renderLibraryModel(
      "equal_groups",
      await params("equal_groups", { groups: 2, size: 8, division: "sharing" }),
    );
    expect(d.builds === 0).toBe(true);
    expect(hasRevealPart(d.svg)).toBe(false);
  });

  test("libraryDiagram on a question slide returns the held drawing", async () => {
    const r = await libraryDiagram(
      {
        key: "diagram",
        model: "equal_groups",
        intent: "Share sixteen counters between two rings.",
        words: "Find one half of 16",
        heading: "Find one half of 16",
        caption: "Share 16 counters into two equal groups.",
        yearGroup: "Year 2",
        lesson: "Maths: halves",
        question: true,
      },
      async () => ({ groups: 2, size: 8, division: "sharing" }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(hasRevealPart(r.drawing.svg)).toBe(true);
  });
});

describe("the drawer's fallback on a question slide prints no answer", () => {
  test("equal groups show ? for each count; fraction names go, letters stay", () => {
    expect(questionSafe({ kind: "equal-groups", total: 16, groups: 2 })).toMatchObject({
      unknown: true,
    });
    const f = questionSafe({
      kind: "fraction-shapes",
      shapes: [
        { shape: "circle", parts: 2, shaded: 1, name: "A" },
        { shape: "square", parts: 4, shaded: 1, name: "1/4" },
      ],
    }) as { shapes: J[] };
    expect(f.shapes[0]?.name).toBe("A");
    expect(f.shapes[1]?.name).toBeUndefined();
  });
});

afterAll(() => endDrawThread());
