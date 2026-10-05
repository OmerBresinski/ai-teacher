import { describe, expect, test } from "bun:test";
import { diagramFault, TEXT_CROWDS_DRAWING } from "../stages/plan-write";
import { diagramDisagreements } from "./diagram-agree";
import { DiagramSpecSchema } from "./diagram-spec";
import { withPictureZone } from "./simple";

const base = { heading: "H", body: ["one"], items: ["step 1", "step 2"], questions: [], notes: "" };

describe("DIAGRAM-AUDIT generation fixes", () => {
  test("a drawing on a worked example, sequence or compare keeps a picture zone", () => {
    for (const form of ["worked-example", "sequence", "compare"]) {
      const s = withPictureZone({ ...base, form, picture: { kind: "diagram", spec: {} } } as never);
      expect(s.form).toBe("photo");
      expect(s.body).toEqual(["one", "step 1", "step 2"]);
    }
    const photo = withPictureZone({
      ...base,
      form: "worked-example",
      picture: { subject: "x", named: null },
    } as never);
    expect(photo.form).toBe("worked-example");
  });

  test("a valid spec that does not draw blames the text, not the drawing", () => {
    const spec = { kind: "table", alt: "t", header: ["A"], rows: [["1"]] };
    expect(diagramFault(spec)).toBe(TEXT_CROWDS_DRAWING);
    expect(diagramFault(spec)).not.toContain("fewer parts");
  });

  test("a table's numbers need not appear in the text", () => {
    const table = {
      kind: "table",
      alt: "Stages",
      header: ["Stage", "Age"],
      rows: [
        ["Oral", "0-1"],
        ["Anal", "1-3"],
        ["Phallic", "3-6"],
      ],
    };
    expect(diagramDisagreements(table, "Freud named psychosexual stages.")).toEqual([]);
    const bars = {
      kind: "bar-model",
      alt: "b",
      bars: [{ label: "A", parts: [{ label: "12" }, { label: "12" }], total: "24" }],
    };
    expect(diagramDisagreements(bars, "Share the sweets.").length).toBeGreaterThan(0);
  });

  test("the mirror accepts what the renderer draws", () => {
    expect(
      DiagramSpecSchema.safeParse({ kind: "particles", alt: "d", show: "diffusion" }).success,
    ).toBe(true);
    expect(
      DiagramSpecSchema.safeParse({
        kind: "timeline",
        alt: "t",
        events: [
          { date: "1914", text: "a" },
          { date: "1918", text: "b" },
        ],
      }).success,
    ).toBe(true);
  });
});

describe("DIAGRAM-AUDIT big diagram", () => {
  const { getTheme, materialiseSlide, asFigureFull, PLACEHOLDER_IMAGE } = require("@tj/slides");
  const { renderWritten } = require("./fit");
  const { t3DiagramBase } = require("./simple");
  const theme = getTheme("chalk");
  const meta = { promptVersion: "t", model: "code", at: "1970-01-01T00:00:00.000Z" };
  const photoSlide = (body: string[]) => {
    const r = renderWritten("photo", "default", {
      heading: "The Weimar years",
      body,
      imageBrief: { subject: "x", named: null, mustShow: [] },
    });
    return materialiseSlide(
      r.spec,
      "chalk",
      meta,
      () => Math.random().toString(36).slice(2),
      r.variant,
      r.structure,
    );
  };
  const zone = (s: { elements: { type: string; src?: string; w: number; h: number }[] }) =>
    s.elements.find((e) => e.type === "image" && e.src === PLACEHOLDER_IMAGE);
  const seven = {
    kind: "timeline",
    alt: "Weimar",
    events: [1918, 1919, 1920, 1923, 1924, 1929, 1933].map((y) => ({
      date: String(y),
      text: `Hyperinflation and crisis ${y}`,
    })),
  };

  test("a big-diagram slide gives the drawing the full safe width", () => {
    const s = t3DiagramBase(photoSlide(["One line."]), seven, theme, true);
    expect(zone(s)?.w).toBe(844);
  });
  test("a drawing that does not fit half width steps up when the words allow", () => {
    const y7 = {
      kind: "particles",
      alt: "States",
      title: "From solid to liquid to gas",
      show: "states",
      states: ["solid", "liquid", "gas"],
      notes: [
        "Close, regular; vibrate in place",
        "Close, irregular; move past",
        "Far apart; move freely",
      ],
      arrows: ["Melting", "Boiling"],
    };
    const s = t3DiagramBase(photoSlide(["Heating moves particles apart."]), y7, theme, false);
    expect(zone(s)?.w).toBe(844);
  });
  test("long words keep the half-slide picture slide", () => {
    const long = Array.from({ length: 8 }, (_, i) => `Line ${i} `.repeat(12));
    expect(asFigureFull(photoSlide(long), theme)).toBeUndefined();
  });
  // LAYOUT-TEST Z y7 slide 3, as written: three panels with long notes do not fit the half zone,
  // and its three teaching lines (255 characters) blocked the one-line-caption step-up, so the
  // drawing was dropped for an icicle photo. The lines now go under the big diagram.
  test("the y7 particles slide steps up with its three lines under the drawing", () => {
    const { settleDiagram, withLongLabels } = require("@tj/slides/diagrams");
    const lines = [
      "Solid: closely packed in a regular arrangement. Particles vibrate about fixed positions.",
      "Liquid: close together in an irregular arrangement. Particles move past each other.",
      "Gas: far apart with no regular arrangement. Particles move freely in all directions.",
    ];
    const spec = {
      kind: "particles",
      alt: "Three states of matter",
      title: "Three states of matter",
      show: "states",
      states: ["solid", "liquid", "gas"],
      notes: [
        "Close, regular; vibrate in place",
        "Close, irregular; move past each other",
        "Far apart; move freely",
      ],
      arrows: [],
    };
    const s = t3DiagramBase(photoSlide(lines), spec, theme, false);
    const z = zone(s);
    expect(z?.w).toBe(844);
    // Clean in the big zone with long labels wrapped, as placeT3Diagram draws it.
    const settle = () => settleDiagram(spec, { w: z?.w ?? 0, h: z?.h ?? 0 }).clean;
    expect(withLongLabels(settle)).toBe(true);
    const words = s.elements
      .filter((e: { type: string }) => e.type === "text")
      .map((e: { doc?: unknown }) => JSON.stringify(e.doc ?? ""))
      .join(" ");
    for (const l of lines) expect(words).toContain(l);
  });
  test("the big-diagram form maps to a full picture slide", () => {
    const s = withPictureZone({
      ...base,
      form: "big-diagram",
      picture: { kind: "diagram", spec: {} },
    } as never);
    expect([s.form, (s as { full?: boolean }).full]).toEqual(["photo", true]);
  });
});

describe("DIAGRAM-AUDIT zone capacity", () => {
  const { t3ZoneLines, t3Menu } = require("./simple");
  const { capacityLine, diagramCapacities, zoneShape } = require("@tj/slides/diagrams");
  test("picture forms state their zone's position and shape, from code", () => {
    const z = t3ZoneLines();
    const { t3ZoneGeometry } = require("./simple");
    const g = t3ZoneGeometry();
    // The picture zone is read from the photo layout itself, not a constant.
    expect(z.picture).toContain(`the picture on the left (${zoneShape(g.picture.w, g.picture.h)})`);
    expect(z.picture).toMatch(/about \d+ characters wide, room for \d+ lines/);
    expect(z["big-diagram"]).toContain("across the slide under the heading (landscape");
    expect(z["big-diagram"]).toContain("its 2–3 lines below it");
    const menu = t3Menu().split("\n");
    const pic = menu.findIndex((l: string) => l.startsWith("- picture:"));
    expect(menu[pic + 1]).toMatch(/^- big-diagram: the picture form/);
    expect(zoneShape(422, 540)).toBe("portrait, about 4:5");
  });
  test("capacities come from the renderer and only grow with the zone", () => {
    const c = diagramCapacities();
    for (const k of Object.keys(c)) expect(c[k].full).toBeGreaterThanOrEqual(c[k].half > 0 ? 1 : 0);
    expect(c["bar-chart"].full).toBeGreaterThanOrEqual(c["bar-chart"].half);
    expect(capacityLine("bar-chart")).toMatch(/^up to \d+ bars/);
  });
});

describe("DIAGRAM-AUDIT picture shape", () => {
  const { orientationFor, cropToAspect } = require("../stages/illustrate");
  test("the zone's aspect picks the Pexels orientation", () => {
    expect(orientationFor(0.78)).toBe("portrait");
    expect(orientationFor(2.2)).toBe("landscape");
    expect(orientationFor(1)).toBe("square");
    expect(orientationFor(undefined)).toBe("portrait");
  });
  test("a Commons photo is cropped centrally to the zone's shape", () => {
    const c = cropToAspect(1600, 900, 0.8);
    expect(c.h).toBe(900);
    expect(c.w).toBeCloseTo(720, 5);
    expect(c.x).toBeCloseTo(440, 5);
    expect(c.kept).toBeCloseTo(0.45, 2);
    expect(cropToAspect(800, 1000, 0.8).kept).toBeCloseTo(1, 5);
  });
});

// LAYOUT-TEST fix 4: every number on the menu comes from the layout the deck is drawn with.
describe("T3 menu numbers come from the layout actually used", () => {
  const { getTheme, FIGURE_FULL_CAPTION_LINES, figureFullCaptionChars } = require("@tj/slides");
  const diagrams = require("@tj/slides/diagrams");
  const { teacher3Prompt, t3ZoneGeometry, t3DrawingZones } = require("./simple");
  for (const themeId of ["chalk", "studio", "beacon"]) {
    test(`${themeId}: zone shapes, caption and drawing capacities`, () => {
      const user: string = teacher3Prompt({
        slideCount: 10,
        topic: "t",
        context: "c",
        yearGroup: "Year 7",
        subject: "science",
        ageBand: "ks3",
        objectives: ["o"],
        themeId,
      }).user;
      const g = t3ZoneGeometry(themeId);
      const line = (k: string) => user.split("\n").find((l) => l.startsWith(`- ${k}:`)) ?? "";
      expect(line("picture")).toContain(`(${diagrams.zoneShape(g.picture.w, g.picture.h)})`);
      expect(line("big-diagram")).toContain(diagrams.zoneShape(g.big.w, g.big.h));
      expect(line("big-diagram")).toContain(
        `${FIGURE_FULL_CAPTION_LINES} lines of about ${figureFullCaptionChars(getTheme(themeId))} characters`,
      );
      // The picture zone is about square; the old fixed 422 x 540 zone printed "4:5".
      expect(Math.abs(g.picture.w / g.picture.h - 1)).toBeLessThan(0.1);
      expect(user).not.toContain("4:5");
      const caps = diagrams.diagramCapacities(t3DrawingZones(themeId), [getTheme(themeId)]);
      for (const [kind, c] of Object.entries(caps) as [string, { half: number; full: number }][]) {
        if (!line(kind)) continue;
        const want = c.half === c.full ? `up to ${c.full} ` : `up to ${c.half} `;
        expect(line(kind)).toContain(want);
      }
    });
  }
});
