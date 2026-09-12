/**
 * Hand bytes to the browser as a download (TeachDeck `lib/export/png.ts` `downloadBlob`; the JSON
 * export used the same idiom inline). One helper for every format so the anchor dance lives once.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
