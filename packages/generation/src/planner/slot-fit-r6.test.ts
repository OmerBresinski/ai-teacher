import { describe, expect, test } from "bun:test";
import flagged from "../fixtures/designer-r5-flagged.json";
import type { DesignSlot } from "../prompts/design-cycle";
import { ASIDE_UNITS, asidesToNotes, fitSlot } from "./slot-fit";

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
