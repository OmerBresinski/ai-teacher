import { LIVE_BLANK } from "@tj/domain";
import { layoutsOf, type PaletteFormId } from "@tj/slides";
import type { z } from "zod";
import type { Written } from "./fit";
import { isSetForm, partsField, slideWriterSchema } from "./menu";

/*
 * Live writing (spike/live-writing): the slide the stream is writing, drawn from the fields it
 * has so far. Every field still to come is filled from its schema — text as runs of `LIVE_BLANK`
 * about the length the field allows, lists at their minimum count — so the slide is drawn in its
 * real layout and the editor shows the unwritten parts as skeletons in their final places.
 */

/** Words of blank per string: about half the field's cap, 24 characters when it has none. */
function blankText(max: number | undefined): string {
  const chars = Math.max(8, Math.min(90, Math.round((max ?? 48) / 2)));
  const word = LIVE_BLANK.repeat(5);
  return Array.from({ length: Math.ceil(chars / 6) }, () => word).join(" ");
}

type Def = { type: string; [k: string]: unknown };
type Schema = { _zod: { def: Def; bag?: Record<string, unknown> } };

/** The blank value a schema's field takes before the stream writes it. */
export function blankOf(schema: unknown, depth = 0): unknown {
  const s = schema as Schema;
  const def = s?._zod?.def;
  if (!def || depth > 8) return undefined;
  const bag = s._zod.bag ?? {};
  switch (def.type) {
    case "string":
      return blankText(typeof bag.maximum === "number" ? bag.maximum : undefined);
    case "number":
    case "int":
      return typeof bag.minimum === "number" ? bag.minimum : 0;
    case "boolean":
      return false;
    case "literal":
      return (def.values as unknown[])?.[0];
    case "enum":
      return Object.values(def.entries as Record<string, unknown>)[0];
    case "optional":
    case "nullable":
    case "default":
    case "catch":
    case "readonly":
    case "nonoptional":
      return blankOf(def.innerType, depth + 1);
    case "pipe":
      return blankOf(def.in, depth + 1);
    case "union":
      return blankOf((def.options as unknown[])[0], depth + 1);
    case "array": {
      const min = typeof bag.minimum === "number" ? Math.min(bag.minimum, 6) : 0;
      return Array.from({ length: min }, () => blankOf(def.element, depth + 1));
    }
    case "object": {
      const shape = def.shape as Record<string, unknown>;
      return Object.fromEntries(Object.entries(shape).map(([k, v]) => [k, blankOf(v, depth + 1)]));
    }
    default:
      return undefined;
  }
}

/** The partial written so far laid over the blank: written values win, blanks fill the rest. */
export function overBlank(blank: unknown, partial: unknown): unknown {
  if (partial === undefined || partial === null) return blank;
  if (Array.isArray(blank) || Array.isArray(partial)) {
    const b = Array.isArray(blank) ? blank : [];
    const p = Array.isArray(partial) ? partial : [];
    const template = b[0];
    const n = Math.max(b.length, p.length);
    return Array.from({ length: n }, (_, i) =>
      overBlank(b[i] ?? template, p[i] === undefined ? undefined : p[i]),
    );
  }
  if (blank && typeof blank === "object" && typeof partial === "object") {
    const out: Record<string, unknown> = { ...(blank as Record<string, unknown>) };
    for (const [k, v] of Object.entries(partial as Record<string, unknown>)) {
      out[k] = overBlank((blank as Record<string, unknown>)[k], v);
    }
    return out;
  }
  if (typeof blank === "string" && typeof partial === "string" && partial.trim() === "") {
    return blank;
  }
  return partial;
}

/** The writer's fields for a slide still being written, blanks in every unwritten place. */
export function liveFields(
  form: string,
  layout: string,
  partial: Record<string, unknown>,
  parts?: number,
): Written {
  const schema = slideWriterSchema(form, layout) as unknown as z.ZodType;
  const { notes: _notes, diagram: _diagram, ...rest } = partial;
  const blank = blankOf(schema) as Written;
  // The plan row's part count reserves the final layout: the parts list starts at that length.
  const field = partsFieldOf(form, layout);
  const list = field ? blank[field] : undefined;
  if (field && Array.isArray(list) && parts !== undefined && list.length < parts) {
    const template =
      list[0] ??
      blankOf(
        (schema as unknown as { shape?: Record<string, { _zod: { def: { element?: unknown } } }> })
          .shape?.[field]?._zod.def.element,
      );
    blank[field] = [...list, ...Array.from({ length: parts - list.length }, () => template)];
  }
  const { diagram: _d, ...fields } = overBlank(blank, rest) as Written;
  return { ...fields, notes: "" };
}

/** The field that holds a layout's parts (points, steps, options…), when it has one. */
function partsFieldOf(form: string, layout: string): string | undefined {
  if (isSetForm(form)) return "questions";
  const c = layoutsOf(form as PaletteFormId).find((x) => x.layout === layout);
  return c ? partsField(c) : undefined;
}
