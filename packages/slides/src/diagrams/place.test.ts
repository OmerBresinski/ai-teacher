import { describe, expect, test } from "bun:test";
import { THEMES } from "../themes";
import { isLetterLabel, placeLabel, scene } from "./place";
import { context } from "./svg";

/*
 * TEACH-247 part cg (Rivers v6 s7): a label that is one letter names a part only by pointing at it,
 * so it always stands off its point on a leader; a name fits by its point and needs none.
 */
describe("placeLabel: a letter always has a leader", () => {
  const theme = THEMES[0];
  if (!theme) throw new Error("no theme");
  const place = (text: string) => {
    const x = { ...context(theme, 400, 300), leaders: [] as [number, number, number, number][] };
    const svg = placeLabel(x, scene(), 400, 300, { text, at: [200, 150] });
    return { svg, leaders: x.leaders };
  };

  test("one letter stands off its point on a leader to it", () => {
    for (const letter of ["A", "B", "C"]) {
      const { svg, leaders } = place(letter);
      expect(leaders).toHaveLength(1);
      const [px, py, ex, ey] = leaders[0] as [number, number, number, number];
      expect([px, py]).toEqual([200, 150]);
      expect(Math.hypot(ex - px, ey - py)).toBeGreaterThan(10);
      expect(svg).toContain("<line ");
    }
  });

  test("a name with room by its point needs no leader", () => {
    expect(place("River cliff").leaders).toHaveLength(0);
  });

  test("isLetterLabel: one letter only", () => {
    expect(["A", "b", " C "].map(isLetterLabel)).toEqual([true, true, true]);
    expect(["AB", "1", "?", "", "Outer bank"].map(isLetterLabel)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});
