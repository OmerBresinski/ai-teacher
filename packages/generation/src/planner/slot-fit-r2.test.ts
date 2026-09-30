import { describe, expect, test } from "bun:test";
import { fitsPlanned } from "@tj/slides";
import flagged from "../fixtures/designer-r2-flagged.json";
import type { DesignSlot } from "../prompts/design-cycle";
import { renderSlot, slotRender } from "./coded-slides";
import {
  fitSlot,
  flagReason,
  hingeAsked,
  notesAcross,
  type SlotFit,
  siblingsOf,
  unitsToNotes,
} from "./slot-fit";

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
  test("a hinge whose options stand in the Why? lane keeps its form: the explanation goes to the notes (r3)", async () => {
    for (const key of ["designer-b/y3-rocks@5", "designer-a/y6-ratio@6"] as const) {
      const hinge = slot(key);
      if (hinge.form !== "hinge") throw new Error("form");
      const fit = await fitSlot(hinge, { seed: key, themeId: "chalk", refill: noAnswer });
      expect(fit.rung).toBe("notes");
      expect(fit.slot.form).toBe("hinge");
      expect(passesGate(fit)).toBe(true);
      // Rung 3 lands it before any re-fill is asked.
      expect(fit.tried.map((t) => t.rung)).not.toContain("refill");
      expect(fit.tried.at(-1)).toMatchObject({ rung: "notes", ok: true });
      if (fit.slot.form !== "hinge") throw new Error("form");
      // Word for word, once, in the notes; no "Why?" on the face.
      const why = hinge.explanation.trim();
      expect(fit.slot.notes?.split(why).length).toBe(2);
      expect(fit.slot.explanation).toBe("");
      expect(fit.slot.options).toEqual(hinge.options);
      expect(fit.slot.stem).toBe(hinge.stem);
      const rendered = renderSlot(fit.render, "chalk", META);
      expect(JSON.stringify(rendered.elements)).not.toContain(why);
      expect(rendered.question && "explanation" in rendered.question).toBe(false);
    }
  });

  test("a hinge too long for the slide even without its panel: re-filled, then asked open", async () => {
    // weimar-a s7: a three-sentence stem and four wrapped options run past the safe area on 4
    // themes with the lane freed; that is volume, not the panel, so the ladder goes on down.
    const hinge = slot("designer-a/y9-weimar@7");
    if (hinge.form !== "hinge") throw new Error("form");
    const fit = await fitSlot(hinge, { seed: "w", themeId: "chalk", refill: noAnswer });
    expect(fit.tried.map((t) => t.rung)).toEqual(["notes", "refill", "sibling"]);
    expect(fit.rung).toBe("sibling");
    expect(fit.slot.form).toBe("open-response");
    expect(passesGate(fit)).toBe(true);
    if (fit.slot.form !== "open-response") throw new Error("form");
    expect(fit.slot.modelAnswer).toContain(hinge.explanation);
    const moved = unitsToNotes(hinge).at(-1);
    if (!moved) throw new Error("moved");
    expect(flagReason(slotRender(moved.slot, "w"))).not.toContain("Why? panel's lane");
  });

  test("a hinge whose stem reads its options is never asked open; the explanation rung still lands it", async () => {
    const base = slot("designer-b/y3-rocks@5");
    if (base.form !== "hinge") throw new Error("form");
    const reads = {
      ...base,
      stem: "Which of these options describes what happens when melted rock cools?",
    };
    expect(hingeAsked(reads)).toBeUndefined();
    const fit = await fitSlot(reads, { seed: "r", themeId: "chalk", refill: noAnswer });
    expect(fit.rung).toBe("notes");
    expect(fit.slot.form).toBe("hinge");
    expect(passesGate(fit)).toBe(true);
  });

  test("an explanation the notes already say is not written twice", () => {
    const base = slot("designer-b/y3-rocks@5");
    if (base.form !== "hinge") throw new Error("form");
    const said = { ...base, notes: `Answer: ${base.explanation}` };
    const moved = unitsToNotes(said).find((u) => u.moved === "explanation");
    expect(moved?.slot.notes).toBe(said.notes);
    const fresh = unitsToNotes({ ...base, notes: "Ask two pupils." }).find(
      (u) => u.moved === "explanation",
    );
    expect(fresh?.slot.notes).toBe(`Ask two pupils.\nWhy: ${base.explanation.trim()}`);
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
