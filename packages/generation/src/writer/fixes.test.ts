import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fnv, shuffleHinge, withCorrectLetter, writerIncomplete } from "./fixes";
import { writerSchema } from "./schema";

const FIX = join(import.meta.dir, "fixtures");

describe("schema bounds (K1)", () => {
  test.each([
    ["Quick", 6, 8],
    ["Standard", 9, 12],
    ["Detailed", 13, 20],
  ])("%s: flow is the whole lesson, slides the lesson minus 2", (_t, min, max) => {
    const s = writerSchema("KS2", { min, max }) as {
      properties: {
        flow: { minItems: number; maxItems: number };
        slides: { minItems: number; maxItems: number };
      };
    };
    expect([s.properties.flow.minItems, s.properties.flow.maxItems]).toEqual([min, max]);
    expect([s.properties.slides.minItems, s.properties.slides.maxItems]).toEqual([
      min - 2,
      max - 2,
    ]);
  });
});

describe("saved writer outputs (row 3)", () => {
  const files = readdirSync(join(FIX, "writer-outputs"));
  test("all 24 are present", () => expect(files.length).toBe(24));
  test.each(files)("%s parses whole, flow = slides + 2, no runaway field", (f) => {
    const m = JSON.parse(readFileSync(join(FIX, "writer-outputs", f), "utf8")) as {
      text: string;
      finishReason?: string | null;
    };
    expect(
      writerIncomplete({ text: m.text, finishReason: m.finishReason ?? null, minSlides: 9 }),
    ).toBeUndefined();
    const out = JSON.parse(m.text) as { flow: { teaches: number[] }[]; slides: unknown[] };
    expect(out.flow.length).toBe(out.slides.length + 2);
    // A runaway `teaches` array or a run of whitespace is the failure K1 closed.
    for (const f of out.flow) expect(f.teaches.length).toBeLessThanOrEqual(6);
    expect(/\s{40,}/.test(m.text)).toBe(false);
  });
});

describe("K3: an incomplete writer output (row 5)", () => {
  test("the saved headings-only stream does not parse", () => {
    const m = JSON.parse(readFileSync(join(FIX, "incomplete/headings-only-y11.json"), "utf8")) as {
      text: string;
    };
    expect(writerIncomplete({ text: m.text, minSlides: 9 })).toBe("writer JSON does not parse");
  });
  test("a length finish", () => {
    expect(writerIncomplete({ text: "{}", finishReason: "length", minSlides: 9 })).toBe(
      "finish_reason length (token limit)",
    );
  });
  test("too few slides", () => {
    expect(writerIncomplete({ text: JSON.stringify({ slides: [1, 2, 3] }), minSlides: 9 })).toBe(
      "3 slides after title and objectives, under 6",
    );
  });
});

describe("seeded hinge shuffle (row 6)", () => {
  const hinge = (k: number) => ({
    template: "hinge",
    heading: `Check ${k}`,
    stem: `Which is right, number ${k}?`,
    options: ["right", "wrong one", "wrong two", "wrong three"],
    correct: 1,
  });
  const seeds = Array.from(
    { length: 100 },
    (_, k) => `lesson-${k}:${3 + (k % 7)}:${hinge(k).stem}`,
  );

  test("the same seed gives the same order", () => {
    expect(shuffleHinge(hinge(1), seeds[1] as string)).toEqual(
      shuffleHinge(hinge(1), seeds[1] as string),
    );
  });
  test("`correct` follows its option", () => {
    seeds.forEach((seed, k) => {
      const s = shuffleHinge(hinge(k), seed) as { options: string[]; correct: number };
      expect(s.options[s.correct - 1]).toBe("right");
    });
  });
  test("the correct letter is roughly uniform over 100 seeds (chi-square, 3 df, p > 0.01)", () => {
    const n = [0, 0, 0, 0];
    seeds.forEach((seed, k) => {
      const c = (shuffleHinge(hinge(k), seed) as { correct: number }).correct;
      n[c - 1] = (n[c - 1] ?? 0) + 1;
    });
    const chi = n.reduce((a, o) => a + (o - 25) ** 2 / 25, 0);
    expect(chi).toBeLessThan(11.34);
  });
  test("the answer key is lettered from the slide as shown", () => {
    const s = shuffleHinge(hinge(5), seeds[5] as string);
    const letter = String.fromCharCode(64 + Number(s.correct));
    expect(withCorrectLetter("right", s)).toBe(`${letter}: right`);
  });
  test("a non-hinge slide is unchanged", () => {
    const s = { template: "explain", heading: "x" };
    expect(shuffleHinge(s, "a")).toBe(s);
  });
  test("fnv is the 32-bit FNV-1a", () => expect(fnv("a")).toBe(0xe40c292c));
});
