// Coordinator (7 Oct; round 8 replay y5 s10): the last-resort strip must never ship overflow. When the
// stripped slide, already on the fit ladder's smallest rung, still does not fit, its list items are
// carried onto continuation slides of the same layout: each slide keeps the longest run of items, in
// order, that fits. Words are never cut or rewritten. Only plain lists split (points, questions);
// a slide with no such list, or whose single first item cannot fit alone, is left as it is.
type S = Record<string, unknown>;
const LIST_KEYS = ["points", "questions"] as const;

export function continueForFit(
  slide: S,
  fits: (s: S) => boolean,
): { first: S; rest: S[] } | undefined {
  const key = LIST_KEYS.find((k) => Array.isArray(slide[k]) && (slide[k] as unknown[]).length >= 2);
  if (!key) return undefined;
  const items = slide[key] as unknown[];
  const cont = (c: unknown[]): S => {
    const s: S = { template: slide.template, heading: slide.heading, [key]: c };
    // Keep the layout's other required fields empty-valued so the template lays out as itself.
    for (const [k, v] of Object.entries(slide))
      if (!(k in s))
        s[k] = typeof v === "string" ? (k === "lead" ? "" : null) : Array.isArray(v) ? [] : null;
    return s;
  };
  const chunks: unknown[][] = [];
  let at = 0;
  while (at < items.length) {
    let take = 0;
    for (let k = items.length - at; k >= 1; k--) {
      // Continuations carry the heading and the list only (the lead or instruction stays on the first).
      const part = items.slice(at, at + k);
      if (fits(chunks.length ? cont(part) : { ...slide, [key]: part })) {
        take = k;
        break;
      }
    }
    if (!take) return undefined;
    chunks.push(items.slice(at, at + take));
    at += take;
  }
  if (chunks.length < 2) return undefined;
  const [head, ...tail] = chunks;
  return { first: { ...slide, [key]: head }, rest: tail.map(cont) };
}
