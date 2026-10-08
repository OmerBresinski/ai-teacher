import { describe, expect, it } from "bun:test";
import type { ImageElement, Lesson } from "@tj/domain/documents";
import { lesson as baseLesson, creditedLesson, imageElement } from "@tj/domain/documents/fixtures";
import {
  creditSegments,
  GENERATED_CREDIT,
  IMAGE_CREDITS_TITLE,
  imageCredits,
  isCropped,
  photoCredit,
} from "./credits";

/* TEACH-161 rows 1–3: the credits list the three lesson exporters share. */

const deck = (...images: ImageElement[]): Lesson => ({
  ...baseLesson(),
  slides: [{ id: "s1", kind: "content", elements: images }],
});

describe("imageCredits", () => {
  it("row 1: lists each credited picture once, in deck order, through groups", () => {
    expect(imageCredits(creditedLesson())).toEqual([
      {
        key: "pexels:1001",
        text: "Photo by Ada on Pexels",
        links: [
          { label: "Ada", href: "https://www.pexels.com/@ada" },
          { label: "Pexels", href: "https://www.pexels.com/photo/1001/" },
        ],
      },
      {
        key: "pexels:1002",
        text: "Photo by Bob on Pexels",
        links: [
          { label: "Bob", href: "https://www.pexels.com/@bob" },
          { label: "Pexels", href: "https://www.pexels.com/photo/1002/" },
        ],
      },
      {
        key: "credit:Sky by Cy, CC BY 2.0",
        text: "Sky by Cy, CC BY 2.0",
        links: [{ label: "View the original", href: "https://openverse.org/x" }],
      },
    ]);
  });

  it("row 2: drops an address the link gate refuses", () => {
    // Built by hand: the schema would refuse both, but an imported file never met it.
    const hostile = deck(
      imageElement("x", { credit: "Cat by Kit", creditUrl: "javascript:alert(1)" }),
      imageElement("y", {
        source: {
          provider: "pexels",
          id: "9",
          pageUrl: "https://www.pexels.com/photo/9/",
          photographer: "Eve",
          photographerUrl: "javascript:alert(1)",
        },
      }),
    );
    const [openverse, photo] = imageCredits(hostile);
    expect(openverse).toEqual({ key: "credit:Cat by Kit", text: "Cat by Kit", links: [] });
    expect(photo).toEqual({
      key: "pexels:9",
      text: "Photo by Eve on Pexels",
      links: [{ label: "Pexels", href: "https://www.pexels.com/photo/9/" }],
    });
  });

  it("row 3: a lesson with no credited picture has no credits", () => {
    expect(imageCredits(baseLesson())).toEqual([]);
    expect(imageCredits(deck(imageElement("d")))).toEqual([]);
  });

  it("limits the walk to a range of slides, in deck order", () => {
    const credited = creditedLesson();
    expect(imageCredits(credited, [1, 0]).map((c) => c.text)).toEqual([
      "Photo by Ada on Pexels",
      "Photo by Bob on Pexels",
    ]);
    expect(imageCredits(credited, [2, 3]).map((c) => c.text)).toEqual(["Sky by Cy, CC BY 2.0"]);
    expect(imageCredits(credited, [3])).toEqual([]);
  });

  it("is titled in British English", () => {
    expect(IMAGE_CREDITS_TITLE).toBe("Image credits");
  });
});

describe("creditSegments", () => {
  it("links the photographer and Pexels in place, as the credit badge does", () => {
    const [ada, , sky] = imageCredits(creditedLesson());
    if (!ada || !sky) throw new Error("fixture");
    expect(creditSegments(ada)).toEqual([
      { text: "Photo by " },
      { text: "Ada", href: "https://www.pexels.com/@ada" },
      { text: " on " },
      { text: "Pexels", href: "https://www.pexels.com/photo/1001/" },
    ]);
    expect(creditSegments(sky)).toEqual([
      { text: "Sky by Cy, CC BY 2.0" },
      { text: " · " },
      { text: "View the original", href: "https://openverse.org/x" },
    ]);
  });

  it("is the plain text when no address survived the gate", () => {
    expect(creditSegments({ key: "k", text: "Cat by Kit", links: [] })).toEqual([
      { text: "Cat by Kit" },
    ]);
  });
});

/* TEACH-251 part b: Commons and generated credits, "cropped" for an attribution licence. */
describe("photoCredit and Commons in the credits list", () => {
  const commons = (licence: string) =>
    ({
      provider: "commons",
      id: "commons-1004",
      pageUrl: "https://commons.wikimedia.org/wiki/File:Hadrian%27s_Wall_at_Greenhead.jpg",
      photographer: "Ada Lovelace",
      photographerUrl: "https://commons.wikimedia.org/wiki/User:Ada",
      author: "Ada Lovelace",
      licence,
      licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Hadrian%27s_Wall_at_Greenhead.jpg",
    }) as const;

  it("a Commons photo credits as title, author, licence, linking the file page and the deed", () => {
    expect(photoCredit(commons("CC BY-SA 4.0"))).toEqual({
      key: "commons:commons-1004",
      text: "Hadrian's Wall at Greenhead, Ada Lovelace, CC BY-SA 4.0",
      links: [
        {
          label: "Hadrian's Wall at Greenhead",
          href: "https://commons.wikimedia.org/wiki/File:Hadrian%27s_Wall_at_Greenhead.jpg",
        },
        { label: "CC BY-SA 4.0", href: "https://creativecommons.org/licenses/by-sa/4.0" },
      ],
    });
  });

  it("a cropped CC BY or BY-SA photo says cropped; public domain does not need to", () => {
    expect(photoCredit(commons("CC BY 4.0"), { cropped: true }).text).toBe(
      "Hadrian's Wall at Greenhead, Ada Lovelace, CC BY 4.0, cropped",
    );
    expect(photoCredit(commons("Public domain"), { cropped: true }).text).not.toContain("cropped");
  });

  it("a Fill (cover) picture counts as cropped; a whole (contain) one does not", () => {
    expect(isCropped({ fit: "cover" })).toBe(true);
    expect(isCropped({ fit: "contain" })).toBe(false);
    expect(isCropped({ fit: "contain", crop: { x: 0, y: 0, w: 1, h: 1 } })).toBe(true);
  });

  it("the deck's credits list Commons (cropped when filled) and generated pictures", () => {
    const list = imageCredits(
      deck(
        imageElement("a", { fit: "cover", source: commons("CC BY-SA 4.0") }),
        imageElement("b", {
          fit: "contain",
          source: {
            provider: "generated",
            id: "0b0b0000-0000-4000-8000-00000000ba4c",
            pageUrl: "https://dayback.app",
            photographer: "",
            photographerUrl: "https://dayback.app",
          },
        }),
      ),
    );
    expect(list.map((c) => c.text)).toEqual([
      "Hadrian's Wall at Greenhead, Ada Lovelace, CC BY-SA 4.0, cropped",
      GENERATED_CREDIT,
    ]);
    // The PDF and PPTX runs link the title and the licence in place.
    expect(
      creditSegments(list[0] as never)
        .filter((s) => s.href)
        .map((s) => s.text),
    ).toEqual(["Hadrian's Wall at Greenhead", "CC BY-SA 4.0"]);
  });

  it("an imported Commons source with a refused address keeps its text, without the link", () => {
    const bad = {
      ...commons("CC BY 4.0"),
      sourceUrl: "javascript:alert(1)",
      pageUrl: "javascript:x",
    };
    const c = photoCredit(bad);
    expect(c.links.some((l) => l.href.startsWith("javascript"))).toBe(false);
  });

  it("a picture cropped on any slide is credited as cropped, in its first place", () => {
    const list = imageCredits(
      deck(
        imageElement("a", { fit: "contain", source: commons("CC BY 4.0") }),
        imageElement("b", { fit: "contain", source: commons("CC BY 4.0") }),
        imageElement("c", { fit: "cover", source: commons("CC BY 4.0") }),
      ),
    );
    expect(list).toHaveLength(1);
    expect(list[0]?.text).toBe("Hadrian's Wall at Greenhead, Ada Lovelace, CC BY 4.0, cropped");
  });
});
