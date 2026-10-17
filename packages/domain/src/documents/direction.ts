import { z } from "zod";

/**
 * Writing direction (TEACH-75 part z). A lesson's direction comes from its language: there is
 * nothing new to ask the teacher. Geometry is laid out left-to-right by every layout and mirrored
 * once at the lesson boundary; the fields here only record which way a slide is laid out and
 * which elements are exceptions to the mirror. Nothing reads them yet.
 */
export type TextDirection = "ltr" | "rtl";

/**
 * Primary language subtags written right to left: Arabic, Hebrew, Persian, Urdu, Yiddish, Pashto,
 * Sindhi, Central Kurdish, Dhivehi.
 */
export const RTL_LANGUAGES: readonly string[] = [
  "ar",
  "he",
  "fa",
  "ur",
  "yi",
  "ps",
  "sd",
  "ckb",
  "dv",
];

/**
 * Script subtags written right to left. A script subtag wins over the language either way:
 * `az-Arab` is rtl, `ur-Latn` is ltr.
 */
const RTL_SCRIPTS = new Set(["arab", "hebr", "thaa", "syrc", "nkoo", "adlm", "rohg"]);

/** "iw" and "ji" are the retired codes for Hebrew and Yiddish; old data may still carry them. */
const RTL_PRIMARY = new Set([...RTL_LANGUAGES, "iw", "ji"]);

/**
 * The direction a BCP-47 language tag is written in: "rtl" for the languages above or an Arabic,
 * Hebrew (or other right-to-left) script subtag, "ltr" otherwise, including an absent or empty tag
 * (a lesson defaults to "en-GB"). Case and `_` separators are tolerated.
 */
export function dirOf(lang: string | undefined | null): TextDirection {
  if (!lang) return "ltr";
  const parts = lang.trim().toLowerCase().split(/[-_]/);
  const script = parts.slice(1).find((p) => /^[a-z]{4}$/.test(p));
  if (script) return RTL_SCRIPTS.has(script) ? "rtl" : "ltr";
  return RTL_PRIMARY.has(parts[0] ?? "") ? "rtl" : "ltr";
}

/**
 * A slide's or layout group's direction stamp: "rtl" when its geometry is laid out right to left.
 * Absent means left to right, so every stored lesson is already correctly stamped.
 */
export const DirStampSchema = z.literal("rtl");
export type DirStamp = z.infer<typeof DirStampSchema>;

/**
 * An element's exception to the mirror. `keep`: the box moves to its mirrored place but nothing in
 * it changes (equations, code, diagram and figure groups, number-only text). `flip`: a glyph that
 * carries direction is drawn flipped (an `arrow-right` icon). Absent: the element's type decides.
 */
export const ELEMENT_RTL_VALUES = ["keep", "flip"] as const;
export const ElementRtlSchema = z.enum(ELEMENT_RTL_VALUES);
export type ElementRtl = z.infer<typeof ElementRtlSchema>;

/** A BCP-47-shaped tag ("ar", "he-IL", "az-Arab"): letters and digits in subtags of 1-8. */
const LANG_TAG = /^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$/;
export const LanguageTagSchema = z.string().max(35).regex(LANG_TAG);
export const isLanguageTag = (v: unknown): v is string =>
  typeof v === "string" && LanguageTagSchema.safeParse(v).success;
