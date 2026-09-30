import { describe, expect, test } from "bun:test";
import flaggedR2 from "../fixtures/designer-r2-flagged.json";
import flagged from "../fixtures/designer-r5-flagged.json";
import type { DesignSlot } from "../prompts/design-cycle";
import { askedOf } from "./answer-support";
import { slotRender } from "./coded-slides";
import { fitSlot, namesOtherForm, slotFits } from "./slot-fit";

const slots = flagged as Record<string, DesignSlot>;

const notesOf = (s: DesignSlot) => (s as { notes?: string }).notes ?? "";
/** The notes' sentences, whitespace folded (a sibling may drop a sentence and re-join the rest). */
const linesOf = (t: string) =>
  t
    .split(/(?<=[.!?])\s+|\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

/**
 * Nothing taught lives only in the notes (Greg, 30 Sep): whatever rung lands a slot, its notes
 * hold no line the teacher's notes did not already hold. A fallback that moves slide text into the
 * notes fails here.
 */
function expectNoTextToNotes(before: DesignSlot, after: DesignSlot) {
  const had = new Set(linesOf(notesOf(before)));
  const added = linesOf(notesOf(after)).filter((l) => !had.has(l));
  expect(added).toEqual([]);
}

/** Slots the old notes rung moved text from: a callout, a footnote, a hinge's reason, a step. */
const long = "the river carries sand and silt downstream and drops it where the water slows";
const MOVERS: Record<string, DesignSlot> = {
  "explain-callout": {
    form: "explain-callout",
    heading: "Where rivers drop their load",
    body: `When a river reaches the sea, ${long}. ${long}. ${long}.`,
    callout: { kind: "key", text: `Remember: ${long}.` },
    notes: "Point at the delta.",
  } as unknown as DesignSlot,
  discussion: {
    form: "discussion",
    prompt: `Is a delta land or sea? Think about how ${long}, ${long}, and ${long}.`,
    footnote: `Accept both if they explain how ${long}.`,
    notes: "Ask round.",
  } as unknown as DesignSlot,
  sequence: {
    form: "sequence",
    heading: "How a delta forms",
    body: long,
    steps: [long, long, long, long, long],
    notes: "",
  } as unknown as DesignSlot,
};

describe("the fit ladder never moves slide text to the notes", () => {
  const all: [string, DesignSlot][] = [
    ...Object.entries(slots),
    ...Object.entries(flaggedR2 as Record<string, DesignSlot>),
    ...Object.entries(MOVERS),
  ];
  for (const [key, slot] of all) {
    test(`${key}: every fallback keeps the slide's words off the notes; siblings before the re-write`, async () => {
      const refill = async () => undefined;
      const fit = await fitSlot(slot, { seed: key, themeId: "chalk", refill });
      expect(fit.tried.map((t) => t.rung as string)).not.toContain("notes");
      expectNoTextToNotes(slot, fit.slot);
      const firstRefill = fit.tried.findIndex((t) => t.rung === "refill");
      const lastSibling = fit.tried
        .slice(0, firstRefill < 0 ? undefined : firstRefill + 1)
        .map((t) => t.rung)
        .lastIndexOf("sibling");
      if (firstRefill >= 0 && lastSibling >= 0) expect(lastSibling).toBeLessThan(firstRefill);
    });
  }

  test("the guard itself catches a slot whose text went to the notes", () => {
    const moved = { ...MOVERS.discussion, notes: "Ask round.\nAccept both." } as DesignSlot;
    expect(() => expectNoTextToNotes(MOVERS.discussion as DesignSlot, moved)).toThrow();
  });
});

describe("r6 fit ladder: a question never names another form", () => {
  test("namesOtherForm reads the way of answering a question names", () => {
    expect(namesOtherForm("open-response", "True or false? Prices rose in 1923.")).toBe(
      "true-false",
    );
    expect(namesOtherForm("true-false", "True or false? Prices rose in 1923.")).toBeUndefined();
    expect(namesOtherForm("open-response", "Choose the correct option and explain.")).toBe("hinge");
    expect(namesOtherForm("open-response", "Fill in the gaps below.")).toBe("fill-gap");
    expect(namesOtherForm("open-response", "Match each term to its meaning.")).toBe("matching");
    expect(
      namesOtherForm("open-response", "Choose one reason prices rose and explain your answer."),
    ).toBeUndefined();
    expect(
      namesOtherForm("open-response", "Why did the government print more money in 1923?"),
    ).toBeUndefined();
  });

  test("the gate rejects an open response that asks 'True or false?', on every rung", async () => {
    const open: DesignSlot = {
      form: "open-response",
      stem: "True or false? Rising prices did not affect everyone in the same way.",
      modelAnswer: "True. Borrowers could benefit.",
    };
    expect(slotFits(slotRender(open, "tf", []), "chalk", 0)).toBe(false);
    expect(slotFits(slotRender(open, "tf", []), "chalk", 1)).toBe(false);
    const fit = await fitSlot(open, { seed: "tf", themeId: "chalk" });
    expect(fit.rung).toBe("flagged");
  });

  test("y9-weimar slide 9: a hinge re-filled as true-false that does not fit never lands asking 'True or false?'", async () => {
    const hinge: DesignSlot = {
      form: "hinge",
      stem: "Which statement best explains how rising prices could affect people differently?",
      options: [
        {
          text: "People with savings or wages that did not keep pace with prices lost buying power; borrowers could benefit",
          correct: true,
        },
        { text: "Everyone became poorer in the same way", correct: false },
        { text: "People with savings always gained buying power as prices rose", correct: false },
        { text: "Borrowers found their debts harder to repay with devalued money", correct: false },
      ],
      explanation:
        "The effects varied: savings and wages that did not keep pace with prices lost buying power, while borrowers could benefit as debts became easier to repay.",
    };
    const refilled: DesignSlot = {
      form: "true-false",
      statement:
        "Rising prices did not affect everyone in the same way: people with savings or wages that lagged lost buying power, while borrowers could benefit, and many of them blamed the Weimar government for failing to control prices and protect their savings.",
      correct: true,
      explanation:
        "Savings and wages that did not keep pace with prices bought less, while debts became easier to repay with devalued money, so different groups were affected in different ways.",
    };
    const fit = await fitSlot(hinge, {
      seed: "weimar-9",
      themeId: "chalk",
      refill: async () => refilled,
    });
    const asked = askedOf(fit.slot);
    expect(asked?.question ?? "").not.toMatch(/true or false/i);
    if (fit.slot.form === "open-response") {
      expect(fit.slot.stem).toMatch(/^Explain why this is right: /);
      expect(fit.slot.modelAnswer).toBe(refilled.explanation);
    }
  });
});
