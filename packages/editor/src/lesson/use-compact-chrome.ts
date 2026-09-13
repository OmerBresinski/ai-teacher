import { useSyncExternalStore } from "react";

/** CSS owns the responsive design boundary; geometry-owning chrome reads the same decision. */
function readCompactChrome(): boolean {
  return (
    typeof document !== "undefined" &&
    getComputedStyle(document.documentElement).getPropertyValue("--editor-compact").trim() === "1"
  );
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-design", "data-theme"],
  });
  return () => {
    window.removeEventListener("resize", onChange);
    observer.disconnect();
  };
}

export function useCompactChrome(): boolean {
  return useSyncExternalStore(subscribe, readCompactChrome, () => false);
}
