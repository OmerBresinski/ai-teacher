import { describe, expect, it } from "bun:test";
import { PALETTE_FORM_IDS } from "./palette";
import {
  contractText,
  layoutsOf,
  SLOT_CONTRACTS,
  type SlotContract,
  slotContract,
  specOfWriter,
  TEXT_KINDS,
  writerSchema,
} from "./slot-contracts";
import { capacity, contractFits, countables, WORST, worstFill } from "./slot-contracts.measure";
import { SlideSpecSchema } from "./specs";

const name = (c: SlotContract) => `${c.form}${c.layout === "default" ? "" : `/${c.layout}`}`;
const onSlide = SLOT_CONTRACTS.filter((c) => specOfWriter(c.form, worstFill(c), c.layout));

describe("slot contracts", () => {
  it("every palette form has a default contract, and no layout twice", () => {
    for (const id of PALETTE_FORM_IDS) expect(slotContract(id).layout).toBe("default");
    const keys = SLOT_CONTRACTS.map((c) => `${c.form}/${c.layout}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(layoutsOf("hinge").map((c) => c.layout)).toEqual(["default", "stacked", "why"]);
  });

  it("every kind of text has a worst-case bank to measure it with", () => {
    for (const kind of Object.keys(TEXT_KINDS)) {
      expect(WORST[kind as keyof typeof TEXT_KINDS]?.length, kind).toBeGreaterThan(0);
    }
  });

  it.each(onSlide.map((c) => [name(c), c]))(
    "%s: its worst-case fill is a valid slide spec",
    (_n, c) => {
      const made = specOfWriter(c.form, worstFill(c), c.layout);
      expect(SlideSpecSchema.safeParse(made?.spec).success).toBe(true);
    },
  );
});

/*
 * The drift test: every contract, every slot at its maximum with the longest plausible text of its
 * kind, fits at body size (stepDown 0) on all 10 themes, keeps every word written, places the form
 * as itself, sets the heading on one line and the reason within its panel's lines. And each
 * measured slot is tight: one more does not fit, so a font or layout change that frees room shows
 * up here as a contract to raise.
 */
describe("slot contract drift: no contract promises more than the slide shows", () => {
  for (const c of onSlide) {
    it(`${name(c)} at its maximum fits every theme`, () => {
      expect(contractFits(c, worstFill(c)).failing).toEqual([]);
    });
    for (const slot of countables(c).filter((s) => !s.fixed && s.max !== undefined)) {
      it(`${name(c)}: ${slot.key} holds exactly ${slot.max}`, () => {
        expect(capacity(c, slot.key)).toBe(slot.max as number);
      });
    }
  }

  it("the hinge's Why? layout cannot take phrase options: a real limit of the 2x2 grid", () => {
    const why = slotContract("hinge", "why");
    const fill = worstFill(why);
    fill.options = (fill.options as { text: string; correct: boolean }[]).map((o, i) => ({
      ...o,
      text: WORST.phrase[i] as string,
    }));
    expect(contractFits(why, fill).ok).toBe(false);
  });
});

describe("writerSchema", () => {
  it.each(SLOT_CONTRACTS.map((c) => [name(c), c]))("%s parses its worst-case fill", (_n, c) => {
    const parsed = writerSchema(c.form, c.layout).safeParse(worstFill(c));
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it("puts item counts in the schema", () => {
    const seq = slotContract("sequence");
    const schema = writerSchema("sequence");
    const fill = worstFill(seq);
    const steps = fill.steps as string[];
    expect(schema.safeParse({ ...fill, steps: [...steps, "One step too many"] }).success).toBe(
      false,
    );
    expect(schema.safeParse({ ...fill, steps: steps.slice(0, 1) }).success).toBe(false);
    expect(
      writerSchema("hinge").safeParse({ ...worstFill(slotContract("hinge")), options: [] }).success,
    ).toBe(false);
  });

  it("describes each slot's shape in its field", () => {
    const json = JSON.stringify(writerSchema("worked-example").shape.steps?.description);
    expect(json).toContain("one calculation or one short phrase");
    expect(json).toContain("the last line gives the answer");
    expect(writerSchema("compare").shape.compare?.description).toContain("two sides");
  });
});

describe("contractText", () => {
  it("renders a form's contract, one slot a line", () => {
    expect(contractText("worked-example")).toBe(
      [
        "worked-example:",
        '- heading: one line: one short main clause about one thing, with no "and", "but", "when" or list',
        "- question: one question, at most two lines",
        "- steps: 2–6 lines, each one calculation or one short phrase, on one line (the last line gives the answer)",
      ].join("\n"),
    );
    expect(contractText("hinge", "why")).toContain("hinge (why):");
    expect(contractText("hinge", "stacked")).toContain(
      "options: 4 items, each with text: one line across the slide",
    );
    expect(contractText("hinge")).toContain(
      "explanation: one sentence of one or two clauses, at most two lines, goes in the teacher notes",
    );
    expect(contractText("compare")).toContain(
      "compare: 2 items, each with label: a short label, half a line, not a sentence; points: 2–4 items, each a phrase on one line, not a full sentence (two sides, left then right)",
    );
  });

  it("names every slot and no word or character counts", () => {
    for (const c of SLOT_CONTRACTS) {
      const text = contractText(c.form, c.layout);
      expect(text).not.toMatch(/\b(words?|characters?|chars?)\b/i);
      for (const slot of c.slots) expect(text).toContain(`- ${slot.field}:`);
    }
  });
});
