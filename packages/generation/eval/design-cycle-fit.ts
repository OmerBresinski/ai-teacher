/*
 * Fit check for design-cycle smoke output (free, no model calls): every slot is turned into the
 * slide spec its palette form renders, materialised on all 10 themes and fitted the way the
 * palette drift test does it: no overflow, no preset stepped below the form's own example, and
 * the form placed as itself. Also counts each slot's units against the form's `holds`.
 *
 *   bun eval/design-cycle-fit.ts <run dir>
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import type { Slide, Theme } from "@tj/domain/documents";
import {
  fitSlide,
  materialiseSlide,
  type PaletteForm,
  paletteForm,
  resolveFontSize,
  type SlideSpec,
  THEMES,
  unitsOf,
} from "@tj/slides";
import type { DesignSlot } from "../src/prompts/design-cycle";

const dir = process.argv[2] ?? ".";
const meta = { promptVersion: "design-cycle", model: "smoke", at: "2026-09-30" };

/** The slide spec a slot renders as (the stand-in for item 8's slot renderers). */
export function specOf(slot: DesignSlot): SlideSpec | null {
  const base = { factRefs: [], notes: slot.notes };
  switch (slot.form) {
    case "explain":
    case "photo":
      return { kind: "content", ...base, heading: slot.heading, body: slot.body };
    case "explain-callout":
      return {
        kind: "content",
        ...base,
        heading: slot.heading,
        body: slot.body,
        callout: { kind: "watch-out", text: slot.callout.text },
      };
    case "list":
      return {
        kind: "content",
        ...base,
        heading: slot.heading,
        body: slot.body,
        points: slot.points,
      };
    case "compare":
      return {
        kind: "content",
        ...base,
        heading: slot.heading,
        body: slot.body,
        compare: slot.compare,
      };
    case "sequence":
      return {
        kind: "content",
        ...base,
        heading: slot.heading,
        body: slot.body,
        steps: slot.steps,
      };
    case "diagram-slot":
      return {
        kind: "content",
        ...base,
        heading: slot.heading,
        body: slot.body,
        diagram: slot.diagram,
      };
    case "worked-example":
      return {
        kind: "worked-example",
        ...base,
        heading: slot.heading,
        question: slot.question,
        steps: slot.steps,
      };
    case "hinge":
      return {
        kind: "multiple-choice",
        ...base,
        stem: slot.stem,
        options: slot.options,
        explanation: slot.explanation,
      };
    case "true-false":
      return {
        kind: "true-false",
        ...base,
        statement: slot.statement,
        correct: slot.correct,
        explanation: slot.explanation,
      };
    case "matching":
      return { kind: "matching", ...base, stem: slot.stem, pairs: slot.pairs };
    case "fill-gap":
      return {
        kind: "fill-gap",
        ...base,
        stem: slot.stem,
        sentence: slot.sentence,
        answers: slot.answers,
      };
    case "sort":
      return { kind: "sort", ...base, stem: slot.stem, steps: slot.steps };
    case "open-response":
      return { kind: "open-response", ...base, stem: slot.stem, modelAnswer: slot.modelAnswer };
    case "discussion":
      return {
        kind: "discussion",
        ...base,
        prompt: slot.prompt,
        ...(slot.footnote ? { footnote: slot.footnote } : {}),
      };
    case "vocabulary":
      return { kind: "vocabulary", ...base, entries: slot.entries };
    default:
      return null; // figure: its values are drawn later from the figureBrief
  }
}

function materialise(form: PaletteForm, spec: SlideSpec, theme: Theme, photo?: string): Slide {
  if (form.renderer.on !== "slide") throw new Error("off-slide form");
  const structure =
    form.renderer.structure === "photo" ? { photo: { subject: photo ?? "photo" } } : {};
  const slide = materialiseSlide(spec, theme.id, meta, undefined, form.renderer.variant, structure);
  return fitSlide(slide, theme).slide;
}

function sizes(slide: Slide, theme: Theme): Map<string, number> {
  const out = new Map<string, number>();
  const note = (key: string, size: number) => out.set(key, Math.min(out.get(key) ?? size, size));
  for (const el of slide.elements) {
    if (el.type === "text")
      note(el.style.preset, el.style.fontSize ?? resolveFontSize(theme, el.style.preset));
    if (el.type === "option" && el.textStyle?.fontSize) note("option", el.textStyle.fontSize);
  }
  return out;
}

type Row = {
  brief: string;
  o: number;
  i: number;
  form: string;
  fits: number;
  themes: number;
  fails: string[];
  overUnits: string[];
};
const rows: Row[] = [];
for (const f of readdirSync(dir).filter(
  (f) => f.endsWith(".json") && !f.startsWith("spend") && !f.startsWith("fit"),
)) {
  const run = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
  for (const c of run.cycles ?? []) {
    (c.output?.slots ?? []).forEach((slot: DesignSlot, i: number) => {
      const form = paletteForm(slot.form);
      const spec = specOf(slot);
      const row: Row = {
        brief: run.id,
        o: c.objectiveIndex,
        i,
        form: slot.form,
        fits: 0,
        themes: 0,
        fails: [],
        overUnits: [],
      };
      if (spec) {
        const units = unitsOf(form, spec);
        for (const u of form.holds) {
          const n = units[u.slot];
          if (u.max !== undefined && n !== undefined && n > u.max)
            row.overUnits.push(`${u.slot} ${n}>${u.max}`);
        }
        for (const theme of THEMES) {
          row.themes++;
          const photo = slot.form === "photo" ? slot.imageBrief.subject : undefined;
          const full = materialise(form, spec, theme, photo);
          const why: string[] = [];
          if (fitSlide(full, theme).overflow.length > 0) why.push("overflow");
          const base = sizes(materialise(form, form.example as SlideSpec, theme), theme);
          for (const [preset, size] of sizes(full, theme)) {
            const at = base.get(preset);
            if (at !== undefined && size < at) why.push(`${preset} stepped`);
          }
          const placed = form.renderer.on === "slide" ? form.renderer.placed : undefined;
          if (placed && !full.elements.some((e) => e.name === placed)) why.push("not placed");
          if (why.length === 0) row.fits++;
          else row.fails.push(`${theme.id}: ${why.join(", ")}`);
        }
      }
      rows.push(row);
    });
  }
}
const measured = rows.filter((r) => r.themes > 0);
const slotThemes = measured.reduce((s, r) => s + r.themes, 0);
const fitThemes = measured.reduce((s, r) => s + r.fits, 0);
const allThemes = measured.filter((r) => r.fits === r.themes).length;
const mix: Record<string, number> = {};
for (const r of rows) mix[r.form] = (mix[r.form] ?? 0) + 1;
for (const r of rows) {
  if (r.fails.length || r.overUnits.length)
    console.log(
      `${r.brief} o${r.o} s${r.i} ${r.form}: fits ${r.fits}/${r.themes}${r.overUnits.length ? `; units over: ${r.overUnits.join(", ")}` : ""}${r.fails.length ? `; ${r.fails.slice(0, 4).join(" | ")}` : ""}`,
    );
}
console.log(
  `slots ${rows.length} (measured ${measured.length}); fit on all 10 themes: ${allThemes}/${measured.length}; slot-themes ${fitThemes}/${slotThemes} (${((100 * fitThemes) / slotThemes).toFixed(1)}%); over units: ${rows.filter((r) => r.overUnits.length).length}`,
);
console.log(`form mix: ${JSON.stringify(mix)}`);
writeFileSync(
  `${dir}/fit.json`,
  JSON.stringify(
    { rows, mix, allThemes, measured: measured.length, fitThemes, slotThemes },
    null,
    1,
  ),
);
