import { describe, expect, test } from "bun:test";
import flagged from "../fixtures/designer-r5-flagged.json";
import type { DesignSlot } from "../prompts/design-cycle";
import { askedOf } from "./answer-support";
import { slotRender } from "./coded-slides";
import { ASIDE_UNITS, asidesToNotes, fitSlot, namesOtherForm, slotFits } from "./slot-fit";

const slots = flagged as Record<string, DesignSlot>;

describe("r6 fit ladder: teaching never moves to the notes", () => {
  for (const [key, slot] of Object.entries(slots)) {
    test(`${key}: no teaching unit to the notes; sibling forms before the re-fill`, async () => {
      const calls: string[] = [];
      const refill = async (_s: DesignSlot, form: string) => {
        calls.push(form);
        return undefined;
      };
      const fit = await fitSlot(slot, {
        seed: key,
        themeId: "chalk",
        refill,
        teachingToNotes: false,
      });
      expect(fit.rung).not.toBe("notes");
      for (const t of fit.tried) {
        if (t.rung === "notes") expect(ASIDE_UNITS.has(t.detail ?? "")).toBe(true);
      }
      // The notes are the teacher's words as written: nothing taught was added to them.
      expect((fit.slot as { notes?: string }).notes ?? "").toBe(
        (slot as { notes?: string }).notes ?? "",
      );
      const firstRefill = fit.tried.findIndex((t) => t.rung === "refill");
      const lastSibling = fit.tried.map((t) => t.rung).lastIndexOf("sibling");
      if (firstRefill >= 0 && lastSibling >= 0) expect(lastSibling).toBeLessThan(firstRefill);
    });
  }

  test("asides still go: a discussion's footnote and a hinge's reason", () => {
    const talk = {
      form: "discussion",
      prompt: "Is a delta land or sea?",
      footnote: "Accept both.",
      notes: "Ask round.",
    } as unknown as DesignSlot;
    const [moved] = asidesToNotes(talk);
    expect(moved?.moved).toBe("footnote");
    expect((moved?.slot as { notes?: string } | undefined)?.notes).toBe("Ask round.\nAccept both.");
    const seq = {
      form: "sequence",
      heading: "h",
      steps: ["a", "b", "c"],
      notes: "",
    } as unknown as DesignSlot;
    expect(asidesToNotes(seq)).toEqual([]);
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
    const fit = await fitSlot(open, { seed: "tf", themeId: "chalk", teachingToNotes: false });
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
      teachingToNotes: false,
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
