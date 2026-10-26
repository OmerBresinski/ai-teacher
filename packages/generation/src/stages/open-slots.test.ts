import { describe, expect, test } from "bun:test";
import type { Slide } from "@tj/domain/documents";
import { PLACEHOLDER_IMAGE } from "@tj/slides/layouts";
import { getTheme } from "@tj/slides/themes";
import { hasOpenJobSlots, isOpenJobSlot, resolveOpenSlots } from "./open-slots";

/* Part av: no picture slot stays open once the job is over (searched again, else laid away). */
const theme = getTheme("paper", null);
const text = (id: string, t: string) =>
  ({
    id,
    type: "text",
    x: 80,
    y: 200,
    w: 800,
    h: 120,
    text: t,
    style: { preset: "body" },
  }) as unknown as Slide["elements"][number];
const frame = (id: string, alt: string) =>
  ({ id, type: "image", x: 980, y: 200, w: 800, h: 600, src: PLACEHOLDER_IMAGE, alt }) as never;
const slide = (id: string, els: Slide["elements"]) =>
  ({ id, kind: "content", elements: els }) as unknown as Slide;

describe("resolveOpenSlots", () => {
  const deck = () => [
    slide("s3", [text("t3", "Roots take in water."), frame("p3", "Plant roots in soil")]),
    slide("s4", [text("t4", "Leaves make food."), frame("p4", "A green leaf")]),
    slide("s5", [text("t5", "Your turn."), frame("b5", "Describe this image…")]),
  ];

  test("a slot the search finds is filled in its frame; one it misses is laid away", async () => {
    const asked: string[] = [];
    const r = await resolveOpenSlots(deck(), {
      theme,
      search: async (open) => {
        asked.push(...open.map((o) => String(o.slot.alt)));
        return new Map([["0:p3", { src: "/files/roots.jpg", alt: "Roots" }]]);
      },
    });
    // The teacher's blank box is never searched or removed.
    expect(asked).toEqual(["Plant roots in soil", "A green leaf"]);
    expect(r).toMatchObject({ open: 2, placed: 1 });
    const p3 = r.slides[0]?.elements.find((e) => e.id === "p3") as { src: string; x: number };
    expect(p3).toMatchObject({ src: "/files/roots.jpg", x: 980 });
    expect(r.slides[1]?.elements.some((e) => e.id === "p4")).toBe(false);
    expect(r.slides[1]?.elements.some((e) => e.id === "t4")).toBe(true);
    expect(r.slides[2]?.elements.some((e) => e.id === "b5")).toBe(true);
    expect(hasOpenJobSlots(r.slides)).toBe(false);
  });

  test("with no search (a job stopping) every open slot is laid away; a failing search too", async () => {
    for (const search of [undefined, async () => Promise.reject(new Error("down"))]) {
      const r = await resolveOpenSlots(deck(), { theme, ...(search ? { search } : {}) });
      expect(hasOpenJobSlots(r.slides)).toBe(false);
      expect(r.slides.flatMap((s) => s.elements).filter(isOpenJobSlot)).toEqual([]);
    }
  });

  test("a deck with no open slot comes back as it is", async () => {
    const plain = [slide("s3", [text("t3", "Roots.")])];
    const r = await resolveOpenSlots(plain, { theme });
    expect(r.slides).toBe(plain);
  });
});

describe("healOpenSlots (a lesson whose worker died hard: the api heals it on read)", () => {
  const lessonWith = (slides: Slide[]) =>
    ({ id: "l1", themeId: "paper", ageBand: "primary", yearGroup: "Year 1", slides }) as never;

  test("an open job slot is laid away; the words stay", async () => {
    const { healOpenSlots } = await import("./heal-open-slots");
    const healed = await healOpenSlots(
      lessonWith([slide("s3", [text("t3", "Roots take in water."), frame("p3", "Roots")])]),
    );
    expect(healed).toBeDefined();
    const els = (healed as { slides: Slide[] }).slides[0]?.elements ?? [];
    expect(els.some((e) => e.id === "p3")).toBe(false);
    expect(els.some((e) => e.id === "t3")).toBe(true);
  });

  test("a lesson with no open slot (or only a teacher's blank box) is left alone", async () => {
    const { healOpenSlots } = await import("./heal-open-slots");
    expect(await healOpenSlots(lessonWith([slide("s3", [text("t3", "Roots.")])]))).toBeUndefined();
    expect(
      await healOpenSlots(lessonWith([slide("s5", [frame("b5", "Describe this image…")])])),
    ).toBeUndefined();
  });
});
