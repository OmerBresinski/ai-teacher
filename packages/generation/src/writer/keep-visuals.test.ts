import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PLACEHOLDER_IMAGE } from "@tj/slides/layouts";
import { getTheme } from "@tj/slides/themes";
import { sampleBriefLesson } from "../testing";
import type { Brief } from "./fixes";
import {
  keepsTiles,
  materialise,
  type Plan,
  type VisualAsk,
  type VisualState,
} from "./materialise";
import { replayServices } from "./replay-fixture";
import { runWriter } from "./stage";

/* TEACH-251 part h (LAYOUT-SEL DOWNGRADES): a set or title keeps its visual when some pictures miss. */
type S = Record<string, unknown>;
type El = { type: string; name?: string; src?: string; doc?: unknown };

const base = {
  brief: { ...sampleBriefLesson().brief, keyStage: "KS2" } as never,
  theme: getTheme(undefined as never, "KS2" as never),
  stage: "KS2" as never,
};
const photo = (key: string): VisualState => ({
  status: "photo",
  photo: { src: `/files/test/${key}.png`, alt: key, aspect: 1.2, request: key },
});
const lay = (s: S, failed: string[]) => {
  const plan = { slides: [undefined, undefined, s] } as unknown as Plan;
  const m = materialise(s, {
    ...base,
    index: 2,
    plan,
    visual: (k) => (failed.includes(k) ? { status: "failed" } : photo(k)),
  });
  const els = m.slide.elements as El[];
  return {
    els,
    images: els.filter((e) => e.type === "image").length,
    tiles: els.filter((e) => e.name === "Caption tile").length,
    words: JSON.stringify(els),
  };
};

const SEQ: S = {
  template: "picture-sequence",
  heading: "How a mummy was made",
  sequence: [
    { shows: "Priests washing a body", caption: "Wash the body" },
    { shows: "Canopic jars holding the organs", caption: "Remove the organs" },
    { shows: "A body covered in natron salt", caption: "Dry it with natron" },
    { shows: "A body wrapped in linen", caption: "Wrap it in linen" },
  ],
};

describe("a picture sequence keeps its layout when at least half its pictures land", () => {
  test("the half rule", () => {
    expect([keepsTiles(4, 4), keepsTiles(2, 4), keepsTiles(1, 2)]).toEqual([true, true, true]);
    expect([keepsTiles(1, 4), keepsTiles(0, 2), keepsTiles(0, 0)]).toEqual([false, false, false]);
  });

  test("one of four missing: still a sequence, the missing panel a tile with its own caption", () => {
    const r = lay(SEQ, ["seq.1"]);
    expect(r.images).toBe(3);
    expect(r.tiles).toBe(1);
    expect(r.els.some((e) => e.src === PLACEHOLDER_IMAGE)).toBe(false);
    // The caption text appears once (on the tile), and nothing the writer did not write.
    expect(r.words.split("Remove the organs").length - 1).toBe(1);
    for (const c of ["Wash the body", "Dry it with natron", "Wrap it in linen"])
      expect(r.words).toContain(c);
  });

  test("two of four missing is still half: the sequence stays", () => {
    const r = lay(SEQ, ["seq.0", "seq.3"]);
    expect([r.images, r.tiles]).toEqual([2, 2]);
  });

  test("three of four missing: today's numbered steps, no picture and no tile", () => {
    const r = lay(SEQ, ["seq.0", "seq.1", "seq.2"]);
    expect([r.images, r.tiles]).toEqual([0, 0]);
  });
});

describe("compare cards keep their pictures when at least half land", () => {
  const CMP: S = {
    template: "compare",
    heading: "Young and adult",
    columns: [
      { label: "Puppy", text: "Small and playful", picture: { shows: "A small puppy" } },
      { label: "Adult dog", text: "Fully grown", picture: { shows: "An adult dog" } },
    ],
  };
  test("one of two missing: that card shows its label on a tile", () => {
    const r = lay(CMP, ["col.1"]);
    expect([r.images, r.tiles]).toEqual([1, 1]);
  });
  test("both missing: text cards, as before", () => {
    const r = lay(CMP, ["col.0", "col.1"]);
    expect([r.images, r.tiles]).toEqual([0, 0]);
  });
});

describe("a failed title picture: one search for the topic, then no picture slot", () => {
  const B = "y2-maths-halves-quarters";
  const DIR = join(import.meta.dir, "fixtures/replay", B);
  const read = (f: string) => readFileSync(join(DIR, f), "utf8");

  async function run(lands: boolean, over: { brief?: Partial<Brief>; canReask?: boolean } = {}) {
    const brief = { ...(JSON.parse(read("brief.json")) as Brief), ...over.brief } as Brief;
    const objectives = (
      JSON.parse(read("objectives.json")) as { objectives: { teacher: string }[] }
    ).objectives.map((o) => o.teacher);
    const main = JSON.parse(read("main.json")) as { text: string; finishReason?: string };
    const asked: VisualAsk[] = [];
    const events: S[] = [];
    let retried = false;
    const res = await runWriter({
      brief,
      objectives,
      services: { ...replayServices(B), log: (e) => events.push(e as S) },
      // Every picture failed at settle; the title's retry lands only when `lands`.
      // Every picture failed at settle. The title's retry lands only when `lands`; otherwise its
      // slot reads pending (the Egypt run's title was laid while pending: a grey placeholder).
      visual: (i, key) =>
        i === 0 && key === "picture" && retried
          ? lands
            ? photo("title")
            : { status: "pending" }
          : { status: "failed" },
      recordedWriter: { text: main.text, finishReason: main.finishReason ?? null },
      beforeEditable: async () => {},
      ...(over.canReask === undefined ? {} : { canReask: () => over.canReask as boolean }),
      placeMore: async (i, more) => {
        if (i === 0) {
          asked.push(...more);
          retried = true;
        }
      },
    });
    const els = (res.slides[0]?.elements ?? []) as El[];
    return { els, asked, events, topic: brief.topic };
  }

  test("the retry asks for the lesson's topic itself, and its picture is shown", async () => {
    const { els, asked, events, topic } = await run(true);
    expect(asked).toHaveLength(1);
    // `named` is the lesson's, not the failed ask's: a present-day maths lesson's title is not.
    expect(asked[0]).toMatchObject({ type: "photo", shows: topic, mustSee: [topic], named: false });
    expect(els.find((e) => e.type === "image")?.src).toBe("/files/test/title.png");
    expect(events).toContainEqual(expect.objectContaining({ ev: "title-retry", ok: true }));
  });

  test("the retry fails too: the title is laid out with no picture slot, never a placeholder", async () => {
    const { els, asked } = await run(false);
    expect(asked).toHaveLength(1);
    expect(els.some((e) => e.type === "image")).toBe(false);
  });

  test("a history lesson's retry is a named (real-only) ask, whatever the failed ask said", async () => {
    const { asked } = await run(false, { brief: { historicalPeriod: "Ancient Egypt" } });
    expect(asked[0]).toMatchObject({ named: true });
  });

  test("a title already re-asked this round is laid out with no picture, and says so", async () => {
    const { els, asked, events } = await run(true, { canReask: false });
    expect(asked).toHaveLength(0);
    expect(els.some((e) => e.type === "image")).toBe(false);
    expect(events).toContainEqual(
      expect.objectContaining({ ev: "title-retry", ok: false, skipped: "already-reasked" }),
    );
  });
});
