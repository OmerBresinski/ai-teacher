/**
 * The print route with `?auto=1`, which calls `window.print()` once the fonts are ready
 * (TeachDeck `worksheetPrintHref(id, { auto: true })`). Shared by the editor's Print and the
 * library card's Print; kept out of the editor page so the library chunk never imports it.
 */
export const worksheetPrintHref = (id: string) => `/w/${encodeURIComponent(id)}/print?auto=1`;

/** Print in a new tab, as the editor does: the library stays where it is. */
export function openWorksheetPrint(id: string): void {
  window.open(worksheetPrintHref(id), "_blank", "noopener");
}
