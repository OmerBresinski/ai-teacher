import { afterAll, describe, expect, test } from "bun:test";
import { type Element, Window } from "happy-dom";
import { endDrawThread } from "./guard";
import { kit, loadModel, renderLibraryModel } from "./render";
import type { J } from "./types";

/*
 * TEACH-247 part cr: what sits on a balance pan rests on it. The right pan of 3x + 2 = x + 10 held
 * its x bag at the bottom and its cubes on top; taking x from both sides removed the bag and left
 * the cubes about 90 px above the pan for the rest of the slide. Every row of cubes, bags or weights,
 * at every build, sits on its pan or on something visible under it.
 */
afterAll(() => endDrawThread());

type Box = { x0: number; x1: number; y0: number; y1: number; at: string };
const GAP = 20; // the widest gap the packing leaves between rows (18 between shared groups)

/** Is the element shown at build k (every data-s at or before k, every data-f listing k)? */
function shown(el: Element, k: number): boolean {
  for (let e: Element | null = el; e; e = e.parentElement) {
    const s = e.getAttribute("data-s");
    if (s !== null && Number(s) > k) return false;
    const f = e.getAttribute("data-f");
    if (f !== null && !f.split(" ").includes(String(k))) return false;
  }
  return true;
}
/** The outline of an item mark: its first rect (cube, bag) or path (weight). */
function boxOf(item: Element): Box | undefined {
  const r = item.querySelector(":scope > rect");
  if (r) {
    const x = Number(r.getAttribute("x"));
    const y = Number(r.getAttribute("y"));
    const w = Number(r.getAttribute("width"));
    const h = Number(r.getAttribute("height"));
    return { x0: x, x1: x + w, y0: y, y1: y + h, at: `${x},${y}` };
  }
  const d = item.querySelector(":scope > path")?.getAttribute("d");
  if (!d) return undefined;
  const n = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const xs = n.filter((_, i) => i % 2 === 0);
  const ys = n.filter((_, i) => i % 2 === 1);
  return {
    x0: Math.min(...xs),
    x1: Math.max(...xs),
    y0: Math.min(...ys),
    y1: Math.max(...ys),
    at: `${xs[0]},${ys[0]}`,
  };
}

/** Every mark at build k that floats: not on its pan and not on a visible mark under it. */
export function floating(svg: string, builds: number): string[] {
  const doc = new Window().document;
  doc.body.innerHTML = svg.replace(/<style>[\s\S]*?<\/style>/g, "");
  const out: string[] = [];
  const pans = [...doc.querySelectorAll("path")].filter((p) =>
    (p.getAttribute("style") ?? "").includes("fill: var(--metal);"),
  );
  for (const [pi, pan] of pans.entries()) {
    const panTop = Number(/M\s*-?[\d.]+\s+(-?[\d.]+)/.exec(pan.getAttribute("d") ?? "")?.[1]);
    const group = pan.parentElement as unknown as Element;
    // item marks: the outermost .pop groups on this pan that draw a body
    const items = [...group.querySelectorAll("g.pop")].filter(
      (g) =>
        !g.parentElement?.closest("g.pop") &&
        g.querySelector(":scope > rect.body, :scope > path.body"),
    ) as unknown as Element[];
    for (let k = 0; k <= builds; k++) {
      const vis = items
        .filter((g) => shown(g, k))
        .map(boxOf)
        .filter((b): b is Box => !!b);
      // a row (marks sharing a bottom edge) rests on the pan, or on a visible mark under its span
      for (const y1 of new Set(vis.map((b) => b.y1))) {
        const row = vis.filter((b) => b.y1 === y1);
        const x0 = Math.min(...row.map((b) => b.x0));
        const x1 = Math.max(...row.map((b) => b.x1));
        const onPan = y1 <= panTop && panTop - y1 <= GAP;
        const onMark = vis.some((o) => o.x0 < x1 && x0 < o.x1 && o.y0 >= y1 && o.y0 - y1 <= GAP);
        if (!onPan && !onMark)
          out.push(
            `pan ${pi} build ${k}: row at ${row[0]?.at} is ${Math.round(panTop - y1)} above the pan`,
          );
      }
    }
  }
  return out;
}

const CASES: [string, J][] = [
  [
    "3x + 2 = x + 10, weights",
    {
      balance: { left: "3x + 2", right: "x + 10", show: "weights", solve: true },
      unknown: "letter",
      letter: "x",
    },
  ],
  [
    "x + 12 = 3x + 4",
    {
      balance: { left: "x + 12", right: "3x + 4", show: "cubes", solve: true },
      unknown: "letter",
      letter: "x",
    },
  ],
  [
    "2x + 5 = x + 9",
    {
      balance: { left: "2x + 5", right: "x + 9", show: "cubes", solve: true },
      unknown: "letter",
      letter: "x",
    },
  ],
  [
    "4x = 2x + 6",
    {
      balance: { left: "4x", right: "2x + 6", show: "cubes", solve: true },
      unknown: "letter",
      letter: "x",
    },
  ],
  [
    "2a + 3 = 11, weights",
    {
      balance: { left: "2a + 3", right: "11", show: "weights", solve: true },
      unknown: "letter",
      letter: "a",
    },
  ],
  [
    "3 + ? = 7",
    { balance: { left: "3 + ?", right: "7", show: "cubes", solve: true }, unknown: "box" },
  ],
  [
    "4 + 5 = 10, weights",
    { balance: { left: "4 + 5", right: "10", show: "weights", solve: false }, unknown: "box" },
  ],
];

describe("balance_equations: what sits on a pan rests on it (TEACH-247 part cr)", () => {
  test("every preset, every build", async () => {
    const m = await loadModel("balance_equations");
    if (!m) throw new Error("no balance_equations");
    const K = await kit();
    const bad: string[] = [];
    for (const pre of m.presets) {
      const d = await renderLibraryModel("balance_equations", K.withDefaults(m.params, pre.params));
      for (const f of floating(d.svg, d.builds)) bad.push(`${pre.id}: ${f}`);
    }
    expect(bad).toEqual([]);
  }, 60_000);

  test("other equations and number weights, every build", async () => {
    const m = await loadModel("balance_equations");
    if (!m) throw new Error("no balance_equations");
    const K = await kit();
    const bad: string[] = [];
    for (const [name, p] of CASES) {
      const P = K.withDefaults(m.params, { title: name, mode: "balance", ...p });
      const v = m.validate(P);
      expect(v.refusals, name).toEqual([]);
      const d = await renderLibraryModel("balance_equations", P);
      for (const f of floating(d.svg, d.builds)) bad.push(`${name}: ${f}`);
    }
    expect(bad).toEqual([]);
  }, 60_000);

  test("the check sees a cube left in the air", () => {
    const svg = `<svg><g><path d="M0 446 L 300 446 L 280 464 L 20 464 Z" style="fill: var(--metal);" class="body"></path><g><g class="pop" data-f="0"><rect x="100" y="368" width="74" height="74" class="body"></rect></g><g class="pop"><rect x="100" y="316" width="46" height="46" class="body"></rect></g></g></g></svg>`;
    expect(floating(svg, 1)).toEqual(["pan 0 build 1: row at 100,316 is 84 above the pan"]);
  });
});
