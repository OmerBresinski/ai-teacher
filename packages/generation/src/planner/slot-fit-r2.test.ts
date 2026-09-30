import { describe, expect, test } from "bun:test";
import { fitsPlanned } from "@tj/slides";
import flagged from "../fixtures/designer-r2-flagged.json";
import type { DesignSlot } from "../prompts/design-cycle";
import { renderSlot, slotRender } from "./coded-slides";
import { fitSlot, hingeAsked, notesAcross, type SlotFit, siblingsOf } from "./slot-fit";

/*
 * Designer eval r2 (30 Sep 2026): slots read back from the stored decks whose slides failed the
 * save gate. 4 of 16 decks overflowed after Tidy; every overflowing slide was a slot the ladder
 * flagged and saved as it was.
 */
const slot = (key: keyof typeof flagged) => flagged[key] as unknown as DesignSlot;
const META = { promptVersion: "t", model: "t", at: "1970-01-01T00:00:00.000Z" };

/** The save gate: one step down allowed, every theme. */
const passesGate = (fit: SlotFit) =>
  fitsPlanned(fit.render.spec, {
    stepDown: 1,
    ...(fit.render.variant ? { variant: fit.render.variant } : {}),
    structure: fit.render.structure,
  }).ok;

const noAnswer = async () => undefined;

describe("r2 overflow: nothing lands past the save gate unflagged", () => {
  test("a hinge whose options stand in the Why? lane, and whose re-fill failed, is asked open and fits", async () => {
    for (const key of [
      "designer-b/y3-rocks@5",
      "designer-a/y9-weimar@7",
      "designer-a/y6-ratio@6",
    ] as const) {
      const hinge = slot(key);
      if (hinge.form !== "hinge") throw new Error("form");
      const fit = await fitSlot(hinge, { seed: key, themeId: "chalk", refill: noAnswer });
      expect(fit.rung).toBe("sibling");
      expect(fit.slot.form).toBe("open-response");
      expect(passesGate(fit)).toBe(true);
      // The re-fill was asked first; the open question is code's fallback after it.
      expect(fit.tried.map((t) => t.rung)).toEqual(["refill", "sibling"]);
      // The answer and its reason go to the answer panel, not the slide face.
      const correct = hinge.options.find((o) => o.correct)?.text ?? "";
      if (fit.slot.form !== "open-response") throw new Error("form");
      expect(fit.slot.modelAnswer).toContain(correct.replace(/[.!?]+$/, ""));
      expect(fit.slot.modelAnswer).toContain(hinge.explanation);
      const face = JSON.stringify(renderSlot(fit.render, "chalk", META).elements);
      expect(face).not.toContain(hinge.explanation);
    }
  });

  test("a hinge whose stem reads its options is never asked open: it is flagged with the reason", async () => {
    const base = slot("designer-b/y3-rocks@5");
    if (base.form !== "hinge") throw new Error("form");
    const reads = {
      ...base,
      stem: "Which of these options describes what happens when melted rock cools?",
    };
    expect(hingeAsked(reads)).toBeUndefined();
    const fit = await fitSlot(reads, { seed: "r", themeId: "chalk", refill: noAnswer });
    expect(fit.rung).toBe("flagged");
    expect(fit.reason).toMatch(/^fails on \d+ of 10 themes: .*Why\? panel's lane/);
    expect(fit.tried.at(-1)).toMatchObject({ rung: "flagged", detail: fit.reason });
  });

  test("a slot nothing can land is flagged with why, never saved silently", async () => {
    const sort = slot("designer-b/y3-rocks@7");
    const fit = await fitSlot(sort, { seed: "s", themeId: "chalk", refill: noAnswer });
    expect(fit.rung).toBe("flagged");
    expect(fit.reason).toMatch(/^fails on \d+ of 10 themes/);
  });

  test("every r2 slot lands on the gate or is flagged with a reason", async () => {
    for (const [key, raw] of Object.entries(flagged)) {
      const fit = await fitSlot(raw as unknown as DesignSlot, { seed: key, themeId: "chalk" });
      if (fit.rung === "flagged") expect(fit.reason).toBeTruthy();
      else expect(passesGate(fit)).toBe(true);
    }
  });

  test("a re-filled slot goes down its own rungs before the step-down, never straight past the gate", async () => {
    const we = slot("designer-b/y10-electrolysis@7");
    if (we.form !== "worked-example") throw new Error("form");
    // The re-fill comes back as a sequence that does not fit whole: its own rungs are tried
    // (logged "re-filled") before any step down.
    const fit = await fitSlot(we, {
      seed: "w",
      themeId: "chalk",
      refill: async () => ({
        form: "sequence",
        heading: we.heading,
        body: we.question,
        steps: we.steps,
      }),
    });
    const refillAt = fit.tried.findIndex((t) => t.rung === "refill");
    const after = fit.tried.slice(refillAt + 1);
    const firstStep = after.findIndex((t) => t.rung === "step-down");
    expect(
      after
        .slice(0, firstStep < 0 ? undefined : firstStep)
        .some((t) => t.detail?.startsWith("re-filled")),
    ).toBe(true);
    if (fit.rung !== "flagged") expect(passesGate(fit)).toBe(true);
  });
});

describe("r2 notes: a form change never keeps notes about the old form", () => {
  test("a hinge asked open drops the notes about its options and keeps the rest", () => {
    const hinge = slot("designer-b/y3-rocks@5");
    const asked = hingeAsked(hinge);
    expect(hinge.notes).toContain("option");
    expect(asked?.notes ?? "").not.toMatch(/\boptions?\b|choose|reveal/i);
  });

  test("a sort's notes about its cards and order do not follow it into another form", () => {
    expect(
      notesAcross(
        "Ask pupils to put the four labels in order. Rock forms slowly.",
        "sort",
        "open-response",
      ),
    ).toBe("Rock forms slowly.");
    expect(notesAcross("Keep this.", "sort", "sort")).toBe("Keep this.");
  });

  test("a sibling conversion carries only notes that still fit the new form", () => {
    const tf: DesignSlot = {
      form: "true-false",
      statement: "Metals are always magnetic.",
      correct: false,
      explanation: "Only iron, nickel and cobalt are.",
      notes: "Reveal the answer after the vote. Many pupils think all metals stick to magnets.",
    };
    const [open] = siblingsOf(tf);
    expect(open?.form).toBe("open-response");
    expect(open?.notes).toBe("Many pupils think all metals stick to magnets.");
  });

  test("a re-fill lands with its own notes, not the replaced slot's", async () => {
    const sort = slot("designer-b/y3-rocks@7");
    const fit = await fitSlot(sort, {
      seed: "n",
      themeId: "chalk",
      refill: async () => ({
        form: "open-response",
        stem: "How does a riverbed become sedimentary rock?",
        modelAnswer: "Bits settle in layers, which are pressed together over time into solid rock.",
        notes: "Look for layers and pressing.",
      }),
    });
    expect(fit.rung).toBe("refill");
    expect(fit.slot.notes).toBe("Look for layers and pressing.");
    expect(slotRender(fit.slot, "n").spec.notes).toBe("Look for layers and pressing.");
  });
});
