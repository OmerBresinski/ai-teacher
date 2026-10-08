// Arm "locale4" (D33 open item, 9 Oct): a stock photo's caption names where the photographer stood
// ("A lone oak tree ... in Greater London, England."), and that caption becomes the slide's alt text
// and the notes call's picture line. In a New Zealand lesson it reads as wrong. Code, not prompt text:
// the caption keeps its subject, and a closing place phrase is dropped unless it names the teacher's
// country or the slide itself names that place. No gazetteer and no country facts; a place named
// mid-sentence ("a Paris street at night") is not caught (residual, see arms3/locale4/DIFF.md).

/** Capitalised words that follow "in" but are not places (times of year and day). */
const NOT_PLACE =
  /^(january|february|march|april|may|june|july|august|september|october|november|december|spring|summer|autumn|fall|winter|monday|tuesday|wednesday|thursday|friday|saturday|sunday|daylight|sunlight)$/i;

const NAME = String.raw`[\p{Lu}][\p{L}\p{M}'’\-]*`;
const JOIN = String.raw`(?:of|on|upon|de|del|la|le|the|and)`;
const PART = String.raw`${NAME}(?:\s+(?:${JOIN}\s+)?${NAME})*`;
/** A place phrase that closes a sentence: "in Greater London, England." / "at Lake Tekapo". */
const PLACE_AT_END = new RegExp(
  String.raw`,?\s+(?:in|at|near|around|outside|across)\s+(?:the\s+)?(${PART}(?:\s*,\s*${PART})*)(?=\s*(?:[.!;]|$))`,
  "gu",
);

const words = (s: string) => s.toLowerCase().normalize("NFC");
/** `name` appears in `text` as whole words. */
const named = (text: string, name: string) =>
  new RegExp(
    String.raw`(?<![\p{L}])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\p{L}])`,
    "u",
  ).test(text);

/**
 * `alt` with each sentence-closing place phrase removed when it is not the teacher's place:
 * kept if any part of it is (or contains) `country`, or appears in `context` (the slide's own text,
 * the writer's picture request and the topic); kept if every part is a time word ("in Winter").
 */
export function localAlt(alt: string, o: { country: string; context: string }): string {
  if (!alt) return alt;
  const country = words(o.country);
  const context = words(o.context);
  const out = alt.replace(PLACE_AT_END, (whole, phrase: string) => {
    const parts = phrase.split(/\s*,\s*/).map((p) => p.trim());
    if (parts.every((p) => p.split(/\s+/).every((w) => NOT_PLACE.test(w)))) return whole;
    if (parts.some((p) => words(p).includes(country))) return whole;
    if (parts.some((p) => named(context, words(p)))) return whole;
    return "";
  });
  return (
    out
      .replace(/\s+([.,!;])/g, "$1")
      .replace(/\s{2,}/g, " ")
      .trim() || alt
  );
}

/** Every `text` string in a slide (headings, body, captions), for the "the slide names it" test. */
export function slideWords(slide: unknown): string {
  const out: string[] = [];
  const walk = (v: unknown, key = ""): void => {
    if (typeof v === "string") {
      if (key === "text" || key === "request") out.push(v);
    } else if (Array.isArray(v)) for (const x of v) walk(x, key);
    else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v as Record<string, unknown>))
        if (k !== "source" && k !== "alt") walk(x, k);
  };
  walk(slide);
  return out.join(" ");
}

/** The slide with each image's alt passed through `localAlt` (context: the slide's words + `extra`). */
export function localiseSlideAlts<T>(slide: T, country: string, extra = ""): T {
  const context = `${slideWords(slide)} ${extra}`;
  const fix = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(fix);
    if (!v || typeof v !== "object") return v;
    const o = v as Record<string, unknown>;
    if (o.type === "image" && typeof o.alt === "string")
      return { ...o, alt: localAlt(o.alt, { country, context }) };
    const next: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(o)) next[k] = k === "source" ? x : fix(x);
    return next;
  };
  return fix(slide) as T;
}
