import { describe, expect, test } from "bun:test";
import { blockProblems } from "../worksheet/block-problems";
import { DEMO_LESSON_FACTS } from "./demo-facts";
import { WORKSHEET_RECIPES } from "./worksheet-recipes";

/*
 * The recipes and their tests live in `@tj/slides` (ADR 0030 item 4). `blockProblems` reads the
 * editor's text serialiser, so the one check that needs it stays here.
 */
describe("worksheet recipes (editor)", () => {
  test("every block of every recipe, with and without facts, is free of blockProblems", () => {
    for (const recipe of WORKSHEET_RECIPES) {
      for (const withFacts of [true, false]) {
        for (const block of recipe.build(withFacts ? DEMO_LESSON_FACTS : undefined)) {
          expect(blockProblems(block), `${recipe.id} facts=${withFacts}`).toEqual([]);
        }
      }
    }
  });
});
