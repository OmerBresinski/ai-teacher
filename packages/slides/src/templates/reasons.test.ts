import { describe, expect, test } from "bun:test";
import type { SlideElement } from "@tj/domain/documents";
import * as ICONS from "../icons";
import { v2Colors } from "../theme-v2";
import { atKeyStage, THEMES } from "../themes";
import { layoutTemplate, type Stage, type TemplateInput } from "./index";
import { panelLook } from "./panel-list-deps";
import {
  REASON_NAMES,
  REASON_PENDING_ICON,
  type ReasonItem,
  reasonsCapsFor,
  reasonsPaths,
} from "./reasons";
import { measureReasonsCaps } from "./reasons-capacity";
import CAPACITY from "./reasons-capacity.json";
import { REASONS_CASES } from "./reasons-fixtures";

/*
 * TEACH-75 part ad (C5, ruling 225): a "why?" question opens 2-4 reasons one per click, with a
 * consequence-chain look. Gold: northstars-v13/reasons (the bare look).
 */
ICONS.provideIcons(ICONS);
const theme = THEMES[0] as (typeof THEMES)[number];
const lay = (input: TemplateInput, stage: Stage = "ks2") => layoutTemplate(input, theme, stage);
const named = (els: SlideElement[], name: string) => els.filter((e) => e.name === name);
const step = (e: SlideElement) => e.revealStep ?? 0;
const caseOf = (name: string) => {
  const k = REASONS_CASES.find((c) => c.name === name);
  if (!k) throw new Error(name);
  return k;
};
const SHORT: ReasonItem[] = [
  { head: "To stand up", line: "Without water, a plant droops.", icon: "without-water" },
  { head: "To grow", line: "Water helps a plant grow.", icon: "growth-over-time" },
  { head: "To make food", line: "Leaves use water.", icon: "leaf" },
  { head: "To stay cool", line: "Water cools the leaves.", icon: "thermometer" },
];
const reasons = (n: number, chain = false, over: Partial<ReasonItem> = {}): TemplateInput => ({
  template: "reasons",
  heading: "Why do plants need water?",
  chain,
  reasons: SHORT.slice(0, n).map((r) => ({ ...r, ...over })),
});

describe("reasons: the fan and its reveal", () => {
  test("before the first click: the question and a grey line and dot per reason, nothing else", () => {
    const { input, stage } = caseOf("sweat");
    const els = lay(input, stage).slide.elements;
    const s0 = els.filter((e) => step(e) === 0).map((e) => e.name);
    expect(s0.filter((n) => n === REASON_NAMES.wireOff)).toHaveLength(3);
    expect(s0.filter((n) => n === REASON_NAMES.dotOff)).toHaveLength(3);
    expect(s0).toContain(REASON_NAMES.question);
    for (const n of [
      REASON_NAMES.head,
      REASON_NAMES.text,
      REASON_NAMES.icon,
      REASON_NAMES.wire,
      REASON_NAMES.dot,
    ])
      expect(s0).not.toContain(n);
  });

  test("each click reveals one reason: its head, line, icon, accent line and dot, over the grey", () => {
    const { input, stage } = caseOf("sweat");
    const els = lay(input, stage).slide.elements;
    expect(Math.max(...els.map(step))).toBe(3);
    for (const k of [1, 2, 3]) {
      const at = els
        .filter((e) => step(e) === k)
        .map((e) => e.name)
        .sort();
      expect(at).toEqual(
        [
          REASON_NAMES.dot,
          REASON_NAMES.head,
          REASON_NAMES.icon,
          REASON_NAMES.text,
          REASON_NAMES.wire,
        ].sort(),
      );
    }
    // The accent line lies exactly on its grey placeholder, so nothing jumps.
    const off = named(els, REASON_NAMES.wireOff);
    const on = named(els, REASON_NAMES.wire);
    for (const [i, e] of on.entries())
      expect([e.x, e.y, e.w, e.h]).toEqual([
        off[i]?.x,
        off[i]?.y,
        off[i]?.w,
        off[i]?.h,
      ] as number[]);
  });

  test("every fan line starts at one point on the panel edge, level with the question", () => {
    const { input, stage } = caseOf("rome");
    const els = lay(input, stage).slide.elements;
    const panel = named(els, REASON_NAMES.panel)[0] as SlideElement;
    const q = named(els, REASON_NAMES.question)[0] as SlideElement;
    for (const w of named(els, REASON_NAMES.wire) as (SlideElement & {
      points: { x: number; y: number }[];
    })[]) {
      const p0 = w.points[0] as { x: number; y: number };
      expect(w.x + p0.x * w.w).toBeCloseTo(panel.x + panel.w, 0);
      const y0 = w.y + p0.y * w.h;
      expect(y0).toBeGreaterThan(q.y);
      expect(y0).toBeLessThan(q.y + q.h);
    }
  });

  test("colours are theme roles: the sand panel, the accent for lines, dots and arrows; no literals", () => {
    for (const stage of ["ks1", "ks2", "ks3"] as Stage[])
      for (const th of THEMES) {
        const t = atKeyStage(th, stage);
        const col = v2Colors(t);
        const L = panelLook(t);
        const els = layoutTemplate(caseOf("fire").input, th, stage).slide.elements.concat(
          layoutTemplate(caseOf("sweat").input, th, stage).slide.elements,
        );
        for (const e of els as (SlideElement & { fill?: string; stroke?: string })[]) {
          if (e.name === REASON_NAMES.panel) expect(e.fill).toBe(col.sand);
          if ([REASON_NAMES.wire, REASON_NAMES.dot, REASON_NAMES.arrow].includes(e.name as never))
            expect((e.stroke ?? e.fill)?.toUpperCase()).toBe(col.accent.toUpperCase());
          if (e.type === "text") expect([L.ink, L.muted]).toContain(e.style.color as string);
        }
      }
  });
});

describe("reasons: the chain", () => {
  test("no fan; a closed block arrow into each link after the first, accent on that link's click", () => {
    const { input, stage } = caseOf("fireKs1");
    const els = lay(input, stage).slide.elements;
    expect(named(els, REASON_NAMES.wire)).toHaveLength(0);
    expect(named(els, REASON_NAMES.wireOff)).toHaveLength(0);
    const arrows = named(els, REASON_NAMES.arrow) as (SlideElement & { closed?: boolean })[];
    expect(arrows).toHaveLength(2);
    expect(arrows.map(step)).toEqual([2, 3]);
    for (const a of arrows) expect(a.closed).toBe(true);
    expect(named(els, REASON_NAMES.arrowOff).map(step)).toEqual([0, 0]);
    // The links step down and to the right.
    const heads = named(els, REASON_NAMES.head);
    for (let i = 1; i < heads.length; i++) {
      expect((heads[i] as SlideElement).x).toBeGreaterThan((heads[i - 1] as SlideElement).x);
      expect((heads[i] as SlideElement).y).toBeGreaterThan((heads[i - 1] as SlideElement).y);
    }
  });

  test("a fourth link only when every line is 35 characters or fewer", () => {
    expect(lay(reasons(4, true), "ks3").over).not.toContain("reasons 4/3");
    const long = lay(
      reasons(4, true, { line: "A long line that runs well past thirty-five characters." }),
      "ks3",
    );
    expect(long.over).toContain("reasons 4/3");
  });
});

describe("reasons: counts, caps and over (never truncated)", () => {
  test("KS1 takes 2-3; a fourth is over, every field at the 0 cap is over, and all four still draw", () => {
    const r = lay(reasons(4), "ks1");
    expect(r.over).toContain("reasons 4/3");
    const items = (r.fields ?? []).filter((f) => f.field.startsWith("reasons["));
    expect(items.length).toBe(8);
    for (const f of items) {
      expect(f.hardMax).toBe(0);
      expect(f.over).toBe(true);
    }
    expect(named(r.slide.elements, REASON_NAMES.head)).toHaveLength(4);
  });

  test("one reason and five reasons are over at every age; the words are kept", () => {
    for (const stage of ["ks1", "ks2", "ks3"] as Stage[]) {
      expect(lay(reasons(1), stage).over.some((o) => o.startsWith("reasons 1/"))).toBe(true);
      const five = { ...reasons(4), reasons: [...SHORT, SHORT[0] as ReasonItem] };
      const r = lay(five, stage);
      expect(r.over.some((o) => o.startsWith("reasons 5/"))).toBe(true);
      expect(named(r.slide.elements, REASON_NAMES.head)).toHaveLength(5);
    }
  });

  test("a line past its hard maximum is over and drawn whole", () => {
    const line =
      "Plants pull water up from the soil through their roots and stems into every single leaf, and when the sun is hot the water leaves through tiny holes.";
    const input = {
      ...reasons(3),
      reasons: SHORT.slice(0, 3).map((r, i) => (i ? r : { ...r, line })),
    };
    const r = lay(input, "ks2");
    expect(r.over).toContain("reasons[0].line");
    const text = named(r.slide.elements, REASON_NAMES.text)[0] as SlideElement & { doc: unknown };
    expect(JSON.stringify(text.doc)).toContain("every single leaf, and when the sun is hot");
  });

  test("the gold's own cases fit at KS2 and KS3 (rome, sweat, plants, romeLong)", () => {
    for (const name of ["rome", "sweat", "plants", "romeLong", "romeNoIcon", "sweatNoIcon"]) {
      const { input, stage } = caseOf(name);
      expect({ name, over: lay(input, stage).over }).toEqual({ name, over: [] });
    }
  });

  test("the table is the renderer: every cell re-measures to what is stored", () => {
    for (const age of ["early", "primary", "secondary"] as const)
      for (const [chain, n] of [
        [false, 2],
        [false, 3],
        [false, 4],
        [true, 3],
        [true, 4],
      ] as const)
        expect(measureReasonsCaps(age, chain, n)).toEqual(
          (CAPACITY as Record<string, Record<string, unknown>>)[age]?.[
            `${chain ? "chain" : "reasons"}-${n}`
          ] as never,
        );
  });

  test("a cap is never over its hard maximum, and a count the layout refuses is all 0", () => {
    for (const age of ["early", "primary", "secondary"] as const)
      for (const [chain, n] of [
        [false, 2],
        [false, 3],
        [false, 4],
        [true, 3],
        [true, 4],
      ] as const) {
        const c = reasonsCapsFor(age, chain, n);
        for (const f of Object.values(c ?? {})) expect(f.cap).toBeLessThanOrEqual(f.hardMax);
      }
    expect(reasonsCapsFor("early", false, 4)?.line).toEqual({ cap: 0, hardMax: 0 });
  });
});

describe("reasons: icons all or none, and the editor's paths", () => {
  test("one icon the library misses drops every icon; the miss is reported", () => {
    const r = lay(caseOf("romeNoIcon").input, "ks3");
    expect(named(r.slide.elements, REASON_NAMES.icon)).toHaveLength(0);
    expect(r.iconMisses).toContain("roman-coin-hoard");
  });

  test("a held icon (a draft's) keeps the icon layout and draws nothing for it", () => {
    const input = reasons(3);
    const held = {
      ...input,
      reasons: (input.reasons ?? []).map((r, i) =>
        i === 2 ? { ...r, icon: REASON_PENDING_ICON } : r,
      ),
    };
    const a = lay(input).slide.elements;
    const b = lay(held).slide.elements;
    expect(named(b, REASON_NAMES.icon)).toHaveLength(2);
    expect(named(b, REASON_NAMES.head).map((e) => e.x)).toEqual(
      named(a, REASON_NAMES.head).map((e) => e.x),
    );
  });

  test("paths bind the question, lead, and each reason's head and line", () => {
    const els = lay(caseOf("sweat").input).slide.elements;
    const paths = reasonsPaths(els).filter(Boolean);
    expect(paths).toEqual([
      "heading",
      "lead",
      "reasons.0.head",
      "reasons.0.line",
      "reasons.1.head",
      "reasons.1.line",
      "reasons.2.head",
      "reasons.2.line",
    ]);
  });
});
