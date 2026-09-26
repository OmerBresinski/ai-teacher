import { describe, expect, test } from "bun:test";
import { materialiseSlide, type SlideSpec } from "@tj/slides";
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
    });
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
