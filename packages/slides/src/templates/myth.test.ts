import { describe, expect, test } from "bun:test";
import {
  type Slide,
  type SlideElement,
  slideStepCount,
  type TextElement,
} from "@tj/domain/documents";
import { contrastRatio } from "../colour-contrast";
import * as ICONS from "../icons";
import { provideIcons } from "../icons/loader";
import { resolveTextStyle } from "../text-style";
import { v2Colors } from "../theme-v2";
import { atKeyStage, getTheme, THEMES } from "../themes";
import { surfacesOf } from "../themes/surfaces";
import { layoutTemplate, type Stage, type TemplateInput } from "./index";
import { MYTH_NAMES, withMythCaps, withoutMythCaps } from "./myth";
import { measureMythCaps } from "./myth-capacity";
import CAPS from "./myth-capacity.json" with { type: "json" };
import { MYTH_CASES } from "./myth-fixtures";

/*
 * TEACH-75 part ag (G1): myth and fact, the myth-c gold (rulings 224, 238, 245, 247).
 */
provideIcons(ICONS as never);
const paper = getTheme("paper");
const lay = (input: TemplateInput, stage: Stage = "ks2", theme = paper) =>
  layoutTemplate(input, theme, stage);
const named = (els: readonly SlideElement[], name: string) => els.filter((e) => e.name === name);
const one = (els: readonly SlideElement[], name: string) => {
  const found = named(els, name);
  expect(found).toHaveLength(1);
  return found[0] as SlideElement;
};
const textOf = (el: SlideElement) =>
  ((el as TextElement).doc.content ?? [])
    .flatMap((p) => p.content ?? [])
    .map((n) => n.text ?? "")
    .join("");
const runAttrs = (el: SlideElement) =>
  ((el as TextElement).doc.content?.[0]?.content ?? []).map(
    (n) => (n.marks ?? []).find((m) => m.type === "textStyle")?.attrs ?? {},
  );
/** Fact bottom to the proof row's top, in gold px (1440 wide). */
const clearance = (els: readonly SlideElement[]) => {
  const fact = one(els, MYTH_NAMES.fact);
  const line = one(els, MYTH_NAMES.line);
  const icon = named(els, MYTH_NAMES.icon)[0];
  const proofTop = Math.min(line.y, icon?.y ?? Number.POSITIVE_INFINITY);
  return Math.round((proofTop - (fact.y + fact.h)) * 1.5 * 100) / 100;
};
const caseOf = (name: string) => {
  const k = MYTH_CASES.find((c) => c.name === name);
  if (!k) throw new Error(name);
  return k;
};

describe("myth and fact: the gold cases (myth-c)", () => {
  for (const k of MYTH_CASES)
    test(`${k.name} at ${k.stage}: every word drawn, over only where the caps say`, () => {
      const r = lay(k.input, k.stage);
      const m = k.input.myth as NonNullable<TemplateInput["myth"]>;
      const els = r.slide.elements;
      // The gold's own words, whole (never cut to fit).
      expect(textOf(one(els, MYTH_NAMES.claim))).toBe(m.claim);
      expect(textOf(one(els, MYTH_NAMES.fact))).toBe(m.fact);
      // The 18-word cap test fits at KS2 since the fact takes the gold's 660px measure (part h).
      expect(r.over).toEqual([]);
    });

  test("vote: three clicks (card, verdict, fact); straight: two", () => {
    const vote = lay(caseOf("y6-falling").input);
    const straight = lay(caseOf("y6-falling-straight").input);
    expect(slideStepCount({ id: "v", ...vote.slide } as Slide)).toBe(2);
    expect(slideStepCount({ id: "s", ...straight.slide } as Slide)).toBe(1);
    const v = vote.slide.elements;
    expect(one(v, MYTH_NAMES.claimOpen).revealStep).toBeUndefined();
    expect(named(v, MYTH_NAMES.chip)).toHaveLength(2);
    expect(one(v, MYTH_NAMES.cover).revealStep).toBe(1);
    expect(one(v, MYTH_NAMES.claim).revealStep).toBe(1);
    expect(one(v, MYTH_NAMES.fact).revealStep).toBe(2);
    expect(one(v, MYTH_NAMES.line).revealStep).toBe(2);
    expect(named(v, MYTH_NAMES.icon).every((e) => e.revealStep === 2)).toBe(true);
    // The verdict's ground and panel cover the whole card: nothing of step 0 shows at step 1.
    const card = one(v, MYTH_NAMES.card);
    const ground = one(v, MYTH_NAMES.cover);
    const panel = one(v, MYTH_NAMES.panel);
    expect(panel.x).toBeLessThanOrEqual(card.x);
    expect(ground.x).toBeLessThanOrEqual(panel.x + panel.w);
    expect(ground.x + ground.w).toBeGreaterThanOrEqual(card.x + card.w);
    expect(Math.min(ground.y, panel.y)).toBeLessThanOrEqual(card.y);
    expect(Math.min(ground.y + ground.h, panel.y + panel.h)).toBeGreaterThanOrEqual(
      card.y + card.h,
    );
    expect(v.indexOf(ground)).toBeGreaterThan(v.indexOf(card));
    // Straight: no card, no chips; the verdict from the start, the fact on the one click.
    const s = straight.slide.elements;
    expect(named(s, MYTH_NAMES.card)).toHaveLength(0);
    expect(named(s, MYTH_NAMES.chip)).toHaveLength(0);
    expect(one(s, MYTH_NAMES.claim).revealStep).toBeUndefined();
    expect(one(s, MYTH_NAMES.fact).revealStep).toBe(1);
  });

  test("the vote never counts as the lesson's check: no question, a content slide", () => {
    for (const k of MYTH_CASES) {
      const r = lay(k.input, k.stage);
      expect(r.slide.question).toBeUndefined();
      expect(r.slide.kind).toBe("content");
    }
  });

  test("the myth strike rides the verdict's click; a true claim is never struck", () => {
    const myth = runAttrs(one(lay(caseOf("y6-falling").input).slide.elements, MYTH_NAMES.claim));
    // Round 4 'myth strike': the claim is upright in the body face, never the italic quote face.
    expect(myth).toEqual([{ strikeStep: 1 }]);
    const straight = lay(caseOf("y6-falling-straight").input).slide.elements;
    expect(runAttrs(one(straight, MYTH_NAMES.claim))).toEqual([{ strikeStep: 0 }]);
    const honey = lay(caseOf("y5-honey-true").input).slide.elements;
    expect(runAttrs(one(honey, MYTH_NAMES.claim))).toEqual([{}]);
    // Step 0 is the same for both verdicts: nothing gives the answer away.
    expect(runAttrs(one(honey, MYTH_NAMES.claimOpen))).toEqual([{}]);
    expect(textOf(one(honey, MYTH_NAMES.stamp))).toContain("TRUE");
    expect(textOf(one(honey, MYTH_NAMES.factLabel))).toContain("WHY IT’S TRUE");
    const c = v2Colors(atKeyStage(paper, "ks2"));
    expect((one(honey, MYTH_NAMES.claim) as TextElement).style.color).toBe(c.ink);
  });

  test("proof patterns: icons, picture, line alone, failed picture, none; a missed icon is dropped", () => {
    const base = caseOf("y6-falling").input;
    const m = base.myth as NonNullable<TemplateInput["myth"]>;
    const icons = lay(base).slide.elements;
    expect(named(icons, MYTH_NAMES.icon)).toHaveLength(2);
    expect(named(icons, MYTH_NAMES.icon).every((e) => e.type === "image" && !!e.src)).toBe(true);
    const pic = lay(caseOf("y7-deserts").input, "ks3").slide.elements;
    expect(named(pic, MYTH_NAMES.picture)).toHaveLength(1);
    const nopic = lay(caseOf("y7-deserts-nopic").input, "ks3").slide.elements;
    expect(named(nopic, MYTH_NAMES.picture)).toHaveLength(0);
    expect(named(nopic, MYTH_NAMES.line)).toHaveLength(1);
    const line = lay(caseOf("y8-plants").input, "ks3").slide.elements;
    expect(named(line, MYTH_NAMES.icon).length + named(line, MYTH_NAMES.picture).length).toBe(0);
    const none = lay({ ...base, myth: { ...m, proof: null } }).slide.elements;
    expect(named(none, MYTH_NAMES.line)).toHaveLength(0);
    expect(named(none, MYTH_NAMES.fact)).toHaveLength(1);
    const miss = lay({
      ...base,
      myth: { ...m, proof: { line: m.proof?.line ?? "", icons: ["hammer", "zzq-no-such-icon"] } },
    });
    expect(named(miss.slide.elements, MYTH_NAMES.icon)).toHaveLength(1);
    expect(miss.iconMisses).toEqual(["zzq-no-such-icon"]);
  });

  test("the fact grows to fill (gold growMyth) and the claim follows it, upright in the body face", () => {
    const px = (pt: number | undefined) => Math.round((pt ?? 0) * 1.5);
    for (const t of THEMES) {
      const els = lay(caseOf("y6-falling").input, "ks2", t).slide.elements;
      const fact = one(els, MYTH_NAMES.fact) as TextElement;
      const claim = one(els, MYTH_NAMES.claim) as TextElement;
      // The gold's 52px on its own content, drawn as given (off the stage's steps).
      expect(px(fact.style.fontSize)).toBe(52);
      expect(fact.style.fixedSize).toBe(true);
      expect(claim.style.fontSize).toBe(fact.style.fontSize);
      expect(claim.style.fixedSize).toBe(true);
      expect(claim.style.fontFamily).toBe(atKeyStage(t, "ks2").fonts.body);
      expect(claim.style.fontWeight).toBe(surfacesOf(t).marks.claimWeight ?? 600);
      expect(clearance(els)).toBeGreaterThanOrEqual(48);
    }
  });

  test("KS1: the gold's grow (no age branch) on the early case, claim at the fact's size", () => {
    for (const t of THEMES) {
      const els = lay(caseOf("y2-falling").input, "ks1", t).slide.elements;
      const fact = one(els, MYTH_NAMES.fact) as TextElement;
      const size = Math.round((fact.style.fontSize ?? 0) * 1.5);
      // On the gold's 2px grid, grown past KS1's 45pt step and no more than its 64px.
      expect(size % 2).toBe(0);
      expect(size).toBeGreaterThanOrEqual(50);
      expect(size).toBeLessThanOrEqual(64);
      expect((one(els, MYTH_NAMES.claim) as TextElement).style.fontSize).toBe(fact.style.fontSize);
      expect(clearance(els)).toBeGreaterThanOrEqual(48);
    }
  });

  test("a short fact stops at the gold's 64px ceiling (render5 growMyth `while (f < 64)`)", () => {
    const short = {
      template: "myth",
      heading: "Ice",
      myth: { opening: "straight", claim: "Ice sinks.", fact: "Ice floats.", proof: null },
    } as TemplateInput;
    for (const t of THEMES)
      for (const st of ["ks1", "ks2", "ks3"] as Stage[]) {
        const els = lay(short, st, t).slide.elements;
        const fact = one(els, MYTH_NAMES.fact) as TextElement;
        expect(Math.round((fact.style.fontSize ?? 0) * 1.5)).toBe(64);
        expect((one(els, MYTH_NAMES.claim) as TextElement).style.fontSize).toBe(
          fact.style.fontSize,
        );
      }
  });

  test("every case, theme and stage: the claim is the fact's size and the fact stays in its panel", () => {
    for (const k of MYTH_CASES)
      for (const t of THEMES)
        for (const st of ["ks1", "ks2", "ks3"] as Stage[]) {
          const els = lay(k.input, st, t).slide.elements;
          const fact = one(els, MYTH_NAMES.fact) as TextElement;
          const claim = one(els, MYTH_NAMES.claim) as TextElement;
          expect(claim.style.fontSize).toBe(fact.style.fontSize);
          const panel = one(els, MYTH_NAMES.factPanel);
          expect(fact.y + fact.h).toBeLessThanOrEqual(panel.y + panel.h);
          expect(fact.x + fact.w).toBeLessThanOrEqual(panel.x + panel.w);
          // The panel claim stays above the foot (810 - 84 px).
          expect((claim.y + claim.h) * 1.5).toBeLessThanOrEqual(726 + 1);
        }
  });

  test("the seam takes the theme's marker colours (C13)", () => {
    for (const t of THEMES) {
      const els = lay(caseOf("y6-falling").input, "ks2", t).slide.elements;
      const m = surfacesOf(t).roles.marker;
      expect((one(els, MYTH_NAMES.seam) as { fill?: string }).fill).toBe(m.fill);
      const arrow = one(els, MYTH_NAMES.seamArrow) as { fill?: string; stroke?: string };
      expect(arrow.stroke).toBe(m.ink as string);
    }
  });

  test("the seam arrow reads on its disc at 4.5:1 in every theme and stage", () => {
    for (const t of THEMES)
      for (const st of ["ks1", "ks2", "ks3"] as Stage[]) {
        const els = lay(caseOf("y6-falling").input, st, t).slide.elements;
        const fill = (one(els, MYTH_NAMES.seam) as { fill?: string }).fill as string;
        const ink = (one(els, MYTH_NAMES.seamArrow) as { stroke?: string }).stroke as string;
        expect(contrastRatio(ink, fill)).toBeGreaterThanOrEqual(4.5);
      }
  });

  test("KS1: the medals give way before the fact goes over", () => {
    const r = lay(caseOf("y2-falling").input, "ks1");
    expect(r.over).toEqual([]);
    const fact = one(r.slide.elements, MYTH_NAMES.fact);
    const line = one(r.slide.elements, MYTH_NAMES.line);
    expect(fact.y + fact.h).toBeLessThanOrEqual(line.y);
  });
});

describe("myth and fact: caps and fit", () => {
  test("a cap of 0 reports over, never no cap", () => {
    const k = caseOf("y6-falling").input;
    const m = k.myth as NonNullable<TemplateInput["myth"]>;
    // Early with a picture holds fewer fact words than primary; empty claim and fact are over.
    const empty = lay({ ...k, myth: { ...m, claim: "", fact: "" } });
    expect(empty.over).toEqual(expect.arrayContaining(["myth.claim", "myth.fact"]));
    const long = lay({ ...k, myth: { ...m, fact: `${"word ".repeat(40).trim()}.` } });
    expect(long.over).toContain("myth.fact");
    // Drawn whole: every word is in the box.
    expect(textOf(one(long.slide.elements, MYTH_NAMES.fact)).split("word").length - 1).toBe(40);
    for (const age of ["early", "primary", "secondary"] as const)
      for (const cell of Object.values(CAPS[age])) {
        expect(cell.cap).toBeLessThanOrEqual(cell.hardMax);
        expect(cell.hardMax).toBeGreaterThan(0);
      }
  });

  test("an age or a field with no caps row is over, never no cap", () => {
    const k = caseOf("y6-falling").input;
    // No row for the age at all: every field with words is over.
    const noAge = withMythCaps({ secondary: CAPS.secondary }, () => lay(k, "ks2"));
    expect(noAge.over).toEqual(
      expect.arrayContaining(["heading", "myth.claim", "myth.fact", "myth.proof.line"]),
    );
    // The age's row without the proof field: only the proof line is over.
    const { proof: _p, ...rest } = CAPS.primary;
    const noProof = withMythCaps({ primary: rest as typeof CAPS.primary }, () => lay(k, "ks2"));
    expect(noProof.over).toEqual(["myth.proof.line"]);
    expect(lay(k, "ks2").over).toEqual([]);
  });

  test("the caps table is what the renderer measures", () => {
    expect(withoutMythCaps(() => measureMythCaps())).toEqual(CAPS as never);
  }, 120_000);

  test("every stored size is the drawn size at the stage, and at or over the floor", () => {
    for (const k of MYTH_CASES) {
      const theme = atKeyStage(paper, k.stage);
      for (const e of lay(k.input, k.stage).slide.elements)
        if (e.type === "text") {
          const style = e.style;
          expect(resolveTextStyle(style, theme, style.preset).fontSize).toBe(style.fontSize ?? 0);
          expect(style.fontSize ?? 0).toBeGreaterThanOrEqual(20);
        }
    }
  });

  test("every theme: no literal colour outside the theme's own roles, nothing over", () => {
    const k = caseOf("y6-falling").input;
    for (const t of THEMES)
      for (const stage of ["ks1", "ks2", "ks3"] as Stage[]) {
        const r = lay(k, stage, t);
        expect(r.over).toEqual([]);
        const c = v2Colors(atKeyStage(t, stage));
        const known = new Set(
          [
            c.background,
            c.surface,
            c.ink,
            c.muted,
            c.accent,
            c.deep,
            c.onDeep,
            ...c.fields,
            // The seam is the theme's marker (`marker-fill`, its arrow `marker-ink`, C13).
            surfacesOf(t).roles.marker.fill,
            surfacesOf(t).roles.marker.ink ?? c.onDeep,
            // The theme's own emphasis token (Geometric #1842B8), when it sets one.
            ...(surfacesOf(t).marks.emphasis ? [surfacesOf(t).marks.emphasis as string] : []),
          ].map((x) => x.toUpperCase()),
        );
        for (const e of r.slide.elements) {
          if (e.name?.startsWith("Verdict disc") || e.name?.startsWith("Claim panel")) continue;
          if (e.name === MYTH_NAMES.card || e.name === MYTH_NAMES.factPanel) continue;
          // The title band (Poster, TEACH-215 part k) paints the theme's own title-band tokens.
          if (e.name === "surface:title") continue;
          const paint = [
            (e as { fill?: string }).fill,
            (e as { stroke?: string }).stroke,
            e.type === "text" ? e.style.color : undefined,
          ].filter((x): x is string => typeof x === "string");
          for (const p of paint) expect(known.has(p.toUpperCase())).toBe(true);
        }
      }
  });
});
