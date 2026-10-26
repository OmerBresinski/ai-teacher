/**
 * TEACH-247 part ai: `relayAnswersSlide` on the guard. Ids survive a re-lay, and a guard whose
 * words the teacher changed is left to the recolour. (Answers pages: the editor's
 * `greatfire-answers-refit.test.ts`, which has a lesson to read the answers from.)
 */
import { describe, expect, test } from "bun:test";
import type { Slide } from "@tj/domain/documents";
import { relayAnswersSlide, stageOf } from "./relayout";
import { layoutAnswersGuard } from "./templates/end-answers";
import { atKeyStage, THEMES } from "./themes";

const theme = (id: string) =>
  atKeyStage(THEMES.find((t) => t.id === id) ?? (THEMES[0] as (typeof THEMES)[number]), "ks1");
const splash = theme("splash");
const crayon = theme("crayon");
const guard = (): Slide => ({
  ...layoutAnswersGuard(splash, stageOf(splash, "ks1")).slide,
  id: "guard",
});

describe("relayAnswersSlide on the guard (TEACH-247 part ai)", () => {
  test("re-laid in the new theme with every id kept", () => {
    const g = guard();
    const out = relayAnswersSlide(g, [g], crayon, "ks1") as Slide;
    expect(out.id).toBe("guard");
    expect(out.elements.map((e) => e.id).sort()).toEqual(g.elements.map((e) => e.id).sort());
  });

  test("a guard whose words the teacher changed is not re-laid", () => {
    const g = guard();
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Mrs Khan's answers next" }] },
      ],
    };
    let done = false;
    const edited: Slide = {
      ...g,
      elements: g.elements.map((e) => {
        if (done || e.type !== "text") return e;
        done = true;
        return { ...e, doc } as typeof e;
      }),
    };
    expect(done).toBe(true);
    expect(relayAnswersSlide(edited, [edited], crayon, "ks1")).toBeNull();
  });

  test("every id survives when the template reorders or adds an element", () => {
    const g = guard();
    // Stored in another order and lacking one element the template now draws.
    const drop = g.elements.findIndex((e) => !(e as { doc?: unknown }).doc);
    expect(drop).toBeGreaterThanOrEqual(0);
    const stored: Slide = { ...g, elements: g.elements.filter((_, i) => i !== drop).reverse() };
    const out = relayAnswersSlide(stored, [stored], crayon, "ks1") as Slide;
    const ids = new Set(out.elements.map((e) => e.id));
    for (const e of stored.elements) expect(ids.has(e.id)).toBe(true);
    expect(out.elements.length).toBe(g.elements.length);
  });
});
