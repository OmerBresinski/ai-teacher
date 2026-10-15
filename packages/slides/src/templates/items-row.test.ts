import { describe, expect, test } from "bun:test";
import type { PathElement, ShapeElement, SlideElement } from "@tj/domain/documents";
import { isPlaceholderIcon } from "../look";
import { presentedSlide, withoutDiagramSlot } from "../materialise";
import { resolveTextStyle } from "../text-style";
import { getTheme, MIN_FONT_SIZE, THEMES } from "../themes";
import { layoutTemplate, type Stage, type TemplateInput, templateScale } from "./index";
import {
  blankRowItem,
  motifOf,
  PENDING_ICON,
  PLACEHOLDER_ICON,
  ROW_MAX,
  ROW_NAMES,
  type RowItem,
  rowShape,
  STEM_GREEN,
} from "./items-row";
import { ROW_CAP_GROUPS, rowCapsFor, rowFitsAt } from "./items-row-capacity";
import CAPACITY from "./items-row-capacity.json" with { type: "json" };
import { ageProfileOf, GOLD_PROFILES } from "./items-row-deps";

/*
 * items-row (TEACH-75 part u): 2-4 items on a connecting line, comfortable on every theme at the
 * three age profiles at the measured caps; 5-6 items return tight in two rows of three; words
 * never cut, past a field's hard maximum the field is named in `over`; icons all or none.
 */
const STAGES: Stage[] = ["ks1", "ks2", "ks3"];
const must = <T>(x: T | undefined | null): T => {
  if (x === undefined || x === null) throw new Error("missing");
  return x;
};
const T0 = must(THEMES[0]);
const HEADING = "Three parts work together";
const ITEMS: RowItem[] = [
  { name: "Heart", text: "A muscle that pumps blood.", icon: "heart" },
  { name: "Blood", text: "Carries oxygen and nutrients.", icon: "blood" },
  { name: "Blood vessels", text: "Tubes that blood travels through.", icon: "vessels" },
  { name: "Lungs", text: "Fill the blood with oxygen.", icon: "lungs" },
  { name: "Stomach", text: "Breaks food down for energy.", icon: "stomach" },
  { name: "Muscles", text: "Use oxygen to move the body.", icon: "muscles" },
];
/**
 * Two rows (5-6 items) hold about one short line an item: the row's words are measured at the
 * size the renderer draws, which at a key stage never goes under the scale's smallest reading
 * step, so the six lines above (up to 33 characters) are past a two-row cell's hard maximum.
 * KS1's four under a lead hold the same (its smallest reading step is 28).
 */
const SHORT = [
  "Pumps blood.",
  "Carries oxygen.",
  "Blood tubes.",
  "Take in air.",
  "Breaks food.",
  "Move the body.",
];
const itemsOf = (n: number, icons = true, short = n >= 5): RowItem[] =>
  ITEMS.slice(0, n).map((it, i) => {
    const text = short ? (SHORT[i] as string) : it.text;
    return icons ? { ...it, text } : { name: it.name, text };
  });
const row = (items: RowItem[], extra: Partial<TemplateInput> = {}): TemplateInput => ({
  template: "items-row",
  heading: HEADING,
  items,
  ...extra,
});
const named = (els: SlideElement[], name: string) => els.filter((e) => e.name === name);
const sizeOf = (e: SlideElement) => (e as { style?: { fontSize?: number } }).style?.fontSize ?? 0;
const words = (els: SlideElement[]) =>
  JSON.stringify(els.map((e) => (e as { doc?: unknown }).doc ?? null));

describe("items-row shape", () => {
  test("2-4 items one row, 5-6 two rows of three", () => {
    expect(rowShape(2)).toEqual([2]);
    expect(rowShape(3)).toEqual([3]);
    expect(rowShape(4)).toEqual([4]);
    expect(rowShape(5)).toEqual([3, 2]);
    expect(rowShape(6)).toEqual([3, 3]);
  });

  test("three age profiles from the stage", () => {
    expect(ageProfileOf("ks1")).toBe("early");
    expect(ageProfileOf("ks2")).toBe("primary");
    expect(ageProfileOf("ks4")).toBe("secondary");
    // px at 1440 x 2/3: the primary medal 268 px is 178.7 pt.
    expect(GOLD_PROFILES.primary.medal).toBeCloseTo(178.7, 1);
    expect(GOLD_PROFILES.early.medalMin).toBeCloseTo(134.7, 1);
  });
});

describe("items-row on every theme, age and count", () => {
  for (const theme of THEMES)
    for (const stage of STAGES)
      test(`${theme.id} ${stage}: 2..6 items, icons and numbered, nothing over or clipped`, () => {
        const faults: string[] = [];
        const max = stage === "ks1" ? 4 : 6;
        for (let n = 2; n <= max; n++)
          // A lead is offered up to 4 items: two rows under a lead hold almost nothing (the caps).
          for (const icons of [true, false])
            for (const lead of n <= 4 ? [undefined, "How the body moves blood."] : [undefined]) {
              const short = n >= 5 || (stage === "ks1" && n === 4 && !!lead);
              const r = layoutTemplate(
                row(itemsOf(n, icons, short), lead ? { lead } : {}),
                theme,
                stage,
              );
              const tag = `${n} ${icons ? "icons" : "numbered"}${lead ? " +lead" : ""}`;
              // Five and six are over the count (ROW_MAX 4) but still draw cleanly as two rows.
              for (const o of r.over)
                if (!(n > 4 && o === "items")) faults.push(`${tag} over: ${o}`);
              for (const e of r.slide.elements) {
                if (e.type === "path") continue;
                if (e.y < 0 || e.y + e.h > 540 - 16) faults.push(`${tag} ${e.name} off the slide`);
                if (e.x < 0 || e.x + e.w > 960) faults.push(`${tag} ${e.name} off the side`);
                const s = sizeOf(e);
                if (s && s < MIN_FONT_SIZE.body) faults.push(`${tag} ${e.name} ${s}`);
              }
              if (named(r.slide.elements, ROW_NAMES.name).length !== n) faults.push(`${tag} names`);
              if (n >= 5 && !r.tight) faults.push(`${tag} not tight`);
            }
        expect(faults).toEqual([]);
      });
});

describe("comfort", () => {
  for (const stage of STAGES)
    test(`${stage}: 2-4 items at the measured cap are comfortable, body at the comfort size`, () => {
      const prof = GOLD_PROFILES[ageProfileOf(stage)];
      const comfortBody = Math.max(MIN_FONT_SIZE.body, prof.comfort.body);
      const faults: string[] = [];
      for (const n of [2, 3, 4])
        for (const icons of [true, false]) {
          // Names within the measured name cap (early, 4 with icons: 12 characters).
          const cap = rowCapsFor(ageProfileOf(stage), n, { icons, lead: false });
          const items = itemsOf(n, icons).map((it) =>
            it.name.length > (cap?.name.cap ?? 99) ? { ...it, name: "Vessels" } : it,
          );
          for (const theme of THEMES) {
            const r = layoutTemplate(row(items), theme, stage);
            const tag = `${theme.id} ${n} ${icons}`;
            if (r.tight) faults.push(`${tag} tight`);
            if (r.over.length) faults.push(`${tag} over ${r.over}`);
            for (const e of named(r.slide.elements, ROW_NAMES.text))
              if (sizeOf(e) < comfortBody - 0.5) faults.push(`${tag} body ${sizeOf(e)}`);
          }
        }
      expect(faults).toEqual([]);
    });

  test("5 and 6 items at primary: two rows of three, tight, over only on the count", () => {
    for (const n of [5, 6])
      for (const icons of [true, false]) {
        const r = layoutTemplate(row(itemsOf(n, icons)), T0, "ks2");
        expect(r.tight).toBe(true);
        expect(r.over).toEqual(["items"]);
        const ys = [...new Set(named(r.slide.elements, ROW_NAMES.medal).map((e) => e.y))];
        expect(ys).toHaveLength(2);
      }
  });

  test("a lead past one line is tight; one line is not", () => {
    const short = layoutTemplate(row(itemsOf(3), { lead: "How blood moves." }), T0, "ks2");
    expect(short.tight).toBe(false);
    const long = layoutTemplate(
      row(itemsOf(3), {
        lead: "The heart pumps blood through the vessels to every part of the body and back again to the lungs.",
      }),
      T0,
      "ks2",
    );
    expect(long.tight).toBe(true);
  });
});

describe("icons and numbers", () => {
  test("icons all or none: a miss numbers every item and is reported", () => {
    const r = layoutTemplate(
      row([
        { name: "Heart", text: "Pumps blood.", icon: "heart" },
        { name: "Blood", text: "Carries oxygen.", icon: "blood" },
        { name: "Kitten", text: "A young cat.", icon: "kitten" },
      ]),
      T0,
      "ks2",
    );
    expect(r.iconMisses).toEqual(["kitten"]);
    expect(r.slide.elements.filter((e) => e.type === "image")).toHaveLength(0);
    expect(named(r.slide.elements, ROW_NAMES.numeral)).toHaveLength(3);
  });

  test("with icons: one icon per medal on a white face, a number badge when ordered", () => {
    const r = layoutTemplate(row(itemsOf(3)), T0, "ks2");
    expect(r.iconMisses ?? []).toEqual([]);
    expect(r.slide.elements.filter((e) => e.type === "image")).toHaveLength(3);
    expect(named(r.slide.elements, ROW_NAMES.badge)).toHaveLength(3);
    const off = layoutTemplate(row(itemsOf(3), { ordered: false }), T0, "ks2");
    expect(named(off.slide.elements, ROW_NAMES.badge)).toHaveLength(0);
  });

  test("a teacher-added blank keeps an icon row's icons: the placeholder counts as an icon", () => {
    const r = layoutTemplate(row([...itemsOf(3), blankRowItem()]), T0, "ks2");
    expect(r.iconMisses ?? []).toEqual([]);
    const pics = r.slide.elements.filter((e) => e.type === "image");
    expect(pics).toHaveLength(4);
    expect(named(r.slide.elements, ROW_NAMES.numeral)).toHaveLength(0);
    const src = decodeURIComponent((pics[3] as { src: string }).src);
    expect(src).toContain(`data-icon="${PLACEHOLDER_ICON}"`);
    expect(blankRowItem().icon).toBe("placeholder");
  });

  test("the placeholder icon is the editor's alone: present and every export leave its medal empty", () => {
    const r = layoutTemplate(row([...itemsOf(3), blankRowItem()]), T0, "ks2");
    const slide = { ...r.slide, kind: "content" } as never;
    const pics = (els: SlideElement[]) => els.filter((e) => e.type === "image");
    expect(pics(r.slide.elements).filter(isPlaceholderIcon)).toHaveLength(1);
    // Present, the viewer, thumbnails, PDF and PNG draw `withoutDiagramSlot`; PPTX `presentedSlide`.
    for (const shown of [withoutDiagramSlot(slide, T0), presentedSlide(slide, T0)]) {
      expect(pics(shown.elements)).toHaveLength(3);
      expect(shown.elements.some(isPlaceholderIcon)).toBe(false);
      expect(named(shown.elements, ROW_NAMES.medal)).toHaveLength(4);
      expect(named(shown.elements, ROW_NAMES.numeral)).toHaveLength(0);
    }
    // A row with no placeholder comes back as it is.
    const whole = { ...layoutTemplate(row(itemsOf(3)), T0, "ks2").slide, kind: "content" } as never;
    expect(withoutDiagramSlot(whole, T0)).toBe(whole);
  });

  test("a draft's held icon: an empty medal at the icon size, no number, no drawing, no miss", () => {
    const whole = layoutTemplate(row(itemsOf(3)), T0, "ks3");
    const held = itemsOf(3).map((it, i) => (i === 0 ? it : { ...it, icon: PENDING_ICON }));
    for (const ordered of [true, false]) {
      const r = layoutTemplate(row(held, { ordered }), T0, "ks3");
      expect(r.iconMisses ?? []).toEqual([]);
      expect(r.slide.elements.filter((e) => e.type === "image")).toHaveLength(1);
      expect(named(r.slide.elements, ROW_NAMES.numeral)).toHaveLength(0);
      // Only the resolved item wears its badge; held items show nothing on the face.
      expect(named(r.slide.elements, ROW_NAMES.badge)).toHaveLength(ordered ? 1 : 0);
      expect(named(r.slide.elements, ROW_NAMES.mark)).toHaveLength(0);
    }
    // Faces and words sit exactly where the resolved row puts them: the icon lands, nothing moves.
    const r = layoutTemplate(row(held), T0, "ks3");
    const box = (e: SlideElement) => [e.name, e.x, e.y, e.w, e.h];
    const keep = (els: SlideElement[]) =>
      els.filter(
        (e) => e.type !== "image" && e.name !== ROW_NAMES.badge && e.name !== ROW_NAMES.badgeRing,
      );
    expect(keep(r.slide.elements).map(box)).toEqual(keep(whole.slide.elements).map(box));
  });

  test("a writer's label that misses still numbers every item, the placeholder aside", () => {
    const items = [...itemsOf(2), { name: "Kitten", text: "A young cat.", icon: "kitten" }];
    const r = layoutTemplate(row([...items, blankRowItem()]), T0, "ks2");
    expect(r.iconMisses).toEqual(["kitten"]);
    expect(r.slide.elements.filter((e) => e.type === "image")).toHaveLength(0);
    expect(named(r.slide.elements, ROW_NAMES.numeral)).toHaveLength(4);
  });

  test("the no-icons variant numbers each medal and draws no icon", () => {
    const r = layoutTemplate(row(itemsOf(4, false)), T0, "ks2");
    expect(r.slide.elements.filter((e) => e.type === "image")).toHaveLength(0);
    expect(named(r.slide.elements, ROW_NAMES.numeral)).toHaveLength(4);
  });
});

describe("connector", () => {
  const medalCentres = (els: SlideElement[]) =>
    named(els, ROW_NAMES.medal).map((e) => ({ x: e.x + e.w / 2, y: e.y + e.h / 2 }));

  test("by default one plain band per row in the theme's tint, no dots", () => {
    const r = layoutTemplate(row(itemsOf(3)), T0, "ks2");
    const paths = r.slide.elements.filter((e) => e.type === "path") as PathElement[];
    expect(paths.map((e) => e.name)).toEqual([ROW_NAMES.band]);
    expect(must(paths[0]).dash).toBeUndefined();
    expect(must(paths[0]).stroke).not.toBe(T0.colors.accent);
  });

  test("motif vessel: two paths per row through the medal centres, under the medals", () => {
    const r = layoutTemplate(row(itemsOf(3), { motif: "vessel" }), T0, "ks2");
    const els = r.slide.elements;
    const band = named(els, ROW_NAMES.band) as PathElement[];
    const dots = named(els, ROW_NAMES.dots) as PathElement[];
    expect(band).toHaveLength(1);
    expect(dots).toHaveLength(1);
    expect(must(dots[0]).dash).toBe("dotted");
    expect(must(dots[0]).dashGap).toBe(4.4);
    expect(els.indexOf(must(band[0]))).toBeLessThan(
      els.indexOf(must(named(els, ROW_NAMES.medal)[0])),
    );
    const p = must(band[0]);
    const abs = p.points.map((q) => ({ x: p.x + q.x * p.w, y: p.y + q.y * p.h }));
    for (const m of medalCentres(els))
      expect(abs.some((q) => Math.abs(q.x - m.x) <= 1 && Math.abs(q.y - m.y) <= 1)).toBe(true);
  });

  test("motif none draws no connector; icon rows of 5-6 sit medal beside text with none", () => {
    const none = layoutTemplate(row(itemsOf(3), { motif: "none" }), T0, "ks2");
    expect(none.slide.elements.filter((e) => e.type === "path")).toHaveLength(0);
    const plain = layoutTemplate(row(itemsOf(3), { motif: "plain" }), T0, "ks2");
    expect(plain.slide.elements.filter((e) => e.type === "path").map((e) => e.name)).toEqual([
      ROW_NAMES.band,
    ]);
    const beside = layoutTemplate(row(itemsOf(6)), T0, "ks2");
    expect(beside.slide.elements.filter((e) => e.type === "path")).toHaveLength(0);
    const numbered = layoutTemplate(row(itemsOf(6, false)), T0, "ks2");
    expect(numbered.slide.elements.filter((e) => e.type === "path")).toHaveLength(2);
  });
});

describe("line styles", () => {
  const paths = (motif: unknown) =>
    layoutTemplate(row(itemsOf(3), { motif: motif as never }), T0, "ks2").slide.elements.filter(
      (e) => e.type === "path",
    ) as PathElement[];

  test("river: a wide tint, a wash core and a dashed light line, in the theme's colours", () => {
    const p = paths("river");
    expect(p.map((e) => e.name)).toEqual([ROW_NAMES.band, ROW_NAMES.core, ROW_NAMES.dots]);
    expect(p[2]?.dash).toBe("dashed");
    expect(p[2]?.stroke).toBe(T0.colors.surface);
  });

  test("road: a warm grey road, never the accent, with a dashed centre line", () => {
    const p = paths("road");
    expect(p.map((e) => e.name)).toEqual([ROW_NAMES.band, ROW_NAMES.dots]);
    expect(p[0]?.stroke).not.toBe(T0.colors.accent);
    expect(p[1]?.dash).toBe("dashed");
  });

  test("stem: one green line and a leaf between neighbours and past each end", () => {
    const p = paths("stem");
    expect(p[0]?.stroke).toBe(STEM_GREEN);
    const els = layoutTemplate(row(itemsOf(3), { motif: "stem" }), T0, "ks2").slide.elements;
    const leaves = els.filter((e) => e.name === ROW_NAMES.leaf) as ShapeElement[];
    expect(leaves).toHaveLength(4);
    for (const l of leaves) {
      expect(l.shape).toBe("ellipse");
      expect(l.fill).toBe(STEM_GREEN);
      expect(l.x).toBeGreaterThanOrEqual(0);
      expect(l.x + l.w).toBeLessThanOrEqual(960);
    }
  });

  test("stem: the line and every leaf are green in every theme and stage, never the accent", () => {
    // The y/n review's "always green" option was a post-layout recolour in a shot script; the
    // product drew the stem in the accent, red in Paper. The colour is the layout's, not the shot's.
    for (const theme of THEMES)
      for (const stage of STAGES) {
        const els = layoutTemplate(row(itemsOf(4), { motif: "stem" }), theme, stage).slide.elements;
        const line = els.filter((e) => e.type === "path") as PathElement[];
        const leaves = els.filter((e) => e.name === ROW_NAMES.leaf) as ShapeElement[];
        expect(
          line.map((e) => e.stroke),
          `${theme.id} ${stage}`,
        ).toEqual([STEM_GREEN]);
        expect(leaves.length, `${theme.id} ${stage}`).toBe(5);
        for (const l of leaves) expect(l.fill, `${theme.id} ${stage}`).toBe(STEM_GREEN);
      }
  });

  test("stem: every leaf stands clear of every medal's halo in a one-row stem", () => {
    for (const n of [2, 3, 4]) {
      const els = layoutTemplate(row(itemsOf(n), { motif: "stem" }), T0, "ks2").slide.elements;
      const leaves = els.filter((e) => e.name === ROW_NAMES.leaf) as ShapeElement[];
      const halos = named(els, ROW_NAMES.ring) as ShapeElement[];
      expect(leaves.length).toBe(n + 1);
      for (const l of leaves) {
        // The rotated ellipse's left and right extent on the page.
        const a = ((l.rotation ?? 0) * Math.PI) / 180;
        const half = Math.hypot((l.w / 2) * Math.cos(a), (l.h / 2) * Math.sin(a));
        const cx = l.x + l.w / 2;
        for (const h of halos) {
          const clear = cx + half <= h.x - 2 || cx - half >= h.x + h.w + 2;
          expect(
            clear,
            `${n} items: leaf at ${cx.toFixed(0)}±${half.toFixed(0)} meets halo ${h.x}-${h.x + h.w}`,
          ).toBe(true);
        }
      }
    }
  });

  test("an unknown motif is plain", () => {
    expect(paths("lightning").map((e) => e.name)).toEqual([ROW_NAMES.band]);
    expect(motifOf("lightning")).toBe("plain");
    expect(motifOf("river")).toBe("river");
  });
});

describe("medals as in the gold", () => {
  test("white faces, no per-item colour ring, a tint halo, an ink badge", () => {
    const r = layoutTemplate(row(itemsOf(3)), T0, "ks2");
    const faces = named(r.slide.elements, ROW_NAMES.medal) as { fill?: string; stroke?: string }[];
    expect(faces.map((f) => f.fill)).toEqual(Array(3).fill(T0.colors.surface));
    expect(faces.every((f) => f.stroke === undefined)).toBe(true);
    const halos = named(r.slide.elements, ROW_NAMES.ring) as { fill?: string }[];
    expect(new Set(halos.map((h) => h.fill)).size).toBe(1);
    expect(halos[0]?.fill).not.toBe(T0.colors.background);
    const badges = named(r.slide.elements, ROW_NAMES.badge) as { fill?: string }[];
    expect(badges.map((b) => b.fill)).toEqual(Array(3).fill(T0.colors.ink));
  });
});

describe("the icon container follows the age profile (icon option 2)", () => {
  test("KS1 and KS2 keep the round medal on a tint halo", () => {
    for (const stage of ["ks1", "ks2"] as Stage[]) {
      const els = layoutTemplate(row(itemsOf(3)), T0, stage).slide.elements;
      const faces = named(els, ROW_NAMES.medal) as ShapeElement[];
      expect(faces.map((f) => f.shape)).toEqual(Array(3).fill("ellipse"));
      expect((named(els, ROW_NAMES.ring)[0] as ShapeElement).fill).not.toBe(T0.colors.background);
    }
  });

  test("KS3 to KS5: a rounded-square tile, no halo, the drawing 72% of the tile", () => {
    for (const stage of ["ks3", "ks4", "ks5"] as Stage[]) {
      const els = layoutTemplate(row(itemsOf(3)), T0, stage).slide.elements;
      const faces = named(els, ROW_NAMES.medal) as ShapeElement[];
      expect(
        faces.map((f) => f.shape),
        stage,
      ).toEqual(Array(3).fill("rounded"));
      for (const f of faces) {
        expect(f.radius, stage).toBe(Math.round(f.w * 0.2));
        expect(f.stroke, stage).toBeDefined();
      }
      const halos = named(els, ROW_NAMES.ring) as ShapeElement[];
      expect(halos.every((h) => h.fill === T0.colors.background && h.shape === "rounded")).toBe(
        true,
      );
      const face = must(faces[0]);
      const icon = must(named(els, ROW_NAMES.icon)[0]);
      expect(icon.w).toBe(Math.round(face.w * 0.72));
    }
  });

  test("without icons every age keeps round marks", () => {
    const els = layoutTemplate(row(itemsOf(3, false)), T0, "ks3").slide.elements;
    expect(els.filter((e) => e.type === "shape" && e.shape === "rounded")).toEqual([]);
  });
});

describe("over, fields and odd input", () => {
  test("an item past its hard maximum is named in over, every word kept", () => {
    const caps = rowCapsFor("primary", 3, { icons: true, lead: false });
    expect(caps).toBeDefined();
    const long = "word ".repeat(Math.ceil((must(caps).text.hardMax + 20) / 5)).trim();
    const items = itemsOf(3).map((it, i) => (i === 1 ? { ...it, text: long } : it));
    const r = layoutTemplate(row(items), T0, "ks2");
    expect(r.over).toContain("items[1].text");
    expect(words(r.slide.elements)).toContain(long);
    const f = r.fields?.find((x) => x.field === "items[1].text");
    expect(f?.over).toBe(true);
    expect(f?.path).toBe("items.1.text");
    expect(f?.cap).toBe(must(caps).text.cap);
  });

  test("a 5th item at early is over: items", () => {
    const r = layoutTemplate(row(itemsOf(5)), T0, "ks1");
    expect(r.over).toContain("items");
  });

  // Chat-edit r03: five items at KS2 have no comfortable cap (the caps table's 5-item cap is 0),
  // and the writer menu v4.4 says "2 to 4" at every age, so add stops at four everywhere.
  test("the most items is 4 at every age (the writer menu's 2 to 4); a 5th is over but still drawn", () => {
    expect(ROW_MAX).toEqual({ early: 4, primary: 4, secondary: 4 });
    for (const stage of ["ks2", "ks3"] as const) {
      const five = itemsOf(5);
      const r = layoutTemplate(row(five), T0, stage);
      expect(r.over).toContain("items");
      // Never silently dropped: an over-count row from before still shows every item.
      for (const it of five) expect(words(r.slide.elements)).toContain(it.name);
    }
  });

  test("accentWord colours an exact substring of the heading, and is ignored otherwise", () => {
    const r = layoutTemplate(row(itemsOf(3), { accentWord: "work together" }), T0, "ks2");
    const head = JSON.stringify(named(r.slide.elements, "Heading")[0]);
    expect(head).toContain(T0.colors.accent);
    const miss = layoutTemplate(row(itemsOf(3), { accentWord: "nowhere" }), T0, "ks2");
    expect(JSON.stringify(named(miss.slide.elements, "Heading")[0])).not.toContain("textStyle");
  });

  test("odd input never throws and out-of-range counts are reported", () => {
    const odd: TemplateInput[] = [
      { template: "items-row", heading: "" },
      row([]),
      row(itemsOf(1)),
      row([...ITEMS, ...ITEMS].slice(0, 7)),
      row([
        { name: "", text: "" },
        { name: "", text: "" },
      ]),
      row(itemsOf(3), { accentWord: "", lead: "\n\n" }),
    ];
    for (const theme of THEMES)
      for (const stage of ["ks1", "ks3", "ks5"] as Stage[])
        for (const input of odd) {
          const r = layoutTemplate(input, theme, stage);
          expect(Array.isArray(r.slide.elements)).toBe(true);
        }
    for (const n of [0, 1, 7])
      expect(layoutTemplate(row([...ITEMS, ...ITEMS].slice(0, n)), T0, "ks2").over).toContain(
        "items",
      );
  });
});

describe("capacity", () => {
  test("the table covers every age, count and variant", () => {
    const t = CAPACITY as Record<string, unknown[]>;
    expect(Object.keys(t).sort()).toEqual(Object.keys(ROW_CAP_GROUPS).sort());
    for (const age of Object.keys(ROW_CAP_GROUPS))
      for (const n of [2, 3, 4]) {
        const c = rowCapsFor(age as keyof typeof ROW_CAP_GROUPS, n, { icons: true, lead: false });
        // KS1 four with icons is the smallest: 20 characters at the scale's smallest reading step.
        expect(c?.text.cap ?? 0).toBeGreaterThanOrEqual(20);
        expect(must(c).text.hardMax).toBeGreaterThanOrEqual(must(c).text.cap);
      }
    // 5-6 are never comfortable: cap 0, but they still fit (hardMax).
    const five = rowCapsFor("primary", 5, { icons: true, lead: false });
    expect(five?.text.cap).toBe(0);
    expect(five?.text.hardMax ?? 0).toBeGreaterThan(0);
  });

  test("spot check: the cap is the renderer's measurement (comfortable at cap, not at cap + 4)", () => {
    for (const age of ["early", "primary", "secondary"] as const)
      for (const n of [2, 4]) {
        const c = must(rowCapsFor(age, n, { icons: true, lead: false }));
        expect(rowFitsAt(age, n, { icons: true, lead: false }, "text", c.text.cap, "comfort")).toBe(
          true,
        );
        expect(
          rowFitsAt(age, n, { icons: true, lead: false }, "text", c.text.cap + 2, "comfort"),
        ).toBe(false);
      }
  });
});

/* Writer-real findings (12 Oct): the lead's edge, body size, unordered marks, uneven items. */
describe("real writer output", () => {
  const VOLC: RowItem[] = [
    { name: "Subduction", text: "An oceanic plate moves beneath another plate." },
    { name: "Melting", text: "Water released from the sinking plate helps mantle rock melt." },
    { name: "Rising", text: "Magma rises through the overlying plate." },
    { name: "Eruptions", text: "Repeated eruptions can build a volcano." },
  ];

  test("the lead starts at the heading's left edge, as wide", () => {
    const r = layoutTemplate(row(itemsOf(3), { lead: "How blood moves." }), T0, "ks2");
    const head = must(named(r.slide.elements, "Heading")[0]);
    const lead = must(named(r.slide.elements, ROW_NAMES.lead)[0]);
    expect(lead.x).toBe(head.x);
    expect(lead.w).toBe(head.w);
  });

  test("body starts at the stage's reading size; medals give way before the text does", () => {
    for (const stage of ["ks2", "ks3"] as Stage[]) {
      const read = templateScale(T0, stage).body;
      const short = layoutTemplate(row(itemsOf(3)), T0, stage);
      for (const e of named(short.slide.elements, ROW_NAMES.text)) expect(sizeOf(e)).toBe(read);
      const r = layoutTemplate(row(VOLC, { ordered: true }), T0, stage);
      const body = Math.min(...named(r.slide.elements, ROW_NAMES.text).map(sizeOf));
      expect(body).toBeGreaterThanOrEqual(MIN_FONT_SIZE.body);
      const prof = GOLD_PROFILES[ageProfileOf(stage)];
      const medal = must(named(r.slide.elements, ROW_NAMES.medal)[0]).w;
      // Type below the reading size only once the medal is at its smallest (40% of the age's medal).
      if (body < read) expect(medal).toBeLessThanOrEqual(Math.round(prof.medal * 0.4) + 1);
    }
  });

  test("unordered with no icons: a neutral mark, never numbers; ordered: numbers", () => {
    const off = layoutTemplate(row(VOLC, { ordered: false }), T0, "ks3");
    expect(named(off.slide.elements, ROW_NAMES.numeral)).toHaveLength(0);
    expect(named(off.slide.elements, ROW_NAMES.mark)).toHaveLength(4);
    const on = layoutTemplate(row(VOLC, { ordered: true }), T0, "ks3");
    expect(named(on.slide.elements, ROW_NAMES.numeral)).toHaveLength(4);
  });

  test("uneven items: names top-aligned in each row, text clear of the line", () => {
    for (const items of [VOLC, itemsOf(6)]) {
      const r = layoutTemplate(row(items, { ordered: true }), T0, "ks2");
      const names = named(r.slide.elements, ROW_NAMES.name);
      const medals = named(r.slide.elements, ROW_NAMES.medal);
      const rows = new Map<number, number[]>();
      medals.forEach((m, i) => {
        const key = Math.round(m.y / 20);
        rows.set(key, [...(rows.get(key) ?? []), must(names[i]).y]);
      });
      for (const ys of rows.values()) expect(new Set(ys).size).toBe(1);
      const lines = r.slide.elements.filter((e) => e.name === ROW_NAMES.band);
      for (const t of named(r.slide.elements, ROW_NAMES.text))
        for (const l of lines) expect(t.y).toBeGreaterThan(l.y + l.h / 2);
    }
  });

  test("a name that wraps: every line in the row still starts level, under every name", () => {
    // smoke-v4 y8 s4: "Plates separate" wrapped to two lines and its line sat lower than the rest.
    const PLATES: RowItem[] = [
      { name: "Plates separate", text: "Pressure beneath them falls." },
      { name: "Mantle melts", text: "Some hot mantle rock melts, forming magma." },
      { name: "Magma rises", text: "It rises through cracks to the surface." },
      { name: "New rock", text: "Lava cools, building volcanoes and new crust." },
    ];
    for (const stage of STAGES)
      for (const items of [PLATES, VOLC]) {
        const r = layoutTemplate(row(items, { ordered: true }), T0, stage);
        const names = named(r.slide.elements, ROW_NAMES.name);
        const texts = named(r.slide.elements, ROW_NAMES.text);
        expect(new Set(texts.map((t) => t.y)).size).toBe(1);
        expect(new Set(names.map((t) => t.y)).size).toBe(1);
        const lineTop = must(texts[0]).y;
        for (const nm of names) expect(nm.y + nm.h).toBeLessThanOrEqual(lineTop + 0.5);
      }
  });
});

describe("measured at the size the browser draws", () => {
  // The renderer snaps a stored size to the key stage's scale (never under the role's smallest
  // step). The row once measured at 24.8 pt while KS1 drew 28, so a writer's KS1 mummy row
  // wrapped a line more in the browser than the layout allowed for, and the frame clipped it.
  test("every text box stores the size the renderer draws, on every theme, age and count", () => {
    const faults: string[] = [];
    for (const theme of THEMES)
      for (const stage of STAGES) {
        const drawnTheme = getTheme(theme.id, stage);
        for (let n = 2; n <= (stage === "ks1" ? 4 : 6); n++)
          for (const icons of [true, false])
            for (const lead of [undefined, "How the body moves blood."]) {
              const r = layoutTemplate(row(itemsOf(n, icons), lead ? { lead } : {}), theme, stage);
              for (const e of r.slide.elements) {
                if (e.type !== "text" || e.style.fontSize === undefined) continue;
                const drawn = resolveTextStyle(e.style, drawnTheme, e.style.preset).fontSize;
                if (Math.abs(drawn - e.style.fontSize) > 0.05)
                  faults.push(`${theme.id} ${stage} ${n} ${e.name} ${e.style.fontSize}->${drawn}`);
              }
            }
      }
    expect(faults.slice(0, 10)).toEqual([]);
  });
});

describe("two rows never overlap", () => {
  // Chat-edit r03 (a writer's KS2 mummy row, a fifth step added): the second row was placed under
  // lines measured a size smaller than drawn, so a third line ran into the medal below it.
  test("no item's words touch a medal or icon, at KS2 and KS3, 5 and 6 items, over or not", () => {
    const faults: string[] = [];
    const hit = (a: SlideElement, b: SlideElement) =>
      a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (const theme of THEMES)
      for (const stage of ["ks2", "ks3"] as const)
        for (const n of [5, 6])
          for (const icons of [true, false])
            for (const short of [true, false]) {
              const r = layoutTemplate(row(itemsOf(n, icons, short)), theme, stage);
              const words = r.slide.elements.filter(
                (e) => e.type === "text" && e.name !== "Heading",
              );
              const marks = r.slide.elements.filter(
                (e) => e.type !== "text" && e.type !== "path" && e.w < 400,
              );
              for (const w of words)
                for (const m of marks)
                  if (hit(w, m)) faults.push(`${theme.id} ${stage} ${n} ${w.name} x ${m.name}`);
            }
    expect(faults.slice(0, 10)).toEqual([]);
  });
});
