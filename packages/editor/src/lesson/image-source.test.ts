import { describe, expect, test } from "bun:test";
import { type ImageSource, imageFields, sourceFromPicked } from "./image-source";

const source = {
  provider: "pexels",
  id: "12345",
  pageUrl: "https://www.pexels.com/photo/12345/",
  photographer: "Ada",
  photographerUrl: "https://www.pexels.com/@ada",
} as const;

describe("sourceFromPicked", () => {
  test("builds our URL, the aspect and the provenance", () => {
    expect(
      sourceFromPicked({ url: "/files/k", width: 6000, height: 4000, source }, "A river"),
    ).toEqual({
      src: "/files/k",
      natural: { w: 6000, h: 4000 },
      alt: "A river",
      source,
    });
  });
});

describe("imageFields", () => {
  test("copies source when present", () => {
    const fields = imageFields({ src: "s", natural: { w: 1, h: 1 }, source });
    expect(fields.source).toEqual(source);
    expect(fields).not.toHaveProperty("credit");
  });

  test("omits absent keys", () => {
    const fields = imageFields({ src: "s", natural: { w: 1, h: 1 } } as ImageSource);
    expect(fields).toEqual({ src: "s" });
  });
});
