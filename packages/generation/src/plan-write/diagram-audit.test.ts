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
    const long = ["A".repeat(80), "B".repeat(80)];
    expect(asFigureFull(photoSlide(long), theme)).toBeUndefined();
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
