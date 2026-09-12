/**
 * The worksheet print route with `?auto=1`, which calls `window.print()` once the fonts are ready
 * (TeachDeck `worksheetPrintHref(id, { auto: true })`). The href itself is `@tj/editor`'s — the
 * export dialog's PDF tab builds the same one (TEACH-272 §5) — re-exported from the pure `pdf`
 * module so the library card never pulls the dialog into its chunk.
 */
import { worksheetPrintHref as href } from "@tj/editor/export/pdf";
import { openPrintTab } from "./print-tab";

export const worksheetPrintHref = (id: string) => href(id);

/** Print in a new tab, as the editor does: the library stays where it is. */
export function openWorksheetPrint(id: string): void {
  openPrintTab(worksheetPrintHref(id));
}
