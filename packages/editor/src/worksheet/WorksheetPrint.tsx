import type { Worksheet } from "@tj/domain/documents";
import { type ReactNode, useEffect, useRef } from "react";
import { whenFontsReady } from "../layout/measure";
import { getTheme } from "../model/themes";
import { useSheetPagination } from "./measure";
import { Sheet } from "./Sheet";

/**
 * The print layout (TeachDeck `app/w/[id]/print/page.tsx`; SPEC §10): the same paginated pages at
 * exact A4 or Letter, no chrome, greyscale-safe. With `auto` it prints as soon as the fonts have
 * landed and the pages have been measured — what the editor's Print button opens. The page that
 * mounts this imports `@tj/editor/styles/print.css`.
 */
export type WorksheetPrintProps = {
  worksheet: Worksheet;
  /** `?auto=1`: call `window.print()` once, when the sheet is ready. */
  auto?: boolean;
  /** The "Go back" link in the won't-fit hint; the app supplies its router's `Link`. */
  backSlot?: ReactNode;
};

export function WorksheetPrint({ worksheet, auto = false, backSlot }: WorksheetPrintProps) {
  const theme = getTheme(worksheet.themeId);
  const { pages, ready, oversize, measureNode } = useSheetPagination(
    worksheet,
    theme,
    worksheet.includeAnswerKey,
  );
  const printed = useRef(false);
  const canPrint = ready && oversize.length === 0;

  useEffect(() => {
    // A block that does not fit its page is a blocking export error (research/02 decision 14):
    // never hand this to the browser's print dialog automatically. Exactly once per mount: the
    // guard is set when the dialog is actually opened, not when the effect runs, so StrictMode's
    // mount → cleanup → mount in development still prints once rather than never.
    if (!auto || !canPrint) return;
    let cancelled = false;
    void whenFontsReady().then(() => {
      if (cancelled) return;
      // One frame for the final layout pass, then hand over to the browser.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (cancelled || printed.current) return;
          printed.current = true;
          window.print();
        }),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [auto, canPrint]);

  return (
    <>
      {/* `@page` takes no custom properties, so the paper is written out here. */}
      <style>{`@page { size: ${worksheet.pageSize === "Letter" ? "Letter" : "A4"}; }`}</style>
      {/* The page's one landmark: the route renders no app chrome around it (ADR 0023 §2). */}
      <main className="ws-print-root" style={{ visibility: ready ? undefined : "hidden" }}>
        {ready && oversize.length > 0 ? (
          <p className="ws-print-hint">
            A question does not fit on its page. {backSlot ?? "Go back"} and shorten it, or cut its
            answer lines.
          </p>
        ) : null}
        <Sheet worksheet={worksheet} theme={theme} pages={pages} mode="print" />
      </main>
      {measureNode}
    </>
  );
}
