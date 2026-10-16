import { describe, expect, test } from "bun:test";
import { ADAPTIVE_TEMPLATE_IDS, type LayoutRef } from "@tj/domain/documents";
import { boundPath } from "./layout-paths";
import {
  ADAPTIVE_SPECS,
  addItem,
  canSplit,
  editItem,
  FRAME_MARGIN,
  fieldStates,
  fitInto,
  getAtPath,
  itemsOf,
  layoutGroup,
  minFitScale,
  NotAdaptiveError,
  relayout,
  removeItem,
  setAtPath,
  splitItems,
  stageOf,
} from "./relayout";
import type { FieldReport } from "./templates";
import { resolveFontSize, resolveTextStyle } from "./text-style";
import { atKeyStage, getTheme } from "./themes";

/** A template's field report as master's `FieldReport` (only path, cap and hardMax are read here). */
const report = (path: string, cap: number, hardMax: number): FieldReport => ({
  field: path,
  path,
  chars: 0,
  cap,
  hardMax,
  tight: false,
  over: false,
});

/*
 * TEACH-205 part b: re-laying an adaptive group from its LayoutRef. The ref's input goes back
 * through `layoutTemplate`; the field states follow ruling 215 (under the cap nothing, over the cap
 * tight with a counter, past the hard maximum over).
 */

const theme = getTheme("reading-room");
const cards = (n: number) =>
  ["Roots", "Stem", "Leaves", "Flower"].slice(0, n).map((label) => ({
    label,
    text: `The ${label.toLowerCase()} do one job.`,
  }));
const ref = (n: number, heading = "Parts of a plant"): LayoutRef => ({
  template: "cards-grid",
  input: { heading, grid: cards(n) },
});

describe("relayout", () => {
  test("re-runs the template: three cards give three card boxes, four give four", () => {
    const three = relayout(ref(3), theme, "ks3");
    const four = relayout(ref(4), theme, "ks3");
    const boxes = (els: { name?: string }[]) => els.filter((e) => e.name === "Card").length;
    expect(boxes(three.elements)).toBe(3);
    expect(boxes(four.elements)).toBe(4);
    expect(three.result.over).toEqual([]);
  });

  test("the frame is the elements' bounds plus a margin, inside the slide", () => {
    const { elements, frame } = relayout(ref(3), theme, "ks3");
    const minX = Math.min(...elements.map((e) => e.x));
    const minY = Math.min(...elements.map((e) => e.y));
    const maxX = Math.max(...elements.map((e) => e.x + e.w));
    const maxY = Math.max(...elements.map((e) => e.y + e.h));
    expect(frame.x).toBe(Math.max(0, minX - FRAME_MARGIN));
    expect(frame.y).toBe(Math.max(0, minY - FRAME_MARGIN));
    expect(frame.x + frame.w).toBe(Math.min(960, maxX + FRAME_MARGIN));
    expect(frame.y + frame.h).toBe(Math.min(540 - 19, maxY + FRAME_MARGIN));
  });

  test("text children get stable ids from the group id and their input path", () => {
    const a = relayout(ref(3), theme, "ks3", "g1");
    const b = relayout(ref(3), theme, "ks3", "g1");
    expect(a.elements.map((e) => e.id)).toEqual(b.elements.map((e) => e.id));
    expect(a.paths["g1:grid.1.text"]).toBe("grid.1.text");
    expect(a.elements.some((e) => e.id === "g1:heading")).toBe(true);
    expect(new Set(a.elements.map((e) => e.id)).size).toBe(a.elements.length);
  });

  test("layoutGroup wraps the laid elements in one group with its ref and frame", () => {
    const g = layoutGroup(ref(3), theme, "ks3", "g9");
    expect(g.type).toBe("group");
    expect(g.layout?.template).toBe("cards-grid");
    expect(g.layout?.frame).toEqual({ x: g.x, y: g.y, w: g.w, h: g.h });
    // Children sit where the template put them, inside the frame's margin.
    const { elements } = relayout(ref(3), theme, "ks3");
    expect(g.x + Math.min(...g.children.map((c) => c.x))).toBe(
      Math.min(...elements.map((e) => e.x)),
    );
    expect(g.y + Math.min(...g.children.map((c) => c.y))).toBe(
      Math.min(...elements.map((e) => e.y)),
    );
    expect(Math.min(...g.children.map((c) => c.x))).toBeGreaterThanOrEqual(0);
  });
});

describe("fields (ruling 215)", () => {
  test("words inside the published cap are ok", () => {
    const { fields } = relayout(ref(3), theme, "ks3");
    const body = fields.find((f) => f.path === "grid.0.text");
    expect(body?.cap).toBeGreaterThan(0);
    expect(body?.state).toBe("ok");
  });

  test("a body over its cap that still fits is tight, with its count", () => {
    const r = ref(3);
    const cap = relayout(r, theme, "ks3").fields.find((f) => f.path === "grid.0.text")?.cap ?? 0;
    const text = "Roots hold the plant and take in water from the soil all day long ".repeat(4);
    const long = setAtPath(r, "grid.0.text", text.slice(0, cap + 8).trim());
    const f = relayout(long, theme, "ks3").fields.find((x) => x.path === "grid.0.text");
    expect(f?.chars).toBeGreaterThan(cap);
    expect(["tight", "over"]).toContain(f?.state as string);
  });

  test("a body the layout cannot hold is over", () => {
    const huge = setAtPath(ref(4), "grid.0.text", "word ".repeat(200).trim());
    const { fields, result } = relayout(huge, theme, "ks3");
    expect(result.over.length).toBeGreaterThan(0);
    expect(fields.find((f) => f.path === "grid.0.text")?.state).toBe("over");
  });

  test("a template that publishes no limits has no fields; one that does is read", () => {
    const row: LayoutRef = { template: "items-row", input: { items: [{ title: "a".repeat(30) }] } };
    const bare = { slide: { kind: "content" as const, elements: [] }, over: [] };
    expect(fieldStates(row, bare, "ks3")).toEqual([]);
    const reported = { ...bare, fields: [report("items.0.title", 20, 40)] };
    expect(fieldStates(row, reported, "ks3")).toEqual([
      { path: "items.0.title", chars: 30, cap: 20, hardMax: 40, state: "tight" },
    ]);
  });

  test("a template layoutTemplate does not lay out yet is refused, not drawn", () => {
    // Every adaptive id is live on master now, so the fixture is a stored ref to a template this
    // build does not have (a lesson saved by a newer build).
    const future = { template: "not-a-layout-yet" as LayoutRef["template"], input: {} };
    expect(() => relayout(future, theme, "ks3")).toThrow(NotAdaptiveError);
  });
});

describe("item operations", () => {
  test("add inserts a blank item at the index; refused at the template's max", () => {
    const r3 = ref(3);
    const r4 = addItem(r3, 1, "ks3");
    expect(r4.ok).toBe(true);
    if (!r4.ok) return;
    expect(itemsOf(r4.ref)).toHaveLength(4);
    expect((itemsOf(r4.ref)[2] as { label: string }).label).toBe("Stem");
    const r5 = addItem(r4.ref, 4, "ks3");
    expect(r5.ok).toBe(false);
    if (!r5.ok) expect(r5.reason).toMatch(/4/);
  });

  test("remove takes the item out; refused at the template's min", () => {
    const r = removeItem(ref(3), 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(itemsOf(r.ref).map((c) => (c as { label: string }).label)).toEqual(["Roots", "Leaves"]);
    const again = removeItem(r.ref, 0);
    expect(again.ok).toBe(false);
  });

  test("split keeps the leading items and moves the trailing ones, every word kept", () => {
    const r = ref(4);
    expect(canSplit(r)).toBe(true);
    const { head, tail } = splitItems(r);
    expect(itemsOf(head)).toHaveLength(2);
    expect(itemsOf(tail)).toHaveLength(2);
    expect(tail.input.heading).toBe("Parts of a plant (continued)");
    expect(head.input.heading).toBe("Parts of a plant");
    expect([...itemsOf(head), ...itemsOf(tail)]).toEqual(itemsOf(r));
    // A second split of the continuation does not stack the word.
    expect(splitItems(tail).tail.input.heading).toBe("Parts of a plant (continued)");
  });

  test("split is offered from two items up, below twice the min too (Greg, 14 Oct)", () => {
    expect(canSplit(ref(3))).toBe(true);
    expect(canSplit(ref(2))).toBe(true);
    const { head, tail } = splitItems(ref(3));
    expect(itemsOf(head)).toHaveLength(2);
    expect(itemsOf(tail)).toHaveLength(1);
    expect(ADAPTIVE_SPECS["split-compare"].continuation).toBe(true);
    expect(ADAPTIVE_SPECS["items-row"].continuation).toBe(true);
    expect(ADAPTIVE_SPECS["panel-list"].continuation).toBe(true);
  });

  test("setAtPath edits one value without touching the source", () => {
    const r = ref(2);
    const next = setAtPath(r, "grid.1.label", "Trunk");
    expect((itemsOf(next)[1] as { label: string }).label).toBe("Trunk");
    expect((itemsOf(r)[1] as { label: string }).label).toBe("Stem");
  });

  test("stageOf reads the theme's bound stage, else the lesson's band", () => {
    expect(stageOf(getTheme("reading-room", "ks1"), undefined)).toBe("ks1");
    expect(stageOf(theme, "post16")).toBe("ks5");
    expect(stageOf(theme, "eyfs")).toBe("ks1");
    expect(stageOf(theme, undefined)).toBe("ks3");
  });
});

describe("layout paths", () => {
  test("boundPath reads a child's field from its id", () => {
    expect(boundPath("g1", "g1:grid.1.text")).toBe("grid.1.text");
    expect(boundPath("g1", "g1:4")).toBeUndefined();
    expect(boundPath("g1", "other")).toBeUndefined();
  });
});

describe("blank items keep the icon row (placeholder)", () => {
  const spec = ADAPTIVE_SPECS["items-row"];
  const row = (icon: string): LayoutRef => ({
    template: "items-row",
    input: {
      heading: "H",
      items: [
        { name: "Heart", text: "t", icon: "heart" },
        { name: "New item", text: "t", icon },
      ],
    },
  });

  test("a blank item carries the placeholder icon", () => {
    expect((spec.blank() as { icon?: string }).icon).toBe(spec.placeholderIcon);
  });

  test("a committed name re-resolves a placeholder icon; no match keeps the placeholder", () => {
    const was = spec.iconFor;
    spec.iconFor = (name) => (name.toLowerCase() === "lungs" ? "lungs" : null);
    try {
      const hit = editItem(row("placeholder"), "items.1.name", "Lungs");
      expect(getAtPath(hit, "items.1.icon")).toBe("lungs");
      const miss = editItem(row("placeholder"), "items.1.name", "Spleen-ish");
      expect(getAtPath(miss, "items.1.icon")).toBe("placeholder");
      // An icon the teacher or writer chose is never replaced by a rename.
      const chosen = editItem(row("heart"), "items.1.name", "Lungs");
      expect(getAtPath(chosen, "items.1.icon")).toBe("heart");
    } finally {
      spec.iconFor = was;
    }
  });
});

describe("fitInto (a resized layout group)", () => {
  test("one scale for boxes and type, centred; nothing squashed", () => {
    const els = [
      { x: 0, y: 0, w: 400, h: 50, style: { fontSize: 40 } },
      { x: 0, y: 60, w: 400, h: 40, style: { fontSize: 20 } },
    ];
    const out = fitInto(els, { x: 0, y: 0, w: 400, h: 100 }, { x: 100, y: 0, w: 200, h: 200 });
    // k = min(0.5, 2) = 0.5, centred vertically in the 200 tall box.
    expect(out[0]).toMatchObject({ x: 100, y: 75, w: 200, h: 25, style: { fontSize: 20 } });
    expect(out[1]).toMatchObject({ x: 100, y: 105, w: 200, h: 20, style: { fontSize: 10 } });
    expect((out[0]?.y ?? 0) + (out[0]?.h ?? 0)).toBeLessThanOrEqual(out[1]?.y ?? 0);
  });
});

describe("integration round 3", () => {
  test("a field whose count is never comfortable (cap 0) counts against its hard max, never n/0", () => {
    const row: LayoutRef = { template: "items-row", input: { items: [{ name: "a".repeat(30) }] } };
    const bare = { slide: { kind: "content" as const, elements: [] }, over: [] };
    const zero = { ...bare, fields: [report("items.0.name", 0, 20)] };
    expect(fieldStates(row, zero, "ks3")).toEqual([
      { path: "items.0.name", chars: 30, cap: 20, hardMax: 20, state: "over" },
    ]);
    const none = { ...bare, fields: [report("items.0.name", 0, 0)] };
    expect(fieldStates(row, none, "ks3")).toEqual([]);
  });

  test("the frame never runs off the slide: words a layout cannot hold stay inside, clipped", () => {
    const huge = setAtPath(ref(4), "grid.3.text", "word ".repeat(300).trim());
    const { frame, elements, result } = relayout(huge, theme, "ks3");
    // The template laid the words past the slide; the frame stops at the trim.
    expect(Math.max(...result.slide.elements.map((e) => e.y + e.h))).toBeGreaterThan(540);
    expect(frame.y + frame.h).toBeLessThanOrEqual(540 - 19);
    // UX ruling 215: never a sliced line. A box held at the frame's foot keeps whole lines only.
    const foot = frame.y + frame.h;
    const held = elements.filter((e) => e.type === "text" && e.style.autoHeight === false);
    expect(held.length).toBeGreaterThan(0);
    for (const e of elements) expect(e.y + e.h).toBeLessThanOrEqual(foot + 0.5);
    for (const e of held) {
      if (e.type !== "text") continue;
      const r = resolveTextStyle(e.style, theme, e.style.preset ?? "body");
      const lines = (e.h - 2 * r.padding) / (r.fontSize * r.lineHeight);
      expect(lines - Math.floor(lines)).toBeLessThan(0.05);
      expect(e.style.autoFit).toBe(false);
    }
    expect(frame.x).toBeGreaterThanOrEqual(0);
    expect(frame.x + frame.w).toBeLessThanOrEqual(960);
  });

  test("minFitScale: type that may shrink lets the layout shrink; type held at a step does not", () => {
    const els = [{ x: 0, y: 0, w: 100, h: 30, style: { preset: "body", fontSize: 25 } }];
    // An unstaged theme sets 25 pt body down to its 20 pt floor: 0.8 of the size.
    expect(minFitScale(els, getTheme("reading-room"))).toBeCloseTo(0.8, 2);
    // A theme read at a key stage holds body at its step: nothing may shrink.
    expect(minFitScale(els, getTheme("reading-room", "ks2"))).toBe(1);
  });
});

describe("caps at every count", () => {
  test("every live adaptive template has non-zero caps at each count from its min to its max", () => {
    for (const stage of ["ks1", "ks2", "ks3"] as const)
      for (const template of ADAPTIVE_TEMPLATE_IDS) {
        const spec = ADAPTIVE_SPECS[template];
        for (let n = spec.min; n <= spec.max(stage); n++) {
          // A string item (practice, exit ticket: TEACH-230 part b) is used as it is.
          const items = Array.from({ length: n }, (_, i) => {
            const b = spec.blank();
            return typeof b === "string" ? b : { ...(b as object), n: i };
          });
          const r: LayoutRef = { template, input: { heading: "Heading", [spec.items]: items } };
          let fields: ReturnType<typeof relayout>["fields"];
          try {
            fields = relayout(r, theme, stage).fields;
          } catch (e) {
            if (e instanceof NotAdaptiveError) continue; // not live on this branch
            throw e;
          }
          for (const f of fields)
            expect({ template, n, stage, path: f.path, cap: f.cap > 0 }).toEqual({
              template,
              n,
              stage,
              path: f.path,
              cap: true,
            });
        }
      }
  });
});

describe("field states follow the layout's own measure", () => {
  test("an items-row line the layout measures past the frame is over, though under the table's hard maximum", () => {
    // Chat-edit router run r24: 50 characters against a hard maximum of 54, but "muscular" wraps
    // the line to five lines at the drawn size and the layout reports it over.
    const ref = {
      template: "items-row",
      input: {
        template: "items-row",
        heading: "Four parts working together",
        lead: "The circulatory system moves blood around the body.",
        ordered: false,
        motif: "vessel",
        items: [
          {
            name: "Heart",
            text: "A muscular pump that pushes blood around the body.",
            icon: "heart",
          },
          { name: "Blood", text: "A liquid that transports substances.", icon: "blood" },
          {
            name: "Blood vessels",
            text: "Tubes carrying blood to and from the heart.",
            icon: "blood vessel",
          },
          { name: "Lungs", text: "Help oxygen enter the blood when we breathe.", icon: "lungs" },
        ],
      },
      frame: { x: 0, y: 38, w: 960, h: 450 },
    } as unknown as LayoutRef;
    const r = relayout(ref, getTheme("paper"), "ks2", "g");
    const heart = r.fields.find((f) => f.path === "items.0.text");
    expect(r.result.over).toContain("items[0].text");
    expect(heart?.state).toBe("over");
  });
});

describe("hinge (TEACH-256 part b)", () => {
  const hingeRef = (n: number, stem?: string) =>
    ({
      template: "hinge",
      input: {
        heading: "Which of these metals is magnetic?",
        ...(stem ? { stem } : {}),
        options: ["Copper", "Iron", "Aluminium", "All of them"].slice(0, n),
        correct: 2,
      },
    }) as never;
  test("add up to 4 (3 at KS1), remove down to 2", () => {
    const three = addItem(hingeRef(3), 3, "ks2");
    expect(three.ok).toBe(true);
    if (three.ok) expect(addItem(three.ref, 4, "ks2").ok).toBe(false);
    expect(addItem(hingeRef(3), 3, "ks1").ok).toBe(false);
    const two = removeItem(hingeRef(3), 0);
    expect(two.ok).toBe(true);
    if (two.ok) expect(removeItem(two.ref, 0).ok).toBe(false);
  });
  test("a blank option keeps its siblings' look (a short blank joins the grid)", () => {
    const r = addItem(hingeRef(3), 3, "ks2");
    if (!r.ok) throw new Error("refused");
    const laid = relayout(r.ref, getTheme("paper"), "ks2");
    const cards = laid.elements.filter((e) => e.name === "Option");
    expect(cards).toHaveLength(4);
    expect(new Set(cards.map((c) => c.y)).size).toBe(2);
  });
  test("the title binds to the stem when there is one, each card's words to its option", () => {
    const laid = relayout(hingeRef(4, "Which metal is magnetic?"), getTheme("paper"), "ks2", "g");
    const paths = laid.elements.map((e) => boundPath("g", e.id)).filter(Boolean);
    expect(paths).toEqual(["stem", "options.0", "options.1", "options.2", "options.3"]);
  });
  test("every stored font size is the size the renderer draws at the bound stage", () => {
    const theme = atKeyStage(getTheme("paper"), "ks3");
    const laid = relayout(hingeRef(4), getTheme("paper"), "ks3");
    for (const e of laid.elements)
      if (e.type === "text" && e.style?.fontSize)
        expect(resolveFontSize(theme, e.style.preset ?? "body", e.style.fontSize)).toBe(
          e.style.fontSize,
        );
  });
});

// TEACH-17 part b (C1).
describe("worked example (TEACH-17 part b)", () => {
  const workedRef = (n: number) =>
    ({
      template: "worked",
      input: {
        heading: "Solve 4(x - 3) = 2x + 6",
        lines: [
          { eq: "4(x - 3) = 2x + 6" },
          { move: "Expand the bracket", eq: "4x - 12 = 2x + 6" },
          { move: "Subtract 2x from both sides", eq: "2x - 12 = 6" },
          { move: "Add 12 to both sides", eq: "2x = 18" },
          { move: "Divide both sides by 2", eq: "x = 9", answer: true },
        ].slice(0, n),
        check: "4(*9* - 3) = 2 × *9* + 6",
      },
    }) as never;
  test("add up to 5 lines and the check at KS3 (4 at KS2), remove down to 1", () => {
    const five = addItem(workedRef(4), 4, "ks3");
    expect(five.ok).toBe(true);
    if (five.ok) expect(addItem(five.ref, 5, "ks3").ok).toBe(false);
    expect(addItem(workedRef(4), 4, "ks2").ok).toBe(false);
    const one = removeItem(workedRef(2), 1);
    expect(one.ok).toBe(true);
    if (one.ok) expect(removeItem(one.ref, 0).ok).toBe(false);
  });
  test("a blank line keeps its siblings' look: on the = column, its own step", () => {
    const r = addItem(workedRef(3), 3, "ks3");
    if (!r.ok) throw new Error("refused");
    const laid = relayout(r.ref, getTheme("paper"), "ks3");
    const signs = laid.elements.filter((e) => e.name === "Eq sign");
    expect(signs).toHaveLength(4);
    expect(new Set(signs.map((e) => Math.round(e.x + e.w / 2))).size).toBe(1);
    expect(signs.map((e) => e.revealStep)).toEqual([1, 2, 3, 4]);
    expect(laid.result.over).toEqual([]);
  });
  test("the title binds to the heading, the check strip's sum to the check", () => {
    const laid = relayout(workedRef(3), getTheme("paper"), "ks3", "g");
    const paths = laid.elements.map((e) => boundPath("g", e.id)).filter(Boolean);
    expect(paths).toEqual(["heading", "check"]);
  });
  test("every stored font size is the size the renderer draws at the bound stage", () => {
    for (const stage of ["ks2", "ks3"] as const) {
      const theme = atKeyStage(getTheme("paper"), stage);
      const laid = relayout(workedRef(5), getTheme("paper"), stage);
      for (const e of laid.elements) {
        const st = e.type === "text" ? e.style : e.type === "shape" ? e.textStyle : undefined;
        if (st?.fontSize)
          expect(resolveFontSize(theme, st.preset ?? "body", st.fontSize)).toBe(st.fontSize);
      }
    }
  });
});
