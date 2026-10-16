import { describe, expect, test } from "bun:test";
import {
  type Slide,
  type SlideElement,
  slideStepCount,
  type TextElement,
} from "@tj/domain/documents";
import * as ICONS from "../icons";
import { provideIcons } from "../icons/loader";
import { resolveTextStyle } from "../text-style";
import { v2Colors } from "../theme-v2";
import { atKeyStage, getTheme, THEMES } from "../themes";
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
      // Only the 18-word cap test at KS2 is over (the key-stage type is larger than the gold's px).
      expect(r.over).toEqual(k.name === "y6-caps" ? ["myth.fact"] : []);
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
    expect(myth).toEqual([{ font: "quote", strikeStep: 1 }]);
    const straight = lay(caseOf("y6-falling-straight").input).slide.elements;
    expect(runAttrs(one(straight, MYTH_NAMES.claim))).toEqual([{ font: "quote", strikeStep: 0 }]);
    const honey = lay(caseOf("y5-honey-true").input).slide.elements;
    expect(runAttrs(one(honey, MYTH_NAMES.claim))).toEqual([{ font: "quote" }]);
    // Step 0 is the same for both verdicts: nothing gives the answer away.
    expect(runAttrs(one(honey, MYTH_NAMES.claimOpen))).toEqual([{ font: "quote" }]);
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
          [c.background, c.surface, c.ink, c.muted, c.accent, c.deep, c.onDeep, ...c.fields].map(
            (x) => x.toUpperCase(),
          ),
        );
        for (const e of r.slide.elements) {
          if (e.name?.startsWith("Verdict disc") || e.name?.startsWith("Claim panel")) continue;
          if (e.name === MYTH_NAMES.card || e.name === MYTH_NAMES.factPanel) continue;
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
