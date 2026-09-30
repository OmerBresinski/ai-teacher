import { describe, expect, test } from "bun:test";
import { THEMES } from "@tj/slides";
import weimar from "../fixtures/design-cycle.y9-weimar.json";
import { type DesignSlot, designCycleSchemaFor } from "../prompts/design-cycle";
import { designMinimums, renderSlot, slotRender } from "./coded-slides";
import { FORM_DOWN, fitSlot, siblingsOf, slotFits, unitsToNotes } from "./slot-fit";

const META = { promptVersion: "t", model: "t", at: "1970-01-01T00:00:00.000Z" };
const cycles = weimar.cycles as unknown as { slots: DesignSlot[] }[];
const slots = cycles.flatMap((c) => c.slots);
const bySlot = (form: string) => slots.find((s) => s.form === form) as DesignSlot;

describe("slot renderers", () => {
  test("every fixture slot validates and renders the text the designer wrote", () => {
    const schema = designCycleSchemaFor("history", 3);
    for (const cycle of weimar.cycles) expect(schema.safeParse(cycle).success).toBe(true);
    for (const [i, slot] of slots.entries()) {
      const slide = renderSlot(slotRender(slot, `s${i}`), "chalk", META);
      const words = JSON.stringify(slide.elements);
      const heading = "heading" in slot ? slot.heading : "stem" in slot ? slot.stem : "";
      expect(words).toContain(heading.slice(0, 20));
      if (slot.notes) expect(slide.notes).toBeDefined();
    }
  });

  test("a photo slot lays an open photo slot and a callout slot its callout card", () => {
    const photo = renderSlot(slotRender(bySlot("photo"), "p"), "chalk", META);
    expect(photo.elements.some((e) => e.type === "image" && e.name === "Photo slot")).toBe(true);
    const callout = renderSlot(slotRender(bySlot("explain-callout"), "c"), "chalk", META);
    expect(callout.elements.some((e) => e.name === "Callout card")).toBe(true);
  });

  test("a hinge's options go out in a seeded order", () => {
    const a = slotRender(bySlot("hinge"), "one");
    const b = slotRender(bySlot("hinge"), "one");
    expect(a.spec).toEqual(b.spec);
  });
});

describe("fit ladder", () => {
  test("a slot that fits every theme lands on the gate, with nothing tried", async () => {
    const fit = await fitSlot(bySlot("photo"), { seed: "x", themeId: "chalk" });
    expect(fit.rung).toBe("fits");
    expect(fit.tried).toEqual([]);
    expect(THEMES.length).toBe(10);
  });

  test("a hinge with sentence-long options becomes an open response holding the same units", async () => {
    const hinge = bySlot("hinge");
    const fit = await fitSlot(hinge, { seed: "x", themeId: "chalk" });
    expect(fit.rung).toBe("sibling");
    expect(fit.slot.form).toBe("open-response");
    if (fit.slot.form !== "open-response" || hinge.form !== "hinge") throw new Error("form");
    expect(fit.slot.stem).toBe(hinge.stem);
    expect(fit.slot.modelAnswer).toBe(hinge.options.find((o) => o.correct)?.text ?? "");
    expect(fit.slot.notes).toContain(hinge.explanation);
    expect(slotFits(fit.render, "chalk", 0)).toBe(true);
  });

  test("the re-fill rung asks for the next form down once, and takes an answer that fits", async () => {
    const slot = weimar.electrolysisWorkedExample as unknown as DesignSlot;
    const asked: string[] = [];
    const fit = await fitSlot(slot, {
      seed: "x",
      themeId: "chalk",
      refill: async (_s, form) => {
        asked.push(form);
        return {
          form: "sequence",
          heading: "Electrolysis of brine",
          body: "Three products form.",
          steps: ["Chlorine at the anode", "Hydrogen at the cathode"],
        };
      },
    });
    expect(asked).toEqual([FORM_DOWN["worked-example"] as string]);
    expect(fit.rung).toBe("refill");
    expect(fit.tried.map((t) => t.rung)).toEqual(["sibling", "notes", "refill"]);
  });

  test("with nothing fitting, one step down is tried and then the slot is flagged with its words", async () => {
    const slot = weimar.electrolysisWorkedExample as unknown as DesignSlot;
    const fit = await fitSlot(slot, { seed: "x", themeId: "chalk" });
    expect(fit.tried.at(-1)?.rung).toBe(fit.rung === "flagged" ? "flagged" : "step-down");
    if (fit.rung === "flagged") expect(fit.slot).toEqual(slot);
  });

  test("units move to the notes word for word, never cut", () => {
    const callout = bySlot("explain-callout");
    if (callout.form !== "explain-callout") throw new Error("form");
    const [first] = unitsToNotes(callout);
    expect(first?.moved).toBe("callout");
    expect(first?.slot.notes).toContain(callout.callout.text);
    const compare = bySlot("compare");
    const [list] = siblingsOf(compare);
    expect(list?.form).toBe("list");
    if (compare.form !== "compare" || list?.form !== "list") throw new Error("form");
    for (const p of compare.compare.left.points) expect(list.points[0]).toContain(p);
  });
});

describe("design minimums", () => {
  test("visuals, checks, neighbours and per-objective teach and check", () => {
    const placed = cycles.flatMap((c, o) =>
      c.slots.map((s, i) => ({
        objective: o,
        form: s.form,
        slide: 4 + o * 3 + i,
      })),
    );
    const arcs = [{ lean: "photo" }, { lean: "compare" }];
    const m = designMinimums(placed, arcs);
    expect(m.visualMissing).toEqual([]);
    expect(m.checks).toBe(2);
    expect(m.untaught).toEqual([]);
    expect(m.unchecked).toEqual([]);
    const same = designMinimums(
      [
        { objective: 0, form: "explain", slide: 4 },
        { objective: 0, form: "explain", slide: 5 },
      ],
      [{ lean: "photo" }],
    );
    expect(same.sameNeighbours).toEqual([[4, 5]]);
    expect(same.visualMissing).toEqual([0]);
    expect(same.unchecked).toEqual([0]);
  });
});
