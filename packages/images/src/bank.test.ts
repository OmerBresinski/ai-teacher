import { describe, expect, test } from "bun:test";
import {
  bankLicenceOk,
  cosine,
  expectedImageCostUsd,
  familyOf,
  imageCostUsd,
  imagePrompt,
  pickReuse,
  REUSE_THRESHOLD,
  requestText,
  sizeForAspect,
} from "./bank";

describe("sizeForAspect (ruling 158 item 3)", () => {
  test.each([
    [960 / 540, "2048x1152", "landscape"],
    [16 / 9, "2048x1152", "landscape"],
    [1.5, "1536x1024", "landscape"],
    [1.25, "1536x1024", "landscape"],
    [363 / 378, "1024x1024", "square"],
    [480 / 540, "1024x1024", "square"],
    [1, "1024x1024", "square"],
    [2 / 3, "1024x1536", "portrait"],
    [0.75, "1024x1536", "portrait"],
  ])("aspect %p -> %s (%s)", (aspect, size, family) => {
    expect(sizeForAspect(aspect)).toEqual({ size, family } as never);
  });
  test("unknown or bad aspect is square", () => {
    expect(sizeForAspect(undefined).size).toBe("1024x1024");
    expect(sizeForAspect(Number.NaN).size).toBe("1024x1024");
    expect(sizeForAspect(0).size).toBe("1024x1024");
  });
  test("familyOf uses the same cut points", () => {
    expect(familyOf(1536, 1024)).toBe("landscape");
    expect(familyOf(1024, 1536)).toBe("portrait");
    expect(familyOf(650, 650)).toBe("square");
  });
});

describe("imagePrompt (ruling 158 items 4 and 5)", () => {
  const generic = imagePrompt({ text: "An adult brown hen beside a yellow chick" }, false);
  test("sets a UK context and British everyday things", () => {
    expect(generic).toContain("school in England");
    expect(generic).toMatch(/United Kingdom/);
    expect(generic).toMatch(/pounds/);
    expect(generic).toMatch(/electric kettle/);
  });
  test("asks for no text in the image", () => {
    expect(generic).toMatch(/No text anywhere in the image/);
    expect(generic).toMatch(/labels|signs/);
  });
  test("carries the whole request", () => {
    expect(generic).toContain("An adult brown hen beside a yellow chick");
  });
  test("generic prompts say nothing about faithfulness", () => {
    expect(generic).not.toMatch(/faithfully/);
  });
  test("a real thing must be shown faithfully, by name when named", () => {
    const real = imagePrompt({ text: "The north gate", named: "Housesteads Roman Fort" }, true);
    expect(real).toMatch(/faithfully/);
    expect(real).toMatch(/nothing invented/);
    expect(real).toContain("Housesteads Roman Fort");
    expect(real).toMatch(/No text anywhere/);
  });
});

describe("bankLicenceOk (ruling 139)", () => {
  test.each([
    ["Public domain", true],
    ["PD-old-70", true],
    ["CC0", true],
    ["CC BY 4.0", true],
    ["CC BY-SA 3.0", true],
    ["CC BY-SA 2.0 de", true],
    ["CC BY-NC 4.0", false],
    ["CC BY-ND 2.0", false],
    ["CC BY-NC-SA 3.0", false],
    ["GFDL", false],
    ["Fair use", false],
    ["", false],
  ])("commons %p -> %p", (licence, ok) => {
    expect(bankLicenceOk({ provider: "commons", licence })).toBe(ok);
  });
  test("Pexels and generated pictures are kept; unknown providers are not", () => {
    expect(bankLicenceOk({ provider: "pexels" })).toBe(true);
    expect(bankLicenceOk({ provider: "generated" })).toBe(true);
    expect(bankLicenceOk({ provider: "flickr", licence: "CC BY 2.0" })).toBe(false);
  });
});

describe("reuse", () => {
  const row = (similarity: number, family: "landscape" | "square" | "portrait", id: string) => ({
    similarity,
    family,
    row: { id },
  });
  test("reuses the most similar picture of the same family above the threshold", () => {
    const best = pickReuse(
      [row(0.95, "landscape", "wide"), row(0.9, "square", "sq"), row(0.85, "square", "sq2")],
      "square",
    );
    expect(best?.row.id).toBe("sq");
  });
  test("never reuses across families", () => {
    expect(pickReuse([row(0.99, "portrait", "p")], "square")).toBeUndefined();
  });
  test("below the threshold is a miss", () => {
    expect(pickReuse([row(REUSE_THRESHOLD - 0.01, "square", "x")], "square")).toBeUndefined();
    expect(pickReuse([row(REUSE_THRESHOLD, "square", "x")], "square")?.row.id).toBe("x");
  });
  test("cosine", () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
  test("requestText puts the name first when the request lacks it", () => {
    expect(requestText({ text: "the north gate ruins", named: "Housesteads" })).toBe(
      "Housesteads: the north gate ruins",
    );
    expect(requestText({ text: "Housesteads north gate", named: "Housesteads" })).toBe(
      "Housesteads north gate",
    );
  });
});

describe("cost", () => {
  test("1536x1024 low measured at 28 in + 158 out = $0.00488", () => {
    expect(imageCostUsd({ inputTokens: 28, outputTokens: 158 })).toBeCloseTo(0.00488, 5);
  });
  test("expected cost stays near half a cent", () => {
    expect(expectedImageCostUsd("1024x1024")).toBeLessThan(0.0065);
    expect(expectedImageCostUsd("2048x1152")).toBeLessThan(0.0055);
  });
});
