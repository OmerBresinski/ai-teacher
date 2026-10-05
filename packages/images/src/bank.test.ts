import { describe, expect, test } from "bun:test";
import {
  bankLicenceOk,
  cosine,
  expectedImageCostUsd,
  familyOf,
  imageCostUsd,
  imagePrompt,
  numbersAgree,
  numbersIn,
  oneScene,
  pickReuse,
  REUSE_THRESHOLD,
  requestText,
  sizeForAspect,
} from "./bank";
import { countArrayOf, countArraySvg } from "./count-array";

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
  test("no blanket locale and no example objects (PHOTO-BANK round 2)", () => {
    expect(generic).not.toMatch(/United Kingdom|England|British|kettle|plug|pounds|landmark/i);
  });
  test("one subject filling the frame, one image, nothing unasked", () => {
    expect(generic).toMatch(/fills the frame/);
    expect(generic).toMatch(/not a collage, grid or set of panels/);
    expect(generic).toMatch(/no people, animals or objects the request does not name/);
  });
  test("locale only where the subject involves it, never landmarks", () => {
    const money = imagePrompt({ text: "A purse with coins and a note" }, false);
    expect(money).toMatch(/pounds and pence/);
    expect(money).toMatch(/No landmarks, flags or national symbols/);
    expect(money).not.toMatch(/plug|uniform/);
    const lab = imagePrompt({ text: "School chemistry experiment with a conical flask" }, false);
    expect(lab).not.toMatch(/uniform|pupils/);
  });
  test("a collage request becomes one scene", () => {
    expect(
      oneScene(
        "A two-panel photographic collage: an adult dog beside a puppy on the left; an adult cat beside a kitten on the right. All animals are clearly visible.",
      ),
    ).toBe(
      "An adult dog beside a puppy and an adult cat beside a kitten, together in one scene. All animals are clearly visible.",
    );
    expect(oneScene("An ice cube beside a glass of water")).toBe(
      "An ice cube beside a glass of water",
    );
  });
  test("a real thing is set in the lesson's time and place", () => {
    const p = imagePrompt(
      {
        text: "German children with bundles of banknotes in 1923",
        context: {
          title: "Weimar Germany: hyperinflation",
          yearGroup: "Year 9",
          subject: "History",
        },
      },
      true,
    );
    expect(p).toContain("For a lesson on Weimar Germany: hyperinflation, Year 9 History.");
    expect(p).toMatch(/time and place/);
    expect(p).not.toMatch(/pounds|uniform/);
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
    expect(real).toMatch(/No added captions, labels or watermarks/);
    expect(real).not.toMatch(/No text anywhere/);
    // A real thing is shown where and when it is: no UK setting forced onto 1923 Germany.
    expect(real).not.toMatch(/United Kingdom/);
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

describe("numbersAgree (reuse guard)", () => {
  test("digits and words are the same numbers", () => {
    expect(numbersIn("Twenty-four counters in four groups of six")).toEqual([4, 6, 24]);
    expect(
      numbersAgree(
        "24 identical counters arranged in four equal groups of six",
        "Twenty-four counters in four groups of six on a school desk",
      ),
    ).toBe(true);
  });
  test("different numbers never share a picture", () => {
    expect(
      numbersAgree("24 counters in four groups of six", "12 counters in three groups of four"),
    ).toBe(false);
    expect(numbersAgree("banknotes in 1923", "banknotes in 1922")).toBe(false);
  });
  test("no numbers on either side agree", () => {
    expect(numbersAgree("a hen beside a chick", "a hen next to her chick")).toBe(true);
  });
});

describe("countArrayOf and countArraySvg (PHOTO-BANK round 2)", () => {
  test("reads a total and equal groups", () => {
    expect(
      countArrayOf("24 identical counters arranged in four equal groups of six on a table"),
    ).toEqual({
      total: 24,
      groups: 4,
      perGroup: 6,
      arrangement: "groups",
    });
    expect(countArrayOf("Twelve red counters in 3 rows of 4")?.arrangement).toBe("rows");
    expect(countArrayOf("Fifteen counters")).toEqual({
      total: 15,
      groups: 1,
      perGroup: 15,
      arrangement: "groups",
    });
  });
  test("a total that disagrees with its groups, or no countable thing, is not drawn", () => {
    expect(countArrayOf("20 counters in four groups of six")).toBeUndefined();
    expect(countArrayOf("An adult dog and its puppy")).toBeUndefined();
    expect(countArrayOf("A sheep with four legs and two ears")).toBeUndefined();
  });
  test("draws exactly the asked number", () => {
    const svg = countArraySvg({ total: 24, groups: 4, perGroup: 6, arrangement: "groups" }, 1.6);
    expect(svg.match(/<circle/g)?.length).toBe(48); // body + inner ring per counter
    expect(svg.match(/<rect/g)?.length).toBe(5); // background + 4 group plates
  });
});

describe("directedImagePrompt", () => {
  test("the director's prompt, then the frame and text lines code owns", async () => {
    const { directedImagePrompt } = await import("./bank");
    const generic = directedImagePrompt("  A sheep and its lamb grazing.\n", false).split("\n");
    expect(generic).toEqual([
      "A sheep and its lamb grazing.",
      "A single image, not a collage, grid or set of panels.",
      "No text anywhere in the image: no words, letters, labels, signs, captions or numbers.",
    ]);
    expect(directedImagePrompt("A 1923 street.", true)).toContain(
      "No added captions, labels or watermarks.",
    );
  });
});
