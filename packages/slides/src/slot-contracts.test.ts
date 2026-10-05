import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import type { RichDoc } from "@tj/domain/documents";
import { docFromChunks, isChunked } from "./factories";
import { materialiseSlide } from "./materialise";
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
import {
  capacity,
  chunkLineCapacity,
  chunksOfLines,
  contractFits,
  countables,
  WORST,
  worstFill,
} from "./slot-contracts.measure";
import { SlideSpecSchema } from "./specs";
import { CHUNK_LABEL_NAME, CHUNK_TEXT_NAME } from "./structure";
import { lineWidth, ruledLines } from "./text-measure";
import { resolveTextStyle } from "./text-style";
import { THEMES } from "./themes";

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
        // The inline step rows (UX ruling 151) hold a seventh step; the spec schema still caps the
        // working at six, so a worked example's contract may promise less than the slide holds.
        if (c.form === "worked-example" && slot.key === "steps") {
          expect(capacity(c, slot.key)).toBeGreaterThanOrEqual(slot.max as number);
          return;
        }
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
    expect(json).toContain("the reason for that step in brackets");
    expect(json).toContain("the last line gives the answer");
    expect(writerSchema("compare").shape.compare?.description).toContain("two sides");
  });
});

describe("C2 capacities and the worked example's full working", () => {
  it("a worked example takes at least three steps, each with its reason in brackets", () => {
    const schema = writerSchema("worked-example");
    const fill = worstFill(slotContract("worked-example"));
    const steps = fill.steps as string[];
    expect(schema.safeParse(fill).success).toBe(true);
    expect(schema.safeParse({ ...fill, steps: steps.slice(0, 2) }).success).toBe(false);
    expect(schema.safeParse({ ...fill, steps: ["£45 ÷ 5 = £9", ...steps.slice(1)] }).success).toBe(
      false,
    );
  });

  it("a repeated bank text no longer hides a dropped list point", () => {
    // The old contract's eight points (the bank holds three) only fitted because a dropped repeat
    // matched its first copy.
    const list = slotContract("list");
    expect(contractFits(list, worstFill(list, { points: 8 })).ok).toBe(false);
  });

  it("teaching slots hold more than round B's contracts", () => {
    const max = (form: Parameters<typeof slotContract>[0], field: string) =>
      slotContract(form).slots.find((s) => s.field === field)?.max;
    expect(max("compare", "body")).toBe(4);
    expect(max("sequence", "body")).toBe(3);
  });
});

describe("D1 labelled chunks", () => {
  it("a teach body is two or three labelled chunks, and all three fit on every theme", () => {
    for (const form of ["explain", "photo", "diagram-slot"] as const) {
      const c = slotContract(form);
      const body = c.slots.find((s) => s.field === "body");
      expect([body?.min, body?.max, body?.each]).toEqual([2, 3, "chunk"]);
      expect(contractFits(c, worstFill(c)).failing).toEqual([]);
    }
  });

  it("each chunk is its own paragraph with its label bold, kept whole beside a slot", () => {
    for (const form of ["explain", "photo", "diagram-slot"] as const) {
      const made = specOfWriter(form, worstFill(slotContract(form)));
      const slide = materialiseSlide(
        made?.spec as never,
        "chalk",
        { lessonId: "l", slideId: "s" } as never,
        undefined,
        made?.variant,
        made?.structure,
      );
      // UX ruling 152: each chunk is a label on its own line over its text, three of each.
      const labels = slide.elements.filter((e) => e.name === CHUNK_LABEL_NAME);
      const texts = slide.elements.filter((e) => e.name === CHUNK_TEXT_NAME);
      expect([form, labels.length, texts.length]).toEqual([form, 3, 3]);
      const second = labels[1] as { doc: RichDoc } | undefined;
      expect(second?.doc.content?.[0]?.content?.[0]?.text).toBe("Liquid");
    }
  });

  it("chunks too long for the column at body size keep their paragraphs when stepped down", () => {
    const long =
      "Ice: in the sealed jar, the ice particles stay the same as the solid melts. They move past each other, so the water changes shape; none escape, so the mass stays the same.";
    const made = specOfWriter("diagram-slot", {
      heading: "Particles form three states",
      body: [long, long.replace("Ice:", "The model:"), long.replace("Ice:", "Gas:")],
      diagram: "Three boxes of particles",
    });
    const slide = materialiseSlide(
      made?.spec as never,
      "chalk",
      { lessonId: "l", slideId: "s" } as never,
      undefined,
      made?.variant,
      made?.structure,
    );
    const body = slide.elements.find(
      (e) => e.type === "text" && JSON.stringify(e.doc).includes("sealed jar"),
    ) as { doc: RichDoc } | undefined;
    expect(body && isChunked(body.doc)).toBe(true);
  });

  it("a body with one label, or a ratio, stays plain text", () => {
    expect(isChunked(docFromChunks("Gas: the particles move fast."))).toBe(false);
    expect(isChunked(docFromChunks("Mix it 2:3 by volume.\nThen stir it well."))).toBe(false);
  });
});

describe("E1 chunk fit: the ruler lays chunks out as the renderer does", () => {
  const CHUNKED_FORMS = ["explain", "photo", "diagram-slot"] as const;
  // The renderer's paragraph spacing, read from its own stylesheet: `.td-rt p { margin: 0 0 Xem }`.
  const css = readFileSync(new URL("../../editor/src/styles/slide.css", import.meta.url), "utf8");
  const gapEm = Number(/\.td-rt p \{\s*margin: 0 0 ([\d.]+)em;/.exec(css)?.[1]);

  it("reads the renderer's paragraph gap", () => {
    expect(gapEm).toBeGreaterThan(0);
  });

  it("a chunked body's box is its lines plus the renderer's gap between chunks, on all 10 themes", () => {
    for (const form of CHUNKED_FORMS) {
      const c = slotContract(form);
      for (const theme of THEMES) {
        const chunks = chunksOfLines(c, theme, 3) as string[];
        const made = specOfWriter(form, { ...worstFill(c), body: chunks });
        const slide = materialiseSlide(
          made?.spec as never,
          theme.id,
          { lessonId: "l", slideId: "s" } as never,
          undefined,
          made?.variant,
          made?.structure,
        );
        // UX ruling 152: each chunk's text is its own box, its lines and nothing else.
        const texts = slide.elements.filter((e) => e.name === CHUNK_TEXT_NAME) as unknown as {
          doc: RichDoc;
          w: number;
          h: number;
          style: never;
        }[];
        // A stack that cannot fit falls back to the labelled run-in body, which must still be there.
        if (texts.length === 0) {
          expect(slide.elements.some((e) => e.type === "text" && isChunked(e.doc))).toBe(true);
          continue;
        }
        expect([form, theme.id, texts.length]).toEqual([form, theme.id, 3]);
        for (const body of texts) {
          const r = resolveTextStyle(body.style, theme, "body");
          const lines = ruledLines(body.doc, "body", theme, body.w, r.fontSize);
          const rendered = lines * r.fontSize * r.lineHeight;
          expect(Math.abs(body.h - rendered)).toBeLessThan(1);
        }
      }
    }
  });

  it("a chunk's bold label is measured at bold width", () => {
    for (const theme of THEMES) {
      const text = "Why it works: it does.";
      const room = lineWidth(text, "body", theme) + 1;
      expect(lineWidth(text, "body", theme, 700)).toBeGreaterThan(room);
      const doc = docFromChunks(`${text}\nX: y`);
      expect(ruledLines(doc, "body", theme, room)).toBe(3);
    }
  });

  it("each form's chunk line budget is under its measured capacity, so three full chunks fit", () => {
    const lines = Object.fromEntries(
      CHUNKED_FORMS.map((f) => [f, slotContract(f).slots.find((s) => s.field === "body")?.lines]),
    );
    const caps = Object.fromEntries(
      CHUNKED_FORMS.map((f) => [f, chunkLineCapacity(slotContract(f))]),
    );
    expect(lines).toEqual({ explain: 2, photo: 3, "diagram-slot": 3 });
    // The chunk stack (UX ruling 152) gives explain one more line per chunk than the run-in did.
    expect(caps).toEqual({ explain: 4, photo: 4, "diagram-slot": 4 });
  });

  it("the contract states the budget in lines, never words", () => {
    expect(contractText("diagram-slot")).toContain("at most 3 lines each");
    expect(contractText("explain")).toContain("at most 2 lines each");
    expect(contractText("photo")).not.toMatch(/\bwords?\b/);
  });
});

describe("contractText", () => {
  it("renders a form's contract, one slot a line", () => {
    expect(contractText("worked-example")).toBe(
      [
        "worked-example:",
        '- heading: one line: one short main clause about one thing, with no "and", "but", "when" or list',
        "- question: one question, at most two lines",
        '- steps: 3–6 lines, each one step of the working on one line, then the reason for that step in brackets at its end ("£45 ÷ 5 = £9 (each part is the total over the 5 parts)", "The ice melts (the room is warmer than 0 °C)") (the whole working, every step with its reason; the last line gives the answer)',
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
      "compare: 2 items, each with label: a short label, half a line, not a sentence; points: 1–2 items, each one sentence of one or two clauses, at most two lines (two sides, left then right)",
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

describe("round S: the reasoned step's bracket rule is on the wire", () => {
  it("a reasoned step's schema carries an ASCII pattern the model is held to", async () => {
    const { z } = await import("zod");
    const { REASONED_STEP, writerSchema } = await import("./slot-contracts");
    expect(REASONED_STEP.source).not.toMatch(/\\[pP]\{/);
    expect(REASONED_STEP.test("2x + 6 = 18 (subtract 2x)")).toBe(true);
    expect(REASONED_STEP.test("Workers stopped work (production fell)")).toBe(true);
    // Round S: a worded step written as a sentence passes; the schema takes the full stop off.
    expect(REASONED_STEP.test("Workers stopped work (production fell).")).toBe(true);
    expect(REASONED_STEP.test("Workers stopped work: production fell")).toBe(false);
    expect(REASONED_STEP.test("x = 3 (2)")).toBe(false);
    const wire = JSON.stringify(
      z.toJSONSchema(writerSchema("worked-example"), { unrepresentable: "any" }),
    );
    expect(wire).toContain('"pattern"');
  });
});
