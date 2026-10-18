import { describe, expect, test } from "bun:test";
import type { Slide, TextElement } from "@tj/domain/documents";
import { groundArt } from "../art";
import { footStrip } from "../background";
import { withTitleBand } from "../templates/title-band";
import { getTheme } from "../themes";
import { CONNECTORS, connectorShape } from "./marks";
import { markLook, surfaceStyle, surfacesOf } from "./surfaces";

/*
 * TEACH-215 part k: the shape families of Poster, Scrapbook, Calm and Storytime from their golds
 * (round 2 themes2.css with round 4 themes4.css on top), the foot accent strip (round 3 themes3.css
 * `.footbar`), the heading's title-accent word and the quick check's solid answer column.
 */

const marks = (id: string) => surfacesOf(getTheme(id)).marks;

describe("shape families from each gold", () => {
  test("poster: outline keys, tile medals, square chips, offset cards", () => {
    expect(marks("poster")).toMatchObject({
      title: "none",
      badge: "disc",
      key: "outline",
      medal: "tile",
      chip: "square",
      card: "offset",
      frame: "offset",
      ground: "none",
      connector: "block-offset",
    });
    expect(marks("poster").offset).toEqual({ d: 5.33, color: "#1B1B2F" });
  });
  test("scrapbook: outline badges, sticky keys, tag chips, dashed rule, torn fields, lined ground", () => {
    expect(marks("scrapbook")).toMatchObject({
      title: "none",
      badge: "outline",
      key: "sticky",
      chip: "tag",
      card: "plain",
      rule: "dashed",
      frame: "polaroid",
      field: "torn",
      ground: "lined",
      connector: "sketch",
    });
    expect(marks("scrapbook").sticky).toEqual({ fill: "#FFE45C", tilt: -3 });
  });
  test("calm: rounded badges, outline keys and chips, outline cards", () => {
    expect(marks("calm")).toMatchObject({
      badge: "rounded",
      key: "outline",
      chip: "outline",
      card: "outline",
      medal: "disc",
      ground: "none",
    });
  });
  test("storytime: outline cards and the round connector", () => {
    expect(marks("storytime")).toMatchObject({
      card: "outline",
      connector: "round",
      badge: "disc",
    });
  });
  test("geometric keeps its own families", () => {
    expect(marks("geometric")).toMatchObject({
      badge: "hex",
      key: "notch",
      card: "outline",
      ground: "dots",
      connector: "block",
      footBar: 0,
    });
  });
});

describe("hinge keys in each family (hinge lane's request)", () => {
  test("storytime and calm keys wear the theme colour; poster's the ink; scrapbook's the sticky paper", () => {
    expect(marks("storytime").keyFill).toBe("accent");
    expect(marks("calm").keyFill).toBe("accent");
    expect(marks("poster").keyFill).toBe("ink");
    const calm = getTheme("calm");
    const s = surfacesOf(calm);
    // An outline key asked for in its role's (clear) fill draws its ring in the theme's teal.
    expect(markLook(calm, "key", 30, s.roles.key.fill, "#FFFFFF")).toMatchObject({
      fill: "transparent",
      stroke: "#245150",
      ink: "#245150",
    });
    expect(markLook(getTheme("scrapbook"), "key", 30, "#23201C", "#FFFFFF")).toMatchObject({
      fill: "#FFE45C",
      rotation: -3,
    });
  });
});

describe("connector shapes", () => {
  for (const kind of CONNECTORS)
    test(`${kind} stays inside its box`, () => {
      const s = connectorShape(kind, 40, 30);
      const pts = [...s.fills.flatMap((f) => f.pts), ...s.strokes.flat()];
      expect(pts.length).toBeGreaterThan(0);
      for (const p of pts) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(40);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(30);
      }
    });
  test("the sketch's chevron tip is the shaft's end", () => {
    const s = connectorShape("sketch", 60, 40);
    const [shaft, head] = s.strokes;
    expect(head?.[1]).toEqual(shaft?.[shaft.length - 1]);
    // the gold's stroke: max(5, round(h * 1.5 * .12)) px, in points
    expect(s.width).toBeCloseTo(7 / 1.5, 3);
  });
});

describe("foot accent strip", () => {
  const slide = (kind: Slide["kind"], names: string[] = []): Slide =>
    ({
      id: "s",
      kind,
      elements: names.map((name, i) => ({
        id: `e${i}`,
        type: "shape",
        shape: "rect",
        name,
        x: 0,
        y: 0,
        w: 1,
        h: 1,
      })),
    }) as Slide;
  const ON = [
    "treehouse",
    "reading-room",
    "crayon",
    "exam-hall",
    "playground",
    "splash",
    "studio",
    "dark-slate",
    "dark-ember",
    "beacon",
  ];
  test("the ten themes whose gold has it paint 14px at 1440 in the accent", () => {
    for (const id of ON) {
      const t = getTheme(id);
      const s = footStrip(t, slide("content"));
      expect(s).toEqual({ x: 0, y: 540 - 9.3333, w: 960, h: 9.3333, fill: t.colors.accent });
    }
  });
  test("none on the cover, none in the other themes, none over the look's own accent bar", () => {
    expect(footStrip(getTheme("treehouse"), slide("title"))).toBeNull();
    expect(footStrip(getTheme("treehouse"), slide("content", ["Accent bar"]))).toBeNull();
    for (const id of ["paper", "poster", "storytime", "scrapbook", "calm", "geometric"])
      expect(footStrip(getTheme(id), slide("content"))).toBeNull();
  });
});

describe("grounds", () => {
  test("scrapbook's lined paper is a ground layer; geometric keeps its dots", () => {
    const lined = groundArt(getTheme("scrapbook"));
    expect(lined?.image).toContain(encodeURIComponent("#F1B9B4"));
    expect(lined).toMatchObject({ x: 0, y: 0, w: 960, h: 540 });
    expect(groundArt(getTheme("geometric"))).not.toBeNull();
    expect(groundArt(getTheme("calm"))).toBeNull();
  });
});

describe("title accent and the quick check's answer column", () => {
  const heading = (color: string): TextElement =>
    ({
      id: "h",
      type: "text",
      name: "Heading",
      x: 64,
      y: 40,
      w: 800,
      h: 50,
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "magnetic", marks: [{ type: "textStyle", attrs: { color } }] },
            ],
          },
        ],
      },
    }) as unknown as TextElement;
  const colourOf = (e: TextElement) =>
    JSON.stringify(e.doc).match(/"color":"(#[0-9A-Fa-f]{6})"/)?.[1];
  test("treehouse's accent word takes its title-accent; geometric's is unchanged", () => {
    const tree = getTheme("treehouse");
    const out = withTitleBand([heading(tree.colors.accent)], tree, "content");
    expect(colourOf(out[0] as TextElement)).toBe("#8A4B12");
    const geo = getTheme("geometric");
    expect(
      colourOf(withTitleBand([heading(geo.colors.accent)], geo, "content")[0] as TextElement),
    ).toBe(geo.colors.accent);
  });
  test("the cover's title is left to the cover", () => {
    const tree = getTheme("treehouse");
    const out = withTitleBand([heading(tree.colors.accent)], tree, "title");
    expect(colourOf(out[0] as TextElement)).toBe(tree.colors.accent);
  });
  test("beacon and poster set a solid answer column; others have none", () => {
    expect(surfaceStyle(getTheme("beacon"), "field-b", "inverse")).toMatchObject({
      fill: "#0A46C8",
      ink: "#FFFFFF",
    });
    expect(surfaceStyle(getTheme("poster"), "field-b", "inverse")).toMatchObject({
      fill: "#123C4A",
      ink: "#FFF4E2",
    });
    expect(surfacesOf(getTheme("paper")).states["field-b:inverse"]).toBeUndefined();
  });
});
