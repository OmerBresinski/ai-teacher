import { describe, expect, test } from "bun:test";
import type {
  ImageElement,
  PathElement,
  ShapeElement,
  TextElement,
  Theme,
} from "@tj/domain/documents";
import { countLines } from "../text-measure";
import { resolveTextStyle } from "../text-style";
import { atKeyStage, MIN_FONT_SIZE, THEMES } from "../themes";
import { cutSubjects, type Figure, layoutTemplate, type Stage, type TemplateInput } from "./index";
import {
  DISPLAY_CUSHION,
  PANEL_COMFORT,
  PANEL_NAMES,
  PANEL_W,
  PANEL_W_NARROW,
  type PanelRow,
  panelCapsFor,
  panelListFits,
  panelListPaths,
} from "./panel-list";
import { measurePanelCaps, panelSample as sampleOf } from "./panel-list-capacity";
import CAPACITY from "./panel-list-capacity.json";
import { ageOf } from "./panel-list-deps";

/*
 * TEACH-75 part v: the panel-list template. A deep title panel (heading, optional photo or pie
 * under it) beside 2-6 rows. Comfortable to 5 rows (early 4); 6 is always tight; words are never
 * cut, anything past its hard maximum is named in `over`.
 */
const STAGES: Stage[] = ["ks1", "ks2", "ks3"];
const T0 = THEMES[0] as Theme;
const ROWS: PanelRow[] = [
  { name: "Fruit", text: "Gives us vitamins.", icon: "apple" },
  { name: "Fish", text: "Builds strong muscles.", icon: "fish" },
  { name: "Water", text: "Keeps us cool.", icon: "water" },
  { name: "Leaves", text: "Give us fibre.", icon: "leaf" },
  { name: "Sun", text: "Gives vitamin D.", icon: "sun" },
  { name: "Heart", text: "Pumps the blood.", icon: "heart" },
];
const wide: Figure = {
  photo: "https://x.test/wide.jpg",
  aspect: 16 / 9,
  alt: "A field",
  subjects: [{ name: "tractor", x: 0.4, y: 0.4, w: 0.2, h: 0.3 }],
};
const tall: Figure = {
  photo: "https://x.test/tall.jpg",
  aspect: 9 / 16,
  alt: "A lighthouse",
  subjects: [{ name: "lighthouse", x: 0.3, y: 0.05, w: 0.4, h: 0.9 }],
};
const VISUALS: Record<string, TemplateInput["panel"]> = {
  none: null,
  photo: { picture: wide },
  pie: { shares: [] },
};
const input = (n: number, visual: string, lead?: string, rows = ROWS): TemplateInput => ({
  template: "panel-list",
  heading: "Food groups",
  rows: rows.slice(0, n),
  ...(lead ? { lead } : {}),
  panel:
    visual === "pie"
      ? { shares: Array.from({ length: n }, (_, i) => n - i) }
      : (VISUALS[visual] ?? null),
});
const named = (els: { name?: string }[], name: string) => els.filter((e) => e.name === name);

describe("panel-list", () => {
  for (const theme of THEMES)
    for (const stage of STAGES)
      test(`${theme.id} ${stage}: 2 to the comfortable count, photo / pie / none, a lead below it`, () => {
        const faults: string[] = [];
        const max = PANEL_COMFORT[ageOf(stage)];
        for (let n = 2; n <= max; n++)
          // A lead is comfortable only below the most rows (the pilot's +lead caps are 0 there).
          for (const visual of ["none", "photo", "pie"])
            for (const lead of n < max ? [undefined, "Eat a little of each."] : [undefined]) {
              const r = layoutTemplate(input(n, visual, lead), theme, stage);
              const tag = `${n} ${visual}${lead ? " lead" : ""}`;
              if (r.over.length) faults.push(`${tag} over ${r.over.join(", ")}`);
              if (r.tight) faults.push(`${tag} tight`);
              for (const e of r.slide.elements) {
                const size = (e as TextElement).style?.fontSize;
                if (size !== undefined && size < MIN_FONT_SIZE.body)
                  faults.push(`${tag} ${e.name} ${size}`);
                if (e.y + e.h > 540.5 || e.x + e.w > 960.5) faults.push(`${tag} ${e.name} off`);
              }
            }
        expect(faults).toEqual([]);
      });

  test("two-line rows at four are tight", () => {
    const long = ROWS.map((r) => ({
      ...r,
      text: "Gives us the vitamins and the fibre a growing body needs to stay well every day.",
    }));
    expect(layoutTemplate(input(4, "none", undefined, long), T0, "ks2").tight).toBe(true);
  });

  test("a panel and its heading: the panel is full height, the title at its top", () => {
    const r = layoutTemplate(input(3, "none"), T0, "ks2");
    const [panel] = named(r.slide.elements, PANEL_NAMES.panel) as ShapeElement[];
    expect(panel).toMatchObject({ x: 0, y: 0, h: 540, shape: "rect" });
    const [title] = named(r.slide.elements, PANEL_NAMES.title) as TextElement[];
    expect(title?.y).toBeLessThan(100);
    const withPhoto = layoutTemplate(input(3, "photo"), T0, "ks2");
    expect((named(withPhoto.slide.elements, PANEL_NAMES.panel)[0] as ShapeElement).w).toBe(PANEL_W);
  });

  test("a wide and a tall photo: a safe standard shape keeping the subject, else its own shape inset; never matted", () => {
    for (const fig of [wide, tall])
      for (const stage of STAGES) {
        const r = layoutTemplate({ ...input(3, "none"), panel: { picture: fig } }, T0, stage);
        const imgs = r.slide.elements.filter((e) => e.type === "image") as ImageElement[];
        expect(imgs).toHaveLength(1);
        const img = imgs[0] as ImageElement;
        expect(named(r.slide.elements, "Photo panel")).toHaveLength(0);
        expect(img.x + img.w).toBeLessThanOrEqual(PANEL_W);
        expect(img.y + img.h).toBeLessThanOrEqual(540);
        if ("photo" in fig) expect(cutSubjects(img.crop, fig.subjects)).toEqual([]);
        const ratio = img.w / img.h;
        const standard = [16 / 9, 4 / 3, 1, 3 / 4].some((s) => Math.abs(ratio - s) < 0.02);
        const own = Math.abs(ratio - (("photo" in fig && fig.aspect) || 1)) < 0.02;
        expect(standard || own, `${stage} ratio ${ratio}`).toBe(true);
        const title = named(r.slide.elements, PANEL_NAMES.title)[0] as TextElement;
        expect(img.y).toBeGreaterThanOrEqual(title.y + title.h);
      }
  });

  test("a pie: one wedge per row in category colours that match the rows' discs", () => {
    const r = layoutTemplate({ ...input(3, "none"), panel: { shares: [3, 2, 1] } }, T0, "ks2");
    const wedges = named(r.slide.elements, PANEL_NAMES.wedge) as PathElement[];
    const discs = named(r.slide.elements, PANEL_NAMES.disc) as ShapeElement[];
    expect(wedges).toHaveLength(3);
    expect(wedges.map((w) => w.fill)).toEqual(discs.map((d) => d.fill));
    expect(new Set(wedges.map((w) => w.fill)).size).toBe(3);
    for (const w of wedges) expect(w.closed).toBe(true);
    // The biggest share is the biggest wedge: more arc points.
    expect(wedges[0]?.points.length).toBeGreaterThan(wedges[2]?.points.length ?? 0);
  });

  test("shares that do not match the rows are reported and no pie is drawn", () => {
    const r = layoutTemplate({ ...input(3, "none"), panel: { shares: [3, 2] } }, T0, "ks2");
    expect(r.over).toContain("panel.shares");
    expect(named(r.slide.elements, PANEL_NAMES.wedge)).toHaveLength(0);
  });

  test("icons are all or none: a miss draws numbers and is reported", () => {
    const hit = layoutTemplate(input(3, "none"), T0, "ks2");
    expect(hit.slide.elements.filter((e) => e.type === "icon")).toHaveLength(3);
    expect(hit.iconMisses ?? []).toEqual([]);
    const rows = ROWS.slice(0, 3).map((r, i) => (i === 1 ? { ...r, icon: "kitten" } : r));
    const miss = layoutTemplate(input(3, "none", undefined, rows), T0, "ks2");
    expect(miss.slide.elements.filter((e) => e.type === "icon")).toHaveLength(0);
    expect(miss.iconMisses).toEqual(["kitten"]);
    const discs = named(miss.slide.elements, PANEL_NAMES.disc) as ShapeElement[];
    expect(discs).toHaveLength(3);
    expect(discs.every((d) => d.doc !== undefined)).toBe(true);
  });

  test("rows past six are reported and only six are laid; a row past its hard maximum is named", () => {
    const seven = layoutTemplate(
      input(7, "none", undefined, [...ROWS, { name: "Seven", text: "One more." }]),
      T0,
      "ks2",
    );
    expect(seven.over).toContain("rows 7/6");
    expect(named(seven.slide.elements, PANEL_NAMES.disc)).toHaveLength(6);
    const huge = ROWS.slice(0, 3).map((r, i) =>
      i === 2 ? { ...r, text: "word ".repeat(200) } : r,
    );
    const r = layoutTemplate(input(3, "none", undefined, huge), T0, "ks2");
    expect(r.over).toContain("rows[2].text");
    expect(r.fields?.find((f) => f.field === "rows[2].text")?.over).toBe(true);
  });

  test("fields carry the measured caps, the live counters", () => {
    const r = layoutTemplate(input(4, "pie", "Eat a little of each."), T0, "ks2");
    const caps = panelCapsFor("primary", 4);
    expect(caps).toBeDefined();
    const name = r.fields?.find((f) => f.field === "rows[0].name");
    expect(name).toMatchObject({ chars: 5, cap: caps?.withLead.name.cap, over: false });
    expect(r.fields?.map((f) => f.field)).toContain("lead");
    expect(r.fields?.map((f) => f.field)).toContain("heading");
  });

  test("the editor's addresses: fields carry dotted paths, and each text element maps to its input path", () => {
    const r = layoutTemplate(input(3, "none", "Eat a little of each."), T0, "ks2");
    expect(r.fields?.find((f) => f.field === "rows[1].text")?.path).toBe("rows.1.text");
    const paths = panelListPaths(r.slide.elements).filter(Boolean);
    expect(paths).toEqual([
      "heading",
      "lead",
      "rows.0.name",
      "rows.0.text",
      "rows.1.name",
      "rows.1.text",
      "rows.2.name",
      "rows.2.text",
    ]);
  });

  test("every text is stored at the size the renderer draws, so the fit is the browser's", () => {
    for (const theme of THEMES)
      for (const stage of STAGES)
        for (const visual of ["none", "photo", "pie"]) {
          const r = layoutTemplate(input(4, visual, "Eat a little of each."), theme, stage);
          for (const e of r.slide.elements) {
            const st = e.type === "text" ? e.style : e.type === "shape" ? e.textStyle : undefined;
            if (st?.fontSize === undefined) continue;
            const preset = st.preset ?? "body";
            const shown = resolveTextStyle({ ...st, preset }, atKeyStage(theme, stage), preset);
            expect(shown.fontSize, `${theme.id} ${stage} ${e.name}`).toBe(st.fontSize);
          }
        }
  });

  test("a 46-character heading over a pie never draws into the pie: it fits above it or is over", () => {
    const heading = "The five main food groups on the Eatwell Guide";
    expect(heading).toHaveLength(46);
    for (const theme of THEMES)
      for (const stage of STAGES) {
        const r = layoutTemplate(
          { ...input(5, "none"), heading, panel: { shares: [39, 37, 12, 8, 4] } },
          theme,
          stage,
        );
        const t = named(r.slide.elements, PANEL_NAMES.title)[0] as TextElement;
        const [ground] = named(r.slide.elements, PANEL_NAMES.halo) as ShapeElement[];
        const st = atKeyStage(theme, stage);
        const shown = resolveTextStyle(t.style ?? {}, st, t.style?.preset ?? "title");
        const lines = countLines(heading, shown.preset, st, t.w, shown.fontWeight, shown.fontSize);
        const bottom = t.y + lines * shown.fontSize * (t.style?.lineHeight ?? 1);
        const tag = `${theme.id} ${stage} ${shown.fontSize}pt ${lines} lines`;
        if (!r.over.includes("heading"))
          expect(bottom, tag).toBeLessThanOrEqual((ground?.y ?? 540) + 0.5);
      }
  });

  test("no visual (option A, the default): the panel narrows and the title sits near the top", () => {
    const r = layoutTemplate(input(4, "none"), T0, "ks2");
    const [panel] = named(r.slide.elements, PANEL_NAMES.panel) as ShapeElement[];
    expect(panel?.w).toBe(PANEL_W_NARROW);
    expect(PANEL_W_NARROW / 960).toBeCloseTo(0.28, 2);
    const title = named(r.slide.elements, PANEL_NAMES.title)[0] as TextElement;
    expect(title.y).toBeLessThan(100);
    expect(title.x + title.w).toBeLessThanOrEqual(PANEL_W_NARROW);
    // The rows move left with the panel.
    const disc = named(r.slide.elements, PANEL_NAMES.disc)[0] as ShapeElement;
    expect(disc.x).toBeLessThan(PANEL_W_NARROW + 60);
    // With a visual the panel keeps its full width.
    const pie = layoutTemplate(input(4, "pie"), T0, "ks2");
    expect((named(pie.slide.elements, PANEL_NAMES.panel)[0] as ShapeElement).w).toBe(PANEL_W);
  });

  test("no visual, option B: the full panel shows the group's icon large under the title", () => {
    const r = layoutTemplate(input(4, "none"), T0, "ks2", { panelNoVisual: "icon" });
    const [panel] = named(r.slide.elements, PANEL_NAMES.panel) as ShapeElement[];
    expect(panel?.w).toBe(PANEL_W);
    const big = named(r.slide.elements, PANEL_NAMES.groupIcon);
    expect(big).toHaveLength(1);
    const title = named(r.slide.elements, PANEL_NAMES.title)[0] as TextElement;
    const icon = big[0] as { y: number; h: number; w: number };
    expect(icon.y).toBeGreaterThanOrEqual(title.y + title.h);
    expect(icon.w).toBeGreaterThan(100);
    // No icon resolves: option B falls back to A.
    const plain = ROWS.slice(0, 4).map((x) => ({ ...x, icon: null }));
    const b = layoutTemplate(input(4, "none", undefined, plain), T0, "ks2", {
      panelNoVisual: "icon",
    });
    expect((named(b.slide.elements, PANEL_NAMES.panel)[0] as ShapeElement).w).toBe(PANEL_W_NARROW);
  });

  test("the heading is measured with the display-weight margin and reported when it cannot hold", () => {
    // y3 s3: five rows, no visual; the heading must never run off the slide.
    const heading = "Five needs for healthy growth";
    for (const theme of THEMES)
      for (const stage of STAGES)
        for (const visual of ["none", "pie", "photo"]) {
          const r = layoutTemplate({ ...input(5, visual), heading }, theme, stage);
          const t = named(r.slide.elements, PANEL_NAMES.title)[0] as TextElement;
          const st = atKeyStage(theme, stage);
          const shown = resolveTextStyle(t.style ?? {}, st, t.style?.preset ?? "title");
          const lines = countLines(
            heading,
            shown.preset,
            st,
            t.w * DISPLAY_CUSHION,
            shown.fontWeight,
            shown.fontSize,
          );
          expect(t.h, `${theme.id} ${stage} ${visual}`).toBeGreaterThanOrEqual(
            Math.floor(lines * shown.fontSize * (t.style?.lineHeight ?? 1)),
          );
          expect(t.y + t.h).toBeLessThanOrEqual(540);
          expect(r.fields?.find((f) => f.field === "heading")).toBeDefined();
        }
    // A heading that cannot hold even at its smallest step is over, and its field says so.
    const r = layoutTemplate({ ...input(3, "pie"), heading: "word ".repeat(40) }, T0, "ks2");
    expect(r.over).toContain("heading");
    expect(r.fields?.find((f) => f.field === "heading")?.over).toBe(true);
  });

  test("five rows are measured, not zeroed: one-line rows at KS3 are comfortable", () => {
    // At KS2 five rows stay uncomfortable: body draws at 25pt and the gaps fall under a body line.
    for (const age of ["secondary"] as const) {
      const caps = panelCapsFor(age, 5);
      expect(caps?.text.cap, age).toBeGreaterThan(0);
      expect(caps?.text.words, age).toBeGreaterThan(0);
    }
    // The audit's KS2 targets: heading about 7 words, 3 rows about 11, 4 rows about 6.
    expect(panelCapsFor("primary", 3)?.text.words).toBeGreaterThanOrEqual(11);
    expect(panelCapsFor("primary", 4)?.text.words).toBeGreaterThanOrEqual(6);
    expect(panelCapsFor("primary", 3)?.heading.words).toBeGreaterThanOrEqual(6);
  });

  test("odd input never throws", () => {
    const odd: TemplateInput[] = [
      { template: "panel-list", heading: "" },
      { template: "panel-list", heading: "x", rows: [] },
      { template: "panel-list", heading: "x", rows: [{ name: "", text: "" }] },
      {
        template: "panel-list",
        heading: "Supercalifragilisticexpialidocious-antidisestablishmentarianism ".repeat(4),
        lead: "word ".repeat(80),
        rows: Array.from({ length: 9 }, () => ({
          name: "word ".repeat(20),
          text: "word ".repeat(90),
        })),
        panel: { shares: [0, -1, Number.NaN] },
      },
      { template: "panel-list", heading: "x", rows: ROWS, panel: { picture: { photo: "" } } },
      { template: "panel-list", heading: "x", rows: ROWS, panel: { picture: { diagram: null } } },
    ];
    for (const theme of THEMES)
      for (const stage of ["ks1", "ks3", "ks5"] as Stage[])
        for (const i of odd) {
          const r = layoutTemplate(i, theme, stage);
          expect(Array.isArray(r.slide.elements)).toBe(true);
        }
  });

  test("the capacity table is the renderer's measurement: each cap is comfortable, each hard maximum fits", () => {
    for (const [age, stage] of [
      ["early", "ks1"],
      ["primary", "ks2"],
      ["secondary", "ks3"],
    ] as const)
      for (const n of [2, 3, 4, 5]) {
        const caps = panelCapsFor(age, n);
        if (!caps || caps.text.cap === 0) continue;
        const rows = ROWS.slice(0, n).map((r) => ({ ...r, text: "x".repeat(0) + r.text }));
        rows[0] = { ...(rows[0] as PanelRow), text: sampleOf(caps.text.cap) };
        const fit = panelListFits(input(n, "pie", undefined, rows), THEMES, stage);
        expect(fit.comfortable, `${age} ${n} text cap ${caps.text.cap}`).toBe(true);
        rows[0] = { ...(rows[0] as PanelRow), text: sampleOf(caps.text.hardMax) };
        expect(panelListFits(input(n, "pie", undefined, rows), THEMES, stage).fits).toBe(true);
      }
    expect(Object.keys(CAPACITY)).toEqual(["early", "primary", "secondary"]);
  }, 60_000);

  test("regenerating the capacity gives the committed table (two cells re-measured)", () => {
    const table = CAPACITY as unknown as Record<string, Record<string, unknown>>;
    expect(measurePanelCaps("early", 3)).toEqual(table.early?.["3"] as never);
    expect(measurePanelCaps("primary", 5)).toEqual(table.primary?.["5"] as never);
  }, 60_000);
});
