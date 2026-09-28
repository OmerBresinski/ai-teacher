import { useSyncExternalStore } from "react";

const QUERY = "(max-width: 760px)";
const read = () => typeof window !== "undefined" && window.matchMedia(QUERY).matches;
const subscribe = (change: () => void) => {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", change);
  return () => media.removeEventListener("change", change);
};
/** Mobile interaction layout is independent of theme or reading preferences. */
export const useMobileEditor = () => useSyncExternalStore(subscribe, read, () => false);

/**
 * A bottom sheet built on `DialogContent`. The placement is utilities, not `.mobile-editor-sheet`
 * CSS: `cn` merges them over the dialog's centring (`left-1/2 -translate-*-1/2`), which a plain
 * `translate: none` in a stylesheet did not override, leaving the sheet half off-screen.
 */
export const MOBILE_SHEET_CLASS =
  "mobile-editor-sheet top-auto bottom-0 left-0 translate-x-0 translate-y-0 w-full max-w-full rounded-b-none";
