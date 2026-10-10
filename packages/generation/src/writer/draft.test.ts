import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { peekPartial, type SlideDraft, SlideDrafts } from "./draft";
import { PartialJson } from "./partial";
import { replayRun } from "./replay-fixture";

/*
 * Live writing P4 (TEACH-202 part c): the open slide's drafts from the writer's stream. The 12
 * recorded writer outputs are fed piece by piece; each slide's drafts come in order, the template
 * first, every draft a prefix of the slide's final fields and of the next draft, the throttle
 * bounds the count, and the laid deck is the same with and without drafts.
 */

const DIR = join(import.meta.dir, "fixtures/replay");
const LESSONS = readdirSync(DIR).sort();
const textOf = (b: string) =>
  (JSON.parse(readFileSync(join(DIR, b, "main.json"), "utf8")) as { text: string }).text;

/** Seeded piece sizes 1..max characters (a writer delta is a few tokens). */
const pieces = (seed: number, max: number) => (text: string) => {
  const out: string[] = [];
  let x = seed;
  for (let at = 0; at < text.length; ) {
    x = (x * 1103515245 + 12345) % 2 ** 31;
    const n = 1 + (x % max);
    out.push(text.slice(at, at + n));
    at += n;
  }
  return out;
};

/** `a` is a prefix of `b`: strings by prefix, arrays and objects field by field (b may have more). */
const isPrefix = (a: unknown, b: unknown): boolean => {
  if (typeof a === "string") return typeof b === "string" && b.startsWith(a);
  if (Array.isArray(a))
    return Array.isArray(b) && a.length <= b.length && a.every((x, i) => isPrefix(x, b[i]));
  if (a && typeof a === "object")
    return (
      !!b &&
      typeof b === "object" &&
      !Array.isArray(b) &&
      Object.entries(a).every(([k, v]) => isPrefix(v, (b as Record<string, unknown>)[k]))
    );
  return a === b;
};
const words = (v: unknown): number =>
  typeof v === "string"
    ? v.length
    : Array.isArray(v)
      ? v.reduce((n: number, x) => n + words(x), 0)
      : v && typeof v === "object"
        ? Object.values(v).reduce((n: number, x) => n + words(x), 0)
        : 0;

/** Every slide of a writer text by the writer's index (title 0, slides[k] at k + 2). */
const finalSlides = (text: string) => {
  const out = JSON.parse(text) as {
    title: Record<string, unknown>;
    slides: Record<string, unknown>[];
  };
  const m = new Map<number, Record<string, unknown>>([[0, out.title]]);
  for (const [k, s] of out.slides.entries()) m.set(k + 2, s);
  return m;
};

/** Feeds a text through the parser and the drafts on a clock that spreads `lessonMs` over it. */
const feed = (text: string, split: (t: string) => string[], ms: number, lessonMs = 40_000) => {
  let fed = 0;
  const got: [number, SlideDraft][] = [];
  const drafts = new SlideDrafts((i, d) => got.push([i, d]), {
    ms,
    now: () => (fed / text.length) * lessonMs,
  });
  const parser = new PartialJson(() => {});
  for (const piece of split(text)) {
    fed += piece.length;
    parser.push(piece);
    drafts.update(parser);
  }
  return { got, stats: drafts.stats };
};

describe("peekPartial", () => {
  test("an open string value keeps what has arrived; an open key or a half value is left out", () => {
    expect(peekPartial('{"template":"exp')).toEqual({
      value: { template: "exp" },
      open: ["template"],
    });
    expect(peekPartial('{"template":"explain","hea')?.value).toEqual({ template: "explain" });
    expect(peekPartial('{"template":"explain","heading"')?.value).toEqual({ template: "explain" });
    expect(peekPartial('{"template":"explain","heading":')?.value).toEqual({ template: "explain" });
    expect(peekPartial('{"a":"x","n":12')?.value).toEqual({ a: "x" });
    expect(peekPartial('{"a":"x","n":12,')?.value).toEqual({ a: "x", n: 12 });
    expect(peekPartial('{"a":"x","b":tru')?.value).toEqual({ a: "x" });
    expect(peekPartial('{"points":["one","tw')).toEqual({
      value: { points: ["one", "tw"] },
      open: ["points", 1],
    });
    expect(peekPartial('{"points":[{"label":"L","text":"ab')?.value).toEqual({
      points: [{ label: "L", text: "ab" }],
    });
    expect(peekPartial('{"a":null,"b":[],')?.value).toEqual({ a: null, b: [] });
  });

  test("never cuts inside an escape or a surrogate pair", () => {
    expect(peekPartial('{"a":"x\\')?.value).toEqual({ a: "x" });
    expect(peekPartial('{"a":"x\\u00')?.value).toEqual({ a: "x" });
    expect(peekPartial('{"a":"x\\u00e9')?.value).toEqual({ a: "xé" });
    expect(peekPartial('{"a":"x\\ud83d')?.value).toEqual({ a: "x" });
    expect(peekPartial('{"a":"x\\ud83d\\ude00')?.value).toEqual({ a: "x😀" });
    expect(peekPartial('{"a":"x\\"q')?.value).toEqual({ a: 'x"q' });
    // a raw high surrogate whose low half is in the next delta
    expect(peekPartial(`{"a":"x${"😀".slice(0, 1)}`)?.value).toEqual({ a: "x" });
  });

  test.each(LESSONS)(
    "every prefix of %s: never throws, and is a prefix of the whole",
    (b) => {
      const text = textOf(b);
      const whole = JSON.parse(text) as unknown;
      let none = 0;
      for (let at = 1; at <= text.length; at += 5) {
        const p = peekPartial(text.slice(0, at));
        if (p) expect(isPrefix(p.value, whole)).toBe(true);
        else none++;
      }
      // only the first characters (before the first value) give nothing
      expect(none).toBeLessThan(3);
    },
    30_000,
  );

  test("junk never throws", () => {
    for (const junk of ["", "}", "]]", '{"a":}', '{"a" "b"}', "[1,,", "nul", '"\\', "{{{"])
      expect(() => peekPartial(junk)).not.toThrow();
  });
});

describe.each(LESSONS)("drafts from %s", (b) => {
  const text = textOf(b);
  const finals = finalSlides(text);

  test("in slide order, template first, each a prefix of the next and of the final slide", () => {
    for (const [seed, max] of [
      [3, 1],
      [11, 8],
      [b.length, 24],
    ] as const) {
      const { got } = feed(text, pieces(seed, max), 200);
      const order = got.map(([i]) => i);
      // slides in the stream's order, each slide's drafts together
      expect(order).toEqual([...order].sort((x, y) => x - y));
      expect([...new Set(order)]).toEqual([...finals.keys()]);
      const prev = new Map<number, Record<string, unknown>>();
      for (const [i, d] of got) {
        const fin = finals.get(i) as Record<string, unknown>;
        expect(d.template).toBe(fin.template as string);
        expect(isPrefix(d.fields, fin)).toBe(true);
        const before = prev.get(i);
        if (before) expect(isPrefix(before, d.fields)).toBe(true);
        else if (max === 1)
          expect(words(d.fields)).toBe(0); // the template before any text
        else expect(words(d.fields)).toBeLessThan(max);
        prev.set(i, d.fields);
      }
    }
  });

  test("the throttle bounds the drafts: about one per 200 ms, plus each slide's template", () => {
    const lessonMs = 40_000;
    const split = pieces(5, 6);
    const free = feed(text, split, 0, lessonMs).got.length;
    const { got } = feed(text, split, 200, lessonMs);
    expect(got.length).toBeLessThanOrEqual(lessonMs / 200 + finals.size);
    expect(got.length).toBeLessThan(free);
    // each slide gets several typed steps
    const per = [...finals.keys()].map((i) => got.filter(([j]) => j === i).length);
    expect(Math.min(...per)).toBeGreaterThanOrEqual(2);
  });
});

/** The deck with every element id dropped (as stream-replay.test.ts compares it). */
const stable = (v: unknown, top = true): unknown => {
  if (Array.isArray(v)) return v.map((x) => stable(x, false));
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v)
        .filter(([k]) => !(k === "id" && !top))
        .map(([k, x]) => [k, stable(x, false)]),
    );
  return v;
};

describe.each(LESSONS)("runWriter with onDraft, %s", (b) => {
  test("the laid deck, checks and cost are the same with and without drafts; drafts come before their slide", async () => {
    const split = pieces(b.length * 7 + 1, 16);
    const plain = await replayRun(b, { stream: split });
    const events: string[] = [];
    const withDrafts = await replayRun(b, {
      stream: split,
      hooks: {
        onDraft: (i) => events.push(`draft:${i}`),
        onSlide: (i) => events.push(`slide:${i}`),
        draft: { ms: 0 },
      },
    });
    const throwing = await replayRun(b, {
      stream: split,
      hooks: {
        onDraft: () => {
          throw new Error("a broken draft listener");
        },
      },
    });
    const deck = JSON.stringify(stable(plain.slides));
    expect(JSON.stringify(stable(withDrafts.slides))).toBe(deck);
    expect(JSON.stringify(stable(throwing.slides))).toBe(deck);
    expect(withDrafts.checks).toEqual(plain.checks);
    expect(throwing.checks).toEqual(plain.checks);
    expect(withDrafts.writer.usd).toBe(plain.writer.usd);
    const drafted = [...new Set(events.filter((e) => e.startsWith("draft:")))];
    expect(drafted.length).toBe(finalSlides(textOf(b)).size);
    for (const d of drafted) {
      const i = d.split(":")[1];
      const firstSlide = events.indexOf(`slide:${i}`);
      if (firstSlide >= 0) expect(events.indexOf(d)).toBeLessThan(firstSlide);
    }
  }, 60_000);
});
