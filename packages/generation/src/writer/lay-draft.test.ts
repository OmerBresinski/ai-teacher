import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { holdTypeSizes } from "./lay-draft";
import { replayRun } from "./replay-fixture";

/*
 * Live writing P6 (TEACH-202 part f, ADR 0039): each draft laid out while the stream writes. Every
 * recorded writer output is fed piece by piece: each slide is laid before its words close, its
 * text grows through the drafts, its type never steps back up, and the laid deck is untouched.
 */

const DIR = join(import.meta.dir, "fixtures/replay");
const LESSONS = readdirSync(DIR).sort();

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

type El = { id: string; type: string; style?: { fontSize?: number }; children?: El[] };
const texts = (els: El[]): string =>
  els
    .map((e) =>
      e.children ? texts(e.children) : e.type === "text" ? JSON.stringify(e).length : "",
    )
    .join("|");
const sizes = (els: El[], out = new Map<string, number>()) => {
  for (const e of els) {
    if (e.children) sizes(e.children, out);
    if (e.type === "text" && typeof e.style?.fontSize === "number") out.set(e.id, e.style.fontSize);
  }
  return out;
};
const wordsOf = (els: El[]): number =>
  els.reduce((n, e) => {
    if (e.children) return n + wordsOf(e.children);
    if (e.type !== "text") return n;
    const t = JSON.stringify(e).match(/"text":"((?:[^"\\]|\\.)*)"/g) ?? [];
    return n + t.join(" ").split(/\s+/).filter(Boolean).length;
  }, 0);

/** The deck with every element id dropped (layouts mint fresh ids). */
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

describe("holdTypeSizes", () => {
  test("a size above the slide's last draft is held; a smaller one is taken", () => {
    const held = new Map<string, number>();
    const el = (fontSize: number) =>
      ({ id: "a", type: "text", style: { fontSize }, doc: {} }) as never;
    const at = (n: number) =>
      (holdTypeSizes({ kind: "content", elements: [el(n)] } as never, held).elements[0] as El).style
        ?.fontSize;
    expect(at(32)).toBe(32);
    expect(at(28)).toBe(28);
    expect(at(32)).toBe(28);
    expect(at(24)).toBe(24);
  });
});

describe.each(LESSONS)("laid drafts of %s", (b) => {
  test("each slide is laid before it closes, grows, never steps type up; the deck is unchanged", async () => {
    const split = pieces(b.length * 11 + 3, 12);
    const plain = await replayRun(b, { stream: split });
    const drafts = new Map<number, El[][]>();
    const order: string[] = [];
    const run = await replayRun(b, {
      stream: split,
      hooks: {
        draft: { ms: 0 },
        onDraftSlide: (i, s) => {
          expect(s.id).toBe(`s${i + 1}`);
          expect(s.question).toBeUndefined();
          const ids = JSON.stringify(s.elements).match(/"id":"[^"]+"/g) ?? [];
          expect(ids.every((x) => x.startsWith('"id":"d-'))).toBe(true);
          expect(new Set(ids).size).toBe(ids.length);
          drafts.set(i, [...(drafts.get(i) ?? []), s.elements as El[]]);
          order.push(`draft:${i}`);
        },
        onSlide: (i) => order.push(`slide:${i}`),
      },
    });
    expect(JSON.stringify(stable(run.slides))).toBe(JSON.stringify(stable(plain.slides)));
    expect(drafts.size).toBeGreaterThan(3);
    for (const [i, laid] of drafts) {
      expect(order.indexOf(`draft:${i}`)).toBeLessThan(order.indexOf(`slide:${i}`));
      expect(i).not.toBe(1);
      // Words grow: the last draft holds at least as many words as the first.
      expect(wordsOf(laid.at(-1) ?? [])).toBeGreaterThanOrEqual(wordsOf(laid[0] ?? []));
      // Type never steps back up within a slide.
      const seen = new Map<string, number>();
      for (const els of laid)
        for (const [id, size] of sizes(els)) {
          const was = seen.get(id);
          if (was !== undefined) expect(size).toBeLessThanOrEqual(was);
          seen.set(id, size);
        }
    }
    // Most slides show their words growing over several drafts.
    const growing = [...drafts.values()].filter((l) => new Set(l.map(texts)).size >= 5).length;
    expect(growing).toBeGreaterThanOrEqual(Math.floor(drafts.size / 2));
  }, 60_000);
});

describe("the slide's structure comes first (TEACH-202 part f)", () => {
  test("a slide the flow gives a visual holds its visual column from the first draft to its close", async () => {
    const b = "y5-maths-fractions-of-amounts";
    const flow = (
      JSON.parse(
        (JSON.parse(await Bun.file(join(DIR, b, "main.json")).text()) as { text: string }).text,
      ) as { flow: { slide: number; look_at: { kind: string } }[] }
    ).flow;
    const visual = new Set(flow.filter((f) => f.look_at.kind !== "none").map((f) => f.slide - 1));
    const shows = (els: El[]): boolean =>
      els.some(
        (e) =>
          (e.type !== "text" && e.type !== "shape") ||
          shows((e.children as El[] | undefined) ?? []),
      );
    const seen = new Map<number, boolean[]>();
    await replayRun(b, {
      stream: pieces(4000, 9),
      // No picture placer: a diagram slot stays open until the deck is editable.
      visual: (_i, _k, a) => (a.type === "diagram" ? { status: "pending" } : { status: "failed" }),
      hooks: {
        draft: { ms: 0 },
        onDraftSlide: (i, s) => seen.set(i, [...(seen.get(i) ?? []), shows(s.elements as El[])]),
        onSlide: (i, s) => seen.set(i, [...(seen.get(i) ?? []), shows(s.elements as El[])]),
      },
    });
    expect(visual.size).toBeGreaterThan(2);
    for (const i of visual) {
      const laid = seen.get(i) ?? [];
      expect(laid.length).toBeGreaterThan(2);
      expect(laid.every(Boolean)).toBe(true);
    }
  }, 60_000);
});

describe("the hand-over keeps every box (TEACH-202 part f review)", () => {
  test("the laid slide reuses its last draft's element ids, so nothing remounts", async () => {
    const ids = (els: El[]): string[] =>
      els.flatMap((e) => [e.id, ...ids((e.children as El[] | undefined) ?? [])]);
    const last = new Map<number, string[]>();
    const handed = new Map<number, string[]>();
    await replayRun("y5-maths-fractions-of-amounts", {
      stream: pieces(4000, 9),
      hooks: {
        draft: { ms: 0 },
        onDraftSlide: (i, s) => last.set(i, ids(s.elements as El[])),
        onSlide: (i, s) => {
          if (!handed.has(i)) handed.set(i, ids(s.elements as El[]));
        },
      },
    });
    expect(last.size).toBeGreaterThan(3);
    let kept = 0;
    for (const [i, drafted] of last) {
      const laid = new Set(handed.get(i) ?? []);
      const text = drafted.filter((id) => /-(Heading|Lead|Title)/i.test(id));
      for (const id of text) expect(laid.has(id)).toBe(true);
      kept += drafted.filter((id) => laid.has(id)).length;
      expect([...laid].every((id) => id.startsWith(`d-s${i + 1}-`))).toBe(true);
    }
    expect(kept).toBeGreaterThan(last.size);
  }, 60_000);
});
