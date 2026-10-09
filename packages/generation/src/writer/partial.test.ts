import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PartialJson, type Path } from "./partial";

/* The writer's stream parser (TEACH-110 part h, C1), ported from the lab's `partial.ts`. */

const collect = (pieces: string[]) => {
  const got: [Path, unknown][] = [];
  const p = new PartialJson((path, value) => got.push([path, value]));
  for (const piece of pieces) p.push(piece);
  return got;
};
/** Seeded piece sizes (1–40 characters), so every boundary case comes up. */
const pieces = (text: string, seed: number) => {
  const out: string[] = [];
  let x = seed;
  for (let at = 0; at < text.length; ) {
    x = (x * 1103515245 + 12345) % 2 ** 31;
    const n = 1 + (x % 40);
    out.push(text.slice(at, at + n));
    at += n;
  }
  return out;
};

describe("PartialJson", () => {
  test("top-level values and top-level array items close with their paths", () => {
    const text = JSON.stringify({ design: { theme: "studio" }, flow: [1, 2], slides: [{ a: 1 }] });
    const got = collect([text]);
    expect(got).toContainEqual([["design"], { theme: "studio" }]);
    expect(got).toContainEqual([["design", "theme"], "studio"]);
    expect(got).toContainEqual([["flow"], [1, 2]]);
    expect(got).toContainEqual([["slides", 0], { a: 1 }]);
    expect(got).toContainEqual([["slides"], [{ a: 1 }]]);
    // nothing deeper than two levels
    expect(got.some(([p]) => p.length > 2)).toBe(false);
  });

  test("strings with braces, quotes and escapes do not confuse it, at any piece boundary", () => {
    const slides = [
      { heading: 'Brace } and [bracket] and "quote"', body: "back\\slash \\u00e9 \n new" },
      { heading: "", n: -1.5e3, ok: true, none: null },
    ];
    const text = JSON.stringify({ title: { h: "{" }, slides });
    for (let seed = 1; seed <= 50; seed++) {
      const got = collect(pieces(text, seed));
      const closed = got.filter(([p]) => p[0] === "slides" && p.length === 2).map(([, v]) => v);
      expect(closed).toEqual(slides);
      expect(got).toContainEqual([["title"], { h: "{" }]);
    }
  });

  test("every saved writer output: the streamed slides equal the final parse, in order", () => {
    const dir = join(import.meta.dir, "fixtures/replay");
    for (const b of readdirSync(dir)) {
      const main = JSON.parse(readFileSync(join(dir, b, "main.json"), "utf8")) as { text: string };
      const whole = JSON.parse(main.text) as { slides: unknown[]; title: unknown; flow: unknown };
      const got = collect(pieces(main.text, b.length));
      const slides = got.filter(([p]) => p[0] === "slides" && p.length === 2);
      expect(slides.map(([p]) => p[1])).toEqual(whole.slides.map((_, k) => k));
      expect(slides.map(([, v]) => v)).toEqual(whole.slides);
      const order = got.filter(([p]) => p.length === 1).map(([p]) => p[0]);
      expect(order.slice(0, 3)).toEqual(["design", "flow", "title"]);
    }
  });
});
