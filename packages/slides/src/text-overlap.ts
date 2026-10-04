/** Content words of a line, crudely stemmed, for cheap overlap checks between two texts. */
const STOP = new Set(
  "the a an and or but of to in on at by for with from as is are was were be been it its that this they their them than then into not do does did no".split(
    " ",
  ),
);

export function contentWords(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return new Set(
    words
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map((w) => w.replace(/(ing|ed|es|s)$/, "").replace(/e$/, "")),
  );
}

/** The share of `of`'s content words that `text` also has (0 when `of` has none). */
export function wordShare(of: string, text: string): number {
  const a = contentWords(of);
  const b = contentWords(text);
  return a.size === 0 ? 0 : [...a].filter((w) => b.has(w)).length / a.size;
}
