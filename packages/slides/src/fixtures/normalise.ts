/**
 * A layout with every id replaced by its order of first appearance (`_1`, `_2`, …), so two runs
 * of a recipe that mints ids with `uid()` compare equal. Ids referenced from `question` and the
 * `[[gap:id]]` tokens inside a fill-gap doc are the same strings, so one pass over the JSON text
 * renames every reference together. Used by `layouts.test.ts` against `default-recipes.json`.
 */
export function normaliseLayout(layout: unknown): unknown {
  let text = JSON.stringify(layout);
  const ids: string[] = [];
  for (const match of text.matchAll(/"id":"([^"]+)"/g)) {
    const id = match[1];
    if (id !== undefined && !ids.includes(id)) ids.push(id);
  }
  ids.forEach((id, i) => {
    text = text.split(id).join(`_${i + 1}`);
  });
  return JSON.parse(text);
}
