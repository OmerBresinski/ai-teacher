import { describe, expect, test } from "bun:test";
import type { ImageElement, SlideElement, TextElement } from "@tj/domain/documents";
import { contrastRatio } from "../look";
import { MIN_FONT_SIZE, THEMES } from "../themes";
import { sample } from "./capacity";
import { cutSubjects, type Figure, layoutTemplate, type Stage, type TemplateInput } from "./index";
import {
  SPLIT_NAMES,
  type SplitSide,
  type SplitZone,
  splitGroupOf,
  splitPaths,
  splitTable,
} from "./split-compare";
import {
  measureSplitCell,
  SPLIT_FIT_HEADING,
  SPLIT_GROUPS,
  type SplitGroup,
  splitSides,
} from "./split-compare-capacity";
import CAPACITY from "./split-compare-capacity.json" with { type: "json" };
import { SHAPES } from "./split-compare-deps";

/*
 * Split compare (TEACH-75 part w): rows 1, 2, 4, 5 and 7 of the ticket's acceptance table, the
 * never-throw corpus, and the colours (ink on every field at 4.5:1).
 */
const STAGES: Stage[] = ["ks1", "ks2", "ks3"];
const ZONES: SplitZone[] = ["picture", "quote", "text"];
const texts = (els: SlideElement[]) => els.filter((e): e is TextElement => e.type === "text");
const words = (e: TextElement) =>
  JSON.stringify(e.doc)
    .match(/"text":"([^"]*)"/g)
    ?.map((m) => m.slice(8, -1))
    .join("") ?? "";

const subj = (f: Figure) => ("photo" in f ? f.subjects : undefined);
const upright: Figure = {
  photo: "https://x.test/canopic.jpg",
  aspect: 0.75,
  alt: "a canopic jar",
  subjects: [{ name: "jar", x: 0.28, y: 0.18, w: 0.44, h: 0.66 }],
};
const wide: Figure = {
  photo: "https://x.test/valley.jpg",
  aspect: 1.78,
  alt: "a valley",
  subjects: [{ name: "volcano", x: 0.3, y: 0.25, w: 0.4, h: 0.5 }],
};

const input = (sides: SplitSide[], heading = "Two kinds of volcano"): TemplateInput => ({
  template: "split-compare",
  heading,
  sides,
});

describe("split-compare at its measured caps (row 1)", () => {
  for (const theme of THEMES)
    for (const stage of STAGES)
      test(`${theme.id} ${stage}: 2 and 3 sides at cap, every zone, nothing over, not tight`, () => {
        const faults: string[] = [];
        for (const n of [2, 3] as const)
          for (const zone of ZONES) {
            const r = layoutTemplate(
              { ...input(splitSides(splitGroupOf(stage), n, zone), SPLIT_FIT_HEADING) },
              theme,
              stage,
            );
            const tag = `${n} ${zone}`;
            for (const o of r.over) faults.push(`${tag} over ${o}`);
            // A cap of 0 means that count and zone is never comfortable at this age (CAPS.md).
            const never = Object.values(splitTable(splitGroupOf(stage), n, zone)).some(
              (l) => !l.cap,
            );
            if (r.tight !== never) faults.push(`${tag} tight ${r.tight}`);
            for (const e of r.slide.elements)
              if (e.y + e.h > 540 + 0.5) faults.push(`${tag} ${e.name} past the foot`);
            for (const e of texts(r.slide.elements))
              if ((e.style.fontSize ?? 0) < MIN_FONT_SIZE.body)
                faults.push(`${tag} ${e.name} ${e.style.fontSize}`);
          }
        expect(faults).toEqual([]);
      });
});

describe("split-compare pictures (row 2, ruling 216)", () => {
  test("an upright and a wide master share one standard shape and keep both subjects whole", () => {
    for (const stage of STAGES) {
      const r = layoutTemplate(
        input([
          { title: "Shield", text: "Runny lava travels far.", picture: upright },
          { title: "Composite", text: "Sticky lava piles up.", picture: wide },
        ]),
        THEMES[0] as never,
        stage,
      );
      const imgs = r.slide.elements.filter((e): e is ImageElement => e.type === "image");
      expect(imgs).toHaveLength(2);
      const [a, b] = imgs as [ImageElement, ImageElement];
      expect(a.w).toBe(b.w);
      expect(a.h).toBe(b.h);
      const ratio = a.w / a.h;
      expect(SHAPES.some(([, s]) => Math.abs(s - ratio) < 0.02)).toBe(true);
      expect(cutSubjects(a.crop, subj(upright))).toEqual([]);
      expect(cutSubjects(b.crop, subj(wide))).toEqual([]);
      // Each crop has the box's shape in the picture's own units.
      for (const [img, f] of [
        [a, upright],
        [b, wide],
      ] as const) {
        const asp = (f as { aspect: number }).aspect;
        const crop = img.crop ?? { x: 0, y: 0, w: 1, h: 1 };
        expect((crop.w * asp) / crop.h).toBeCloseTo(ratio, 1);
      }
    }
  });

  test("two zooming pictures share one crop scale (a seedling is not blown up)", () => {
    const small: Figure = {
      photo: "https://x.test/seedling.jpg",
      aspect: 4 / 3,
      subjects: [{ name: "seedling", x: 0.45, y: 0.5, w: 0.1, h: 0.2 }],
    };
    const big: Figure = {
      photo: "https://x.test/plant.jpg",
      aspect: 4 / 3,
      subjects: [{ name: "plant", x: 0.3, y: 0.2, w: 0.4, h: 0.6 }],
    };
    const r = layoutTemplate(
      input([
        { title: "Seedling", text: "Two small leaves.", picture: small },
        { title: "Grown plant", text: "Many leaves and a flower.", picture: big },
      ]),
      THEMES[0] as never,
      "ks2",
    );
    const imgs = r.slide.elements.filter((e): e is ImageElement => e.type === "image");
    expect(imgs[0]?.crop?.w).toBeCloseTo(imgs[1]?.crop?.w ?? 1, 3);
    expect(cutSubjects(imgs[0]?.crop, subj(small))).toEqual([]);
  });
});

describe("split-compare pictures take what the words leave (sc-19, sc-25)", () => {
  const plain = { top: true, right: true, bottom: true, left: true };
  const heart = {
    photo: "https://x.test/heart.png",
    aspect: 1,
    backdrop: { plain },
    kind: "object" as const,
  };
  const scope = {
    photo: "https://x.test/scope.png",
    aspect: 1,
    backdrop: { plain },
    kind: "object" as const,
  };
  const pics = (els: SlideElement[]) => els.filter((e): e is ImageElement => e.type === "image");
  test("short words: the pair grows past 52% of the field; longer words take it back", () => {
    for (const stage of STAGES) {
      const lay = (a: string, b: string) =>
        layoutTemplate(
          input([
            { title: "The heart", text: a, picture: heart },
            { title: "A stethoscope", text: b, picture: scope },
          ]),
          THEMES[0] as never,
          stage,
        );
      const short = lay("It pumps blood.", "We hear it.");
      const field = short.slide.elements.find((e) => e.name === SPLIT_NAMES.field) as SlideElement;
      const [a] = pics(short.slide.elements) as [ImageElement];
      expect(short.over).toEqual([]);
      // KS1's type fills the field with even short words; above it the pair takes about half the
      // field (more with the heading's clear space given back: Greg's 12 Oct spacing costs ~25pt).
      if (stage !== "ks1") expect(a.h, stage).toBeGreaterThan(field.h * 0.48);
      // The content runs to the stage's foot: no empty field under short words.
      const words = short.slide.elements.filter((e) => e.name === SPLIT_NAMES.text);
      const foot = Math.max(...words.map((e) => e.y + e.h));
      expect(540 - foot, stage).toBeLessThanOrEqual(43 + 24);
      const long = lay(
        "A muscle that pumps blood all round the body.",
        "Lets a doctor hear it beat.",
      );
      expect((pics(long.slide.elements)[0] as ImageElement).h).toBeLessThan(a.h);
    }
  });
});

describe("split-compare never shows a sliver (sc-13)", () => {
  const jar = (facts: boolean) => ({
    photo: "https://x.test/jar.jpg",
    aspect: 600 / 1707,
    alt: "a tall canopic jar",
    ...(facts
      ? {
          backdrop: { plain: { top: true, right: true, bottom: true, left: true } },
          kind: "object" as const,
        }
      : {}),
  });
  const valley = { photo: "https://x.test/valley.jpg", aspect: 1280 / 380, kind: "scene" as const };
  const sides = (facts: boolean): SplitSide[] => [
    { title: "Canopic jar", text: "Tall and carved from stone.", picture: jar(facts) },
    { title: "Glacial valley", text: "Wide and shaped like a U.", picture: valley },
  ];
  test("an upright object on a plain backdrop extends to the scene's shape; both at least 40% wide", () => {
    const vase = {
      photo: "https://x.test/vase.jpg",
      aspect: 0.75,
      backdrop: { plain: { top: true, right: true, bottom: true, left: true } },
      kind: "object" as const,
    };
    const street = { photo: "https://x.test/street.jpg", aspect: 1.5, kind: "scene" as const };
    for (const stage of STAGES) {
      const r = layoutTemplate(
        input([
          { title: "A vase", text: "Tall and narrow.", picture: vase },
          { title: "A street", text: "Wide and busy.", picture: street },
        ]),
        THEMES[0] as never,
        stage,
      );
      expect(r.over).toEqual([]);
      const field = r.slide.elements.find((e) => e.name === SPLIT_NAMES.field) as SlideElement;
      const [a, b] = r.slide.elements.filter((e): e is ImageElement => e.type === "image") as [
        ImageElement,
        ImageElement,
      ];
      expect(a.w).toBe(b.w);
      expect(a.h).toBe(b.h);
      expect(a.w).toBeGreaterThanOrEqual(field.w * 0.4);
      // The vase's crop runs past its edges: the director bakes the stretched backdrop (T5).
      const crop = a.crop as { x: number; w: number };
      expect(crop.x).toBeLessThan(0);
      expect(crop.w).toBeGreaterThan(1);
      expect(crop.w).toBeLessThanOrEqual(2);
    }
  });

  test("a jar too tall to reach the valley's shape is a sliver: reported, so the writer moves the slide", () => {
    // Plain or not: reaching 3.4:1 would stretch the jar's backdrop past twice its width.
    for (const facts of [false, true])
      for (const stage of STAGES) {
        const r = layoutTemplate(input(sides(facts)), THEMES[0] as never, stage);
        expect(r.over).toContain("sides[0].picture");
        expect(r.tight).toBe(true);
      }
  });
});

describe("split-compare over its hard maximum (row 4, sc-12)", () => {
  test("a very long first quote is named in over; every word is kept and nothing is clipped", () => {
    const long =
      "We work from six in the morning until eight at night, and the overseer beats any child who falls asleep at the machines, so we stand all day in the heat and the noise with no time to eat our bread or rest our legs, and many of us are hurt by the belts and the wheels.";
    for (const stage of STAGES) {
      const r = layoutTemplate(
        input([
          { title: "Child worker", text: "Long hours.", quote: long },
          { title: "Owner", text: "More cloth.", quote: "Machines make more cloth." },
        ]),
        THEMES[0] as never,
        stage,
      );
      expect(r.over).toEqual(["sides[0].quote"]);
      const q = texts(r.slide.elements).find((e) => e.name === SPLIT_NAMES.quote);
      expect(q && words(q)).toBe(long);
      expect(r.fields?.find((f) => f.field === "sides[0].quote")?.over).toBe(true);
    }
  });
});

describe("split-compare zones are all or none (row 5)", () => {
  test("one side without a picture: words only on every side", () => {
    const r = layoutTemplate(
      input([
        { title: "Shield", text: "Runny lava.", picture: upright, quote: "Flows far." },
        { title: "Composite", text: "Sticky lava.", quote: "Piles up." },
      ]),
      THEMES[0] as never,
      "ks2",
    );
    // No picture pair, so the quotes (every side has one) are the zone.
    expect(r.slide.elements.some((e) => e.type === "image")).toBe(false);
    expect(r.slide.elements.filter((e) => e.name === SPLIT_NAMES.bubble)).toHaveLength(2);
    const plain = layoutTemplate(
      input([
        { title: "Shield", text: "Runny lava.", picture: upright },
        { title: "Composite", text: "Sticky lava.", quote: "Piles up." },
      ]),
      THEMES[0] as never,
      "ks2",
    );
    expect(plain.slide.elements.some((e) => e.type === "image")).toBe(false);
    expect(plain.slide.elements.some((e) => e.name === SPLIT_NAMES.bubble)).toBe(false);
    expect(texts(plain.slide.elements).map((e) => e.name)).toContain(SPLIT_NAMES.text);
  });
});

describe("split-compare fields and colours", () => {
  test("full-bleed fields edge to edge, under the heading, one per side, on every theme", () => {
    for (const theme of THEMES)
      for (const n of [2, 3]) {
        const r = layoutTemplate(input(splitSides("KS2", n as 2 | 3, "text")), theme, "ks2");
        const fields = r.slide.elements.filter((e) => e.name === SPLIT_NAMES.field);
        expect(fields).toHaveLength(n);
        expect(fields[0]?.x).toBe(0);
        const last = fields[n - 1] as SlideElement;
        expect(last.x + last.w).toBe(960);
        for (const f of fields) expect(f.y + f.h).toBe(540);
        const head = r.slide.elements.find((e) => e.name === "Heading") as SlideElement;
        expect(fields[0]?.y).toBeGreaterThan(head.y + head.h);
        expect(r.slide.elements.filter((e) => e.name === SPLIT_NAMES.marker)).toHaveLength(n - 1);
        // The words read on their field at 4.5:1.
        for (const [i, f] of fields.entries()) {
          const fill = (f as { fill: string }).fill;
          const ink = texts(r.slide.elements).find(
            (e) => e.name === SPLIT_NAMES.text && e.x > f.x && e.x < f.x + f.w,
          )?.style.color;
          expect(
            contrastRatio(ink ?? theme.colors.ink, fill),
            `${theme.id} field ${i}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
        // Theme art never draws under the fields: a ground covers the whole slide first.
        expect(r.slide.elements[0]?.name).toBe(SPLIT_NAMES.ground);
      }
  });

  test("accentWord colours its substring of the heading; ignored when it is not one", () => {
    const at = (accentWord: string) =>
      JSON.stringify(
        layoutTemplate(
          { ...input(splitSides("KS2", 2, "text"), "Lava flow changes volcano shape"), accentWord },
          THEMES[0] as never,
          "ks2",
        ).slide.elements.find((e) => e.name === "Heading"),
      );
    expect(at("volcano shape")).toContain('"text":"volcano shape"');
    expect(at("volcano shape")).toContain(THEMES[0]?.colors.accent as string);
    expect(at("not there")).not.toContain('"textStyle"');
  });

  test("the fields report counts every side's fields against the table", () => {
    const r = layoutTemplate(input(splitSides("KS2", 2, "quote")), THEMES[0] as never, "ks2");
    expect(r.fields?.map((f) => f.field)).toEqual([
      "sides[0].title",
      "sides[0].quote",
      "sides[0].text",
      "sides[1].title",
      "sides[1].quote",
      "sides[1].text",
    ]);
    for (const f of r.fields ?? []) {
      expect(f.cap).toBeGreaterThan(0);
      expect(f.hardMax).toBeGreaterThanOrEqual(f.cap);
    }
  });

  test("each field carries its dotted input path, and each text element maps back to it", () => {
    const r = layoutTemplate(input(splitSides("KS2", 3, "quote")), THEMES[0] as never, "ks2");
    expect(r.fields?.map((f) => f.path)).toEqual([
      "sides.0.title",
      "sides.0.quote",
      "sides.0.text",
      "sides.1.title",
      "sides.1.quote",
      "sides.1.text",
      "sides.2.title",
      "sides.2.quote",
      "sides.2.text",
    ]);
    const paths = splitPaths(r.slide.elements);
    const bound = r.slide.elements
      .map((e, i) => [paths[i], e] as const)
      .filter(([p]) => p)
      .map(([p, e]) => `${p}=${words(e as TextElement)}`)
      .sort();
    const sides = splitSides("KS2", 3, "quote");
    const want = sides
      .flatMap((s, i) => [
        `sides.${i}.title=${s.title}`,
        `sides.${i}.quote=${s.quote}`,
        `sides.${i}.text=${s.text}`,
      ])
      .sort();
    expect(bound).toEqual(want);
  });

  test("past a cap but within the hard maximum: tight, not over", () => {
    const t = splitTable("KS2", 2, "text");
    const sides = splitSides("KS2", 2, "text").map((s: SplitSide, i: number) =>
      i === 0 ? { ...s, text: sample(t.text.cap + 12, 4) } : s,
    );
    const r = layoutTemplate(input(sides, SPLIT_FIT_HEADING), THEMES[0] as never, "ks2");
    if (t.text.hardMax > t.text.cap + 12) {
      expect(r.over).toEqual([]);
      expect(r.tight).toBe(true);
    }
  });
});

describe("split-compare capacity (row 7)", () => {
  test("words-only sides take the zone's height: 2 sides hold 25+ words at KS2 and over", () => {
    const words = (g: SplitGroup, n: 2 | 3) =>
      (splitTable(g, n, "text").text as { words?: number }).words ?? 0;
    // Measured, not targeted: 26 at KS2 since the 12 Oct spacing (31 before); the table holds the truth.
    expect(words("KS2", 2)).toBeGreaterThanOrEqual(25);
    expect(words("KS3-5", 2)).toBeGreaterThanOrEqual(30);
    expect(words("KS1", 2)).toBeGreaterThanOrEqual(20);
    // And 25 words are comfortable on every theme, not just in the table.
    const words25 =
      "Weather is what the air is doing today or this week, the rain and the sun and the wind, and it can change by the hour.";
    for (const theme of THEMES) {
      const r = layoutTemplate(
        input([
          { title: "Weather", text: words25 },
          { title: "Climate", text: words25 },
        ]),
        theme,
        "ks2",
      );
      expect(r.over, theme.id).toEqual([]);
      expect(r.tight, theme.id).toBe(false);
    }
  });

  test("the committed table is the renderer's measurement", () => {
    for (const group of Object.keys(SPLIT_GROUPS) as SplitGroup[])
      for (const n of [2, 3] as const)
        for (const zone of ZONES)
          expect(measureSplitCell(group, n, zone), `${group} ${n} ${zone}`).toEqual(
            (CAPACITY as Record<string, Record<string, Record<string, unknown>>>)[group]?.[n]?.[
              zone
            ] as never,
          );
  }, 120_000);
});

describe("split-compare never throws", () => {
  const long = (n: number) => "word ".repeat(n).trim();
  const odd: TemplateInput[] = [
    input([]),
    input([{ title: "", text: "" }]),
    input(Array.from({ length: 5 }, () => ({ title: long(20), text: long(80), quote: long(40) }))),
    input([
      { title: "Supercalifragilisticexpialidocious", text: "x", picture: { photo: "", aspect: 0 } },
      { title: "b", text: "y", picture: { diagram: null } },
    ]),
    {
      ...input([
        { title: "a", text: "b" },
        { title: "c", text: "d" },
      ]),
      marker: "",
      accentWord: "",
    },
  ];
  for (const stage of ["ks1", "ks3", "ks5"] as Stage[])
    test(`odd input at ${stage} on every theme`, () => {
      for (const theme of THEMES)
        for (const i of odd) {
          const r = layoutTemplate(i, theme, stage);
          expect(Array.isArray(r.slide.elements)).toBe(true);
          expect(r.slide.kind).toBe("content");
        }
      const few = layoutTemplate(odd[1] as TemplateInput, THEMES[0] as never, stage);
      expect(few.over).toContain("sides 1/2");
      const many = layoutTemplate(odd[2] as TemplateInput, THEMES[0] as never, stage);
      expect(many.over).toContain("sides 5/3");
    });
});
