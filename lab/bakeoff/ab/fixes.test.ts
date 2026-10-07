import { describe, expect, test } from "bun:test";
import { shuffleHinge, withCorrectLetter, writerIncomplete } from "../harness";
import { abFixes, setAbArm } from "./arms";

const whole = JSON.stringify({
  flow: [],
  title: {},
  slides: Array(8).fill({ template: "explain" }),
});

describe("K3: incomplete writer output fails the run", () => {
  test("a whole output passes", () => {
    expect(writerIncomplete({ finishReason: "stop", text: whole, minSlides: 9 })).toBeUndefined();
  });
  test("token limit, unclosed JSON and too few slides each fail", () => {
    expect(writerIncomplete({ finishReason: "length", text: whole, minSlides: 9 })).toMatch(
      /length/,
    );
    // the 2 Oct/7 Oct headings decks: the stream stops inside the flow's teaches loop
    const cut = '{"design":{},"flow":[{"slide":1,"does":"Title","teaches":[3,2,1,2,1,3,3';
    expect(writerIncomplete({ finishReason: "stop", text: cut, minSlides: 9 })).toMatch(/parse/);
    const short = JSON.stringify({ flow: [], title: {}, slides: [{}, {}] });
    expect(writerIncomplete({ finishReason: "stop", text: short, minSlides: 9 })).toMatch(
      /under 7/,
    );
    expect(writerIncomplete({ finishReason: "stop", text: "{}", minSlides: 9 })).toMatch(
      /0 slides/,
    );
  });
});

describe("seeded hinge shuffle", () => {
  const hinge = (correct: number) => ({
    template: "hinge",
    heading: "Check",
    stem: "Which is a quarter of 12?",
    options: ["2", "3", "4", "6"],
    correct,
  });
  test("keeps the options and the answer; the same seed gives the same order", () => {
    const a = shuffleHinge(hinge(2), "y5:7:stem");
    const b = shuffleHinge(hinge(2), "y5:7:stem");
    expect(a).toEqual(b);
    expect([...(a.options as string[])].sort()).toEqual(["2", "3", "4", "6"]);
    expect((a.options as string[])[(a.correct as number) - 1]).toBe("3");
    expect(a.stem).toBe("Which is a quarter of 12?");
  });
  test("the correct position is uniform even when the writer always says B", () => {
    const n = 8000;
    const at = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      const s = shuffleHinge(hinge(2), `brief-${i % 37}:${i}:stem ${i}`);
      at[(s.correct as number) - 1]! += 1;
      expect((s.options as string[])[(s.correct as number) - 1]).toBe("3");
    }
    // chi-square, 3 degrees of freedom: 16.27 is p = 0.001
    const chi = at.reduce((x, o) => x + (o - n / 4) ** 2 / (n / 4), 0);
    expect(chi).toBeLessThan(16.27);
    for (const o of at) expect(o / n).toBeGreaterThan(0.22);
  });
  test("three options are uniform too", () => {
    const at = [0, 0, 0];
    for (let i = 0; i < 6000; i++) {
      const s = shuffleHinge({ template: "hinge", options: ["x", "y", "z"], correct: 1 }, `s${i}`);
      at[(s.correct as number) - 1]! += 1;
    }
    for (const o of at) expect(o / 6000).toBeGreaterThan(0.3);
  });
  test("the answer key letter follows the shuffled position", () => {
    const s = shuffleHinge(hinge(2), "y5:7:stem");
    const letter = String.fromCharCode(64 + (s.correct as number));
    expect(withCorrectLetter("3, because 12 / 4 = 3", s)).toBe(`${letter}: 3, because 12 / 4 = 3`);
  });
  test("leaves other slides and malformed hinges alone", () => {
    const q = { template: "question-set", questions: ["a"] };
    expect(shuffleHinge(q, "x")).toBe(q);
    const bad = { template: "hinge", options: ["a", "b"], correct: 5 };
    expect(shuffleHinge(bad, "x")).toBe(bad);
  });
});

describe("fixes are base3 onwards only", () => {
  test("off for the screened arms", () => {
    for (const a of ["base", "base2", "k1"] as const) {
      setAbArm(a);
      expect(abFixes()).toBe(false);
    }
    setAbArm("base3");
    expect(abFixes()).toBe(true);
    setAbArm(undefined);
    expect(abFixes()).toBe(false);
  });
});
