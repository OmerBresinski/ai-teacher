import type { Theme, Worksheet, WorksheetCover } from "@tj/domain/documents";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { pageMetrics, ptToPx } from "./metrics";
import { buildFlow, type WorksheetPage } from "./paginate";
import { Sheet } from "./Sheet";

/*
 * A worksheet at card size (UX ruling 31): the real `Sheet` in print mode, one unpaginated page
 * built from the summary's `cover` (the header and the first blocks), scaled to the width of
 * whatever box it is given, greyscale, clipped to that box. The library imports this through
 * `@tj/editor/worksheet-thumb`, which carries none of the editor (ADR 0022 §8).
 */

/**
 * The scale that fits a page `pageW` points wide into `ref`'s box, following the box as it
 * resizes. `null` until the first measurement; a test environment without `ResizeObserver`
 * measures once from `getBoundingClientRect`.
 */
export function useFitScale(ref: RefObject<HTMLElement | null>, pageW: number): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof ResizeObserver === "undefined") {
      const rect = el.getBoundingClientRect().width;
      if (rect > 0) setWidth(rect);
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next !== undefined && next > 0) setWidth(next);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width === null ? null : width / ptToPx(pageW);
}

/** The scale a thumb paints at before its box has been measured: a 320px card, roughly. */
const UNMEASURED_SCALE = 0.4;

export type WorksheetThumbProps = {
  cover: WorksheetCover;
  /** The document title, for the footer and the header when the sheet has no header title. */
  title: string;
  theme: Theme;
  className?: string;
};

export function WorksheetThumb({ cover, title, theme, className }: WorksheetThumbProps) {
  const sheet = useMemo<Worksheet>(
    () => ({
      version: 1,
      id: "thumb",
      title,
      themeId: "",
      createdAt: "",
      updatedAt: "",
      header: cover.header,
      blocks: cover.blocks,
      includeAnswerKey: false,
      pageSize: cover.pageSize,
      selfAssessment: false,
      ...(cover.showMarks !== undefined ? { showMarks: cover.showMarks } : {}),
    }),
    [cover, title],
  );
  const pages = useMemo<WorksheetPage[]>(
    () => [{ index: 0, items: buildFlow(sheet, false) }],
    [sheet],
  );
  const ref = useRef<HTMLDivElement>(null);
  const scale = useFitScale(ref, pageMetrics(cover.pageSize).page.w) ?? UNMEASURED_SCALE;
  return (
    <div ref={ref} className={className ? `ws-thumb ${className}` : "ws-thumb"} aria-hidden>
      <div
        className="ws-thumb-scale"
        style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}
      >
        <Sheet worksheet={sheet} theme={theme} pages={pages} mode="print" />
      </div>
    </div>
  );
}
