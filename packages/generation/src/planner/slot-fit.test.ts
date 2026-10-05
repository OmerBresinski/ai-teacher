import { describe, expect, test } from "bun:test";
import { THEMES } from "@tj/slides";
import weimar from "../fixtures/design-cycle.y9-weimar.json";
import { type DesignSlot, designCycleSchemaFor, type SlotForm } from "../prompts/design-cycle";
import { designMinimums, renderSlot, slotRender } from "./coded-slides";
import { FORM_DOWN, fitSlot, refillReason, siblingsOf } from "./slot-fit";

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

  test("a hinge that does not fit has no sibling: it goes to the re-fill, never a stem without options", async () => {
    const hinge = bySlot("hinge");
    expect(siblingsOf(hinge)).toEqual([]);
    const asked: string[] = [];
    const fit = await fitSlot(hinge, {
      seed: "x",
      themeId: "chalk",
      refill: async (_s, form) => {
        asked.push(form);
        return {
          form: "true-false",
          statement: "The Ruhr strike was paid for by printing money.",
          correct: true,
          explanation: "The government printed money to pay the strikers.",
        };
      },
    });
    expect(fit.tried.some((t) => t.rung === "sibling")).toBe(false);
    expect(asked).toEqual(["true-false"]);
    expect(fit.rung).toBe("refill");
    expect(fit.slot.form).toBe("true-false");
  });

  test("the re-fill rung asks for the next form down once, and takes an answer that fits", async () => {
    // r6 smoke, y9-weimar slide 7: a three-sentence question over three sentences of working.
    // Steps doubled: the inline step rows (UX ruling 151) now hold the r6 working at full size.
    const we0 = weimar.buyingPowerWorkedExample;
    const slot = { ...we0, steps: we0.steps.map((s) => `${s} ${s}`) } as unknown as DesignSlot;
    const asked: string[] = [];
    const shown: { slot: DesignSlot; reason: string }[] = [];
    const fit = await fitSlot(slot, {
      seed: "x",
      themeId: "chalk",
      refill: async (s, form, reason) => {
        asked.push(form);
        shown.push({ slot: s, reason });
        return {
          form: "sequence",
          heading: "Electrolysis of brine",
          body: "Three products form.",
          steps: ["Chlorine at the anode", "Hydrogen at the cathode"],
        };
      },
    });
    expect(asked).toEqual([FORM_DOWN["worked-example"] as string]);
    // The re-fill is shown the slot it replaces, as written, and a structural reason.
    expect(shown[0]?.slot).toEqual(slot);
    expect(shown[0]?.reason).toBe(refillReason(slot));
    expect(fit.rung).toBe("refill");
    expect(fit.tried.map((t) => t.rung)).toEqual(["sibling", "refill"]);
  });

  test("with no re-fill, the siblings' own rungs and then one step down are tried before a flag", async () => {
    // Two sentences to each line of working: no sibling holds it whole at full size (r5).
    const we = weimar.buyingPowerWorkedExample;
    const slot = {
      ...we,
      steps: we.steps.map((s) => `${s} ${s} This is what the class should notice first.`),
    } as unknown as DesignSlot;
    const fit = await fitSlot(slot, { seed: "x", themeId: "chalk" });
    const last = fit.tried.at(-1);
    expect(last?.rung).toBe(fit.rung);
    expect(last?.ok).toBe(fit.rung !== "flagged");
    if (fit.rung === "flagged") expect(fit.slot).toEqual(slot);
    // This worked example's sibling sequence and that sequence's own sibling are both tried.
    expect(fit.tried.some((t) => t.rung === "sibling" && t.form === "sequence")).toBe(true);
  });

  test("a sibling holds every unit word for word, never cut", () => {
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

describe("the re-fill's reason is structure, never a length", () => {
  const cases: [DesignSlot, string][] = [
    [
      {
        form: "hinge",
        stem: "Why did the Weimar Republic print money?",
        options: [
          {
            text: "The government printed money to pay striking workers in the Ruhr.",
            correct: true,
          },
          { text: "Reparations", correct: false },
          { text: "Wall Street", correct: false },
          { text: "Gold", correct: false },
        ],
        explanation: "The Ruhr strike was paid for with printed money.",
      },
      "the options are sentences; this form needs phrases",
    ],
    [
      {
        form: "explain-callout",
        heading: "Inflation wiped out savings",
        body: "Prices doubled every few days. Savings became worthless.",
        callout: { text: "Inflation is not the same as a recession." },
      },
      "the body is 2 sentences; this form holds one",
    ],
    [
      {
        form: "sequence",
        heading: "How hyperinflation grew",
        body: "Three steps.",
        steps: ["The Ruhr was occupied. Workers struck.", "Money was printed", "Prices soared"],
      },
      "a step is more than one sentence; this form takes one sentence each",
    ],
  ];
  test("each names the unit and the kind of text the form needs", () => {
    for (const [slot, expected] of cases) {
      const reason = refillReason(slot);
      expect(reason).toContain(expected);
      expect(reason).not.toMatch(/short|words|characters|\d+ words/i);
    }
    expect(refillReason(cases[1]?.[0] as DesignSlot)).toContain("callout card does not fit");
    const plain: DesignSlot = {
      form: "explain",
      heading: "Money lost value",
      body: "Prices rose.",
    };
    expect(refillReason(plain)).toBe("its units do not fit the slide at full size on every theme");
  });
});

describe("sibling pairs (rung 2): a whole, valid slide of the new form, every word kept", () => {
  const strings = (x: unknown): string[] =>
    typeof x === "string"
      ? [x]
      : Array.isArray(x)
        ? x.flatMap(strings)
        : x && typeof x === "object"
          ? Object.values(x).flatMap(strings)
          : [];
  const words = (x: unknown) =>
    strings(x)
      .join(" ")
      .toLowerCase()
      .match(/[a-z0-9]+/g) ?? [];
  const kept = (from: DesignSlot, to: DesignSlot) => {
    const { form: _a, ...a } = from;
    const { form: _b, ...b } = to;
    const have = new Set(words(b));
    return words(a).filter((w) => !have.has(w) && w !== "true" && w !== "false");
  };
  const valid = (to: DesignSlot) => {
    const schema = designCycleSchemaFor("maths", 1).shape.slots.element;
    return schema.safeParse(to).success;
  };
  const cases: [string, DesignSlot, SlotForm[]][] = [
    [
      "explain -> list (lead and exactly two sentences)",
      {
        form: "explain",
        heading: "Rivers shape valleys",
        body: "Rivers erode. They carry rock. They drop it lower down.",
      },
      ["list"],
    ],
    [
      "explain-callout -> explain",
      {
        form: "explain-callout",
        heading: "Rivers shape valleys",
        body: "Rivers erode their beds.",
        callout: { text: "Erosion is not weathering." },
      },
      ["explain"],
    ],
    [
      "sequence of 2 -> list",
      {
        form: "sequence",
        heading: "Making a delta",
        body: "Two stages.",
        steps: ["The river slows", "Sediment settles"],
      },
      ["list"],
    ],
    [
      "compare -> list",
      {
        form: "compare",
        heading: "Upper and lower course",
        body: "They differ.",
        compare: {
          left: { label: "Upper", points: ["Steep", "Narrow"] },
          right: { label: "Lower", points: ["Gentle", "Wide"] },
        },
      },
      ["list"],
    ],
    [
      "worked example -> sequence",
      {
        form: "worked-example",
        heading: "Finding a mean",
        question: "Find the mean of 2, 4 and 6.",
        steps: ["Add them: 12.", "Divide by 3: 4."],
      },
      ["sequence"],
    ],
    [
      "true-false -> open response",
      {
        form: "true-false",
        statement: "Rivers only erode downwards.",
        correct: false,
        explanation: "They erode sideways too.",
        notes: "Ask why.",
      },
      ["open-response"],
    ],
  ];
  for (const [name, from, to] of cases) {
    test(name, () => {
      const out = siblingsOf(from);
      expect(out.map((s) => s.form)).toEqual(to);
      for (const s of out) {
        expect(valid(s)).toBe(true);
        expect(kept(from, s)).toEqual([]);
      }
    });
  }
  test("true-false -> open response asks for the reason in its own shape, never 'True or false?'", () => {
    const [open] = siblingsOf(cases[5]?.[1] as DesignSlot);
    expect(open).toMatchObject({
      form: "open-response",
      stem: "Explain what is wrong with this claim: Rivers only erode downwards.",
      modelAnswer: "They erode sideways too.",
      notes: "Ask why.",
    });
  });
  const none: [string, DesignSlot][] = [
    [
      "hinge",
      {
        form: "hinge",
        stem: "Which is a meander?",
        options: [
          { text: "A bend", correct: true },
          { text: "A lake", correct: false },
          { text: "A delta", correct: false },
          { text: "A cliff", correct: false },
        ],
        explanation: "Option A: a bend.",
        notes: "Option A is right.",
      },
    ],
    [
      "fill-gap",
      {
        form: "fill-gap",
        stem: "Fill the gap.",
        sentence: "A river bend is a ___.",
        answers: ["meander"],
      },
    ],
    [
      "sort",
      {
        form: "sort",
        stem: "Put in order.",
        steps: ["Source", "Upper course", "Lower course", "Mouth"],
      },
    ],
    [
      "matching",
      {
        form: "matching",
        stem: "Match them.",
        pairs: [
          { left: "Source", right: "Start" },
          { left: "Mouth", right: "End" },
          { left: "Delta", right: "Deposits" },
        ],
      },
    ],
    [
      "explain with four sentences",
      { form: "explain", heading: "Rivers", body: "One. Two. Three. Four." },
    ],
    ["list", { form: "list", heading: "Rivers", body: "Two facts.", points: ["Wet", "Long"] }],
  ];
  for (const [name, slot] of none) {
    test(`${name}: no sibling, so the re-fill writes the new form`, () => {
      expect(siblingsOf(slot)).toEqual([]);
    });
  }
});
