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
