import { describe, expect, test } from "bun:test";
import { getTheme } from "@tj/slides/themes";
import { codeObjectives, coverFigure } from "./materialise";

// Lane OBJ: slide 2 can take a look, and the "picture" look uses the title slide's own photo.
const brief = { topic: "Volcanoes", yearGroup: "Year 8", subject: "Geography" };
const theme = getTheme("paper", "ks3");
const base = { brief, theme, stage: "ks3" as const, index: 1 };
const plan = {
  slides: [],
  objectives: [
    { teacher: "a", pupil: "Identify magma, lava, the vent and the crater" },
    { teacher: "b", pupil: "Explain how volcanoes form at plate boundaries" },
    { teacher: "c", pupil: "Compare shield and composite volcanoes" },
  ],
};
const title = {
  elements: [
    { type: "image", name: "Photo", src: "/files/cover.jpg", alt: "A volcano", w: 444, h: 296 },
  ],
};

describe("objectives look (lane OBJ)", () => {
  test("coverFigure reads the title's placed photo, never a placeholder", () => {
    expect(coverFigure(title)).toEqual({
      photo: "/files/cover.jpg",
      alt: "A volcano",
      aspect: 1.5,
    });
    expect(
      coverFigure({ elements: [{ ...title.elements[0], src: "data:image/svg+xml;utf8,x" }] }),
    ).toBeUndefined();
    expect(coverFigure(undefined)).toBeUndefined();
  });

  test("the picture look draws the cover beside verb-led objectives", () => {
    const m = codeObjectives({ ...base, plan } as never, {
      look: "picture",
      cover: coverFigure(title),
    });
    const photo = m.slide.elements.find((e) => e.type === "image") as { src?: string } | undefined;
    expect(photo?.src).toBe("/files/cover.jpg");
    expect(m.slide.elements.every((e) => (e as { authoredBy?: string }).authoredBy === "ai")).toBe(
      true,
    );
  });

  test("no look: slide 2 is the numbered list, as before", () => {
    const m = codeObjectives({ ...base, plan } as never);
    expect(m.slide.elements.some((e) => e.type === "image")).toBe(false);
    expect(m.slide.elements.some((e) => e.name === "Verb")).toBe(false);
  });
});
