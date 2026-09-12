/**
 * Open a print route in a new tab (TeachDeck `openPrintView`). The one place `apps/web` calls
 * `window.open` for the export dialog: `@tj/editor` builds the href and hands it back through
 * `ExportControl`'s `onOpenPrint`, so the package never knows an origin (ADR 0022 §6). Must run
 * synchronously inside the click that asked for it, or the browser blocks the tab.
 */
export function openPrintTab(href: string): void {
  window.open(href, "_blank", "noopener");
}
