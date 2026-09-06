import { useEffect } from "react";

/** Code-based routes do not use route `head()`; each page sets its browser title directly. */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title;
  }, [title]);
}
