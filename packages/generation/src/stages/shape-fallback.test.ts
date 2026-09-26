import { describe, expect, test } from "bun:test";
import type { Slide } from "@tj/domain/documents";
import { materialiseSlide, materialiseSlides, type SlideSpec } from "@tj/slides";
import type { PipelineDeps } from "../types";
import { logShapeFallback, photoStructure } from "./shared";

const meta = { promptVersion: "t", model: "m", at: "2026-09-26T00:00:00.000Z" };
const long = (n: number) =>
  Array.from({ length: n }, (_, i) => `word${i} photosynthesis chlorophyll`).join(" ");

describe("a shape the slide could not place is a metric, not a retry", () => {
  test("logged once by shape; a placed shape logs nothing", () => {
    const lines: [unknown, string][] = [];
    const logger = {
      info: (o: unknown, m: string) => lines.push([o, m]),
    } as unknown as PipelineDeps["logger"];
    const fits: SlideSpec = {
      kind: "content",
      factRefs: [],
      heading: "The water cycle",
      body: "Water moves in a loop.",
      steps: ["Evaporation", "Condensation", "Precipitation", "Collection"],
    };
    expect(
      logShapeFallback(logger, "generate", 3, fits, materialiseSlide(fits, "chalk", meta)),
    ).toBe(undefined);
    const over = { ...fits, steps: [long(4), long(4), long(4), long(4)] };
    expect(logShapeFallback(logger, "repair", 5, over, materialiseSlide(over, "chalk", meta))).toBe(
      "sequence",
    );
    expect(lines).toEqual([
      [
        { stage: "repair", metric: "shape-fallback", shape: "sequence", index: 5 },
        "shape fallback",
      ],
    ]);
  });
});

describe("a content slide's photo brief (look/image-slot)", () => {
  const lines: [unknown, string][] = [];
  const logger = {
    info: (o: unknown, m: string) => lines.push([o, m]),
  } as unknown as PipelineDeps["logger"];
  const entry = {
    id: "s4",
    kind: "content" as const,
    factRefs: [],
    imageBrief: { subject: "Roman fort", mustShow: ["gate"], purpose: "context" as const },
  };
  const explain: SlideSpec = { kind: "content", factRefs: [], heading: "Forts", body: "A fort." };

  test("an explain or a list takes it as the photo hint", () => {
    expect(photoStructure(entry, explain, logger, "generate", 3)).toEqual({
      photo: { subject: "Roman fort", mustShow: ["gate"] },
      slotSide: "left",
    });
    // Photo slides alternate sides: the second photo entry of the lesson takes the right.
    const outline = [entry, { ...entry }, entry];
    expect(photoStructure(outline[1], explain, logger, "generate", 3, outline).slotSide).toBe(
      "right",
    );
    expect(
      photoStructure({ ...entry, imageBrief: undefined }, explain, logger, "generate", 3),
    ).toEqual({});
    expect(lines).toHaveLength(0);
  });

  test("a compare or a sequence drops it, with a log line", () => {
    const steps: SlideSpec = { ...explain, steps: ["Dig a ditch", "Build a wall"] };
    expect(photoStructure(entry, steps, logger, "repair", 3)).toEqual({});
    expect(lines[0]?.[0]).toMatchObject({ metric: "photo-dropped", shape: "sequence", index: 3 });
  });
});

describe("a repaired slide replaces its old continuations (look/image-slot)", () => {
  test("the continuations after the rewritten slide go; the next slide stays", async () => {
    const { withoutOldContinuations } = await import("./repair");
    const s = (id: string, heading: string): Slide =>
      ({
        id,
        kind: "content",
        elements: [
          {
            id: `${id}h`,
            type: "text",
            x: 0,
            y: 0,
            w: 10,
            h: 10,
            name: "Heading",
            doc: {
              type: "doc",
              content: [{ type: "paragraph", content: [{ type: "text", text: heading }] }],
            },
            style: { preset: "heading" },
          },
        ],
      }) as Slide;
    const deck = [
      s("a", "Why"),
      s("b", "Why (continued)"),
      s("c", "Why (continued)"),
      s("d", "Roads"),
      s("e", "Roads (continued)"),
    ];
    expect(withoutOldContinuations(deck, "a").map((x) => x.id)).toEqual(["a", "d", "e"]);
    expect(withoutOldContinuations(deck, "d").map((x) => x.id)).toEqual(["a", "b", "c", "d"]);
  });
});

test("a slide keeps room for a photo in a repair only where it still has a slot", async () => {
  const { hasPhotoSlot } = await import("./repair");
  const withSlot = materialiseSlides(
    {
      kind: "content",
      factRefs: [],
      heading: "Forts",
      body: "A fort was a base. Soldiers lived there.",
    },
    "chalk",
    meta,
    undefined,
    0,
    { photo: { subject: "Roman fort" } },
  )[0] as Slide;
  const without = materialiseSlide(
    { kind: "content", factRefs: [], heading: "Forts", body: "A fort was a base." },
    "chalk",
    meta,
  );
  expect(hasPhotoSlot(withSlot)).toBe(true);
  expect(hasPhotoSlot(without)).toBe(false);
});
