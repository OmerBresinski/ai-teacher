import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { DIAGRAM_KINDS } from "../plan-write/diagram-spec";
import { DIRECTOR_FIXTURES } from "../stages/picture-director.fixtures";
import {
  PICTURE_DIRECTOR_VERSION,
  PICTURE_ROUTES,
  type PictureDirectorInput,
  PictureDirectorSchema,
  pictureDirectorPrompt,
} from "./picture-director";

const input = DIRECTOR_FIXTURES[0]?.input as PictureDirectorInput;
const answer = {
  route: "pexels",
  pictures: [
    {
      shows: "An adult dog and its puppy",
      mustShow: ["adult dog", "puppy"],
      queries: ["dog and puppy"],
      imagePrompt: "A realistic photograph of an adult dog and its puppy on grass.",
    },
  ],
  count: null,
  diagram: null,
  named: null,
  period: null,
};

describe("picture director schema", () => {
  test("parses a full answer and refuses an unknown route or diagram kind", () => {
    expect(PictureDirectorSchema.parse(answer).route).toBe("pexels");
    expect(PictureDirectorSchema.safeParse({ ...answer, route: "stock" }).success).toBe(false);
    expect(PictureDirectorSchema.safeParse({ ...answer, diagram: "collage" }).success).toBe(false);
    const code = {
      route: "code",
      pictures: [],
      count: {
        things: "counters",
        total: 24,
        groups: 4,
        perGroup: 6,
        arrangement: "groups",
        empty: 0,
      },
      diagram: null,
      named: null,
      period: null,
    };
    expect(PictureDirectorSchema.parse(code).count?.total).toBe(24);
  });

  test("every object field is required, so a strict json_schema accepts it", () => {
    const walk = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      const n = node as {
        type?: unknown;
        properties?: Record<string, unknown>;
        required?: string[];
      };
      if (n.properties)
        expect([...(n.required ?? [])].sort()).toEqual(Object.keys(n.properties).sort());
      for (const v of Object.values(n)) if (typeof v === "object") walk(v);
    };
    walk(z.toJSONSchema(PictureDirectorSchema));
  });

  test("the routes are the five the bank knows; the diagram kinds come from the renderer", () => {
    expect([...PICTURE_ROUTES]).toEqual([
      "commons",
      "pexels",
      "library-or-generate",
      "code",
      "none",
    ]);
    const { system } = pictureDirectorPrompt(input);
    for (const r of PICTURE_ROUTES) expect(system).toContain(`- ${r}:`);
    for (const k of DIAGRAM_KINDS) expect(system).toContain(k);
    expect(PICTURE_DIRECTOR_VERSION).toMatch(/^picture-director\.v\d+$/);
  });
});

describe("picture director prompt", () => {
  test("names no example objects: no subject from any fixture or past failure appears in the system text", () => {
    const { system } = pictureDirectorPrompt(input);
    const banned =
      /\b(dog|puppy|cat|kitten|cow|sheep|lamb|hen|chick|kettle|plug|pound|coin|banknote|Big Ben|Union Jack|counter|flask|syringe|ice|ladybird|umbrella|cliff|Darwin|Tempest|apple)s?\b/i;
    expect(system.match(banned)).toBeNull();
  });

  test("the user turn carries the request, the slide, the lesson, the country and the zone", () => {
    const f = DIRECTOR_FIXTURES.find((x) => x.id === "y1-animals-s3")
      ?.input as PictureDirectorInput;
    const { user } = pictureDirectorPrompt(f);
    expect(user).toContain(f.request);
    expect(user).toContain("Slide heading: Dogs and cats");
    expect(user).toContain("taught in England");
    expect(user).toContain("Year 1 Science");
    expect(user).toContain("Picture zone: square, 0.89 wide to 1 high.");
    expect(pictureDirectorPrompt({ ...f, aspect: 1.78 }).user).toContain("landscape");
  });

  test("v8: the lesson's picture style is a user line, photo when the lesson has none", () => {
    expect(PICTURE_DIRECTOR_VERSION).toBe("picture-director.v10");
    expect(pictureDirectorPrompt(input).user).toContain("Picture style for this lesson: photo");
    expect(pictureDirectorPrompt({ ...input, style: "illustration" }).user).toContain(
      "Picture style for this lesson: illustration",
    );
  });

  test("v8: an illustration lesson's image prompt has no photographic words; fiction is not commons", () => {
    const { system } = pictureDirectorPrompt(input);
    expect(system).toContain("In a photo lesson it is one realistic photograph");
    expect(system).toContain("In an illustration lesson it describes only what is in the picture");
    expect(system).toContain(
      "or a fictional character or scene from a story, play or novel as it might be imagined or staged",
    );
    expect(system).toContain("anything real and named or dated");
  });
});

describe("who, where and when", () => {
  test("mustShow is what a camera records; the judge reads identity from the source's record", async () => {
    const { pickOrRequeryPrompt } = await import("./pick-or-requery-photo");
    expect(pictureDirectorPrompt(input).system).toContain("one to three things a camera records");
    expect(pickOrRequeryPrompt.system).toContain(
      "its source's own record (title, description, date)",
    );
  });
});

describe("director fixtures", () => {
  test("24 slots: the 9 smoke slots plus 15 that cover every route", () => {
    expect(DIRECTOR_FIXTURES).toHaveLength(27);
    expect(new Set(DIRECTOR_FIXTURES.map((f) => f.id)).size).toBe(27);
    const routes = new Set(DIRECTOR_FIXTURES.flatMap((f) => f.expect));
    for (const r of PICTURE_ROUTES) expect(routes.has(r)).toBe(true);
    for (const f of DIRECTOR_FIXTURES) {
      expect(f.expect.length).toBeGreaterThan(0);
      expect(f.input.request.length).toBeGreaterThan(10);
    }
  });
});
