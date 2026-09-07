import type { Theme, Worksheet } from "@tj/domain/documents";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { whenFontsReady } from "../layout/measure";
import { FlowItemContent, SheetHeader } from "./BlockContent";
import { pageMetrics, pxToPt } from "./metrics";
import { buildFlow, type FlowItem, HEADER_KEY, type Pagination, paginate } from "./paginate";
import { sheetVars } from "./Sheet";

/**
 * Pagination needs real heights, and the only honest source of a rendered height is the browser
 * (TeachDeck `components/worksheet/measure.tsx`). Every flow item is rendered once, off-screen, at
 * 1:1 in the text column's width; a ResizeObserver reports the heights back and the pure
 * `paginate` splits them into pages. The measurement is an external subscription — the one
 * legitimate `useEffect` here; the pages themselves are derived with `useMemo`.
 */

const TOLERANCE = 0.25; // pt — ignore sub-quarter-point reflow noise

function differs(a: Record<string, number>, b: Record<string, number>): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return true;
  for (const key of keysB) {
    const prev = a[key];
    const next = b[key];
    if (prev === undefined || next === undefined || Math.abs(prev - next) > TOLERANCE) return true;
  }
  return false;
}

function MeasureColumn({
  worksheet,
  theme,
  items,
  onHeights,
  onFontsReady,
}: {
  worksheet: Worksheet;
  theme: Theme;
  items: FlowItem[];
  onHeights: (heights: Record<string, number>) => void;
  /** Fires once the theme faces are usable (`whenFontsReady`; immediately without a font API). */
  onFontsReady: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    // Only the keys this flow carries: the column re-renders with `items`, and a stale node from a
    // previous flow must not report a height under a key that is no longer on the sheet.
    const wanted = new Set([HEADER_KEY, ...items.map((item) => item.key)]);
    const nodes = Array.from(root.querySelectorAll<HTMLElement>("[data-measure-key]")).filter(
      (node) => wanted.has(node.dataset.measureKey ?? ""),
    );
    const report = () => {
      // Under `@media print` the column is `display: none` and every box measures 0. Keep the last
      // real heights: reporting the zeros would collapse the sheet to one page in the very media
      // it is printed in (the ResizeObserver does fire on the switch).
      if (getComputedStyle(root).display === "none") return;
      const next: Record<string, number> = {};
      for (const node of nodes) {
        const key = node.dataset.measureKey;
        if (key) next[key] = pxToPt(node.getBoundingClientRect().height);
      }
      onHeights(next);
    };
    const observer = new ResizeObserver(report);
    for (const node of nodes) observer.observe(node);
    report();
    // Webfonts land after first paint and change every height on the sheet; `ready` must not fire
    // until this settles, or the pages change under a teacher who already started reading them.
    let cancelled = false;
    void whenFontsReady().then(() => {
      if (cancelled) return;
      report();
      onFontsReady();
    });
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [items, onHeights, onFontsReady]);

  return (
    <div
      ref={ref}
      className="ws-sheet ws-measure"
      style={{
        ...sheetVars(theme, worksheet.pageSize),
        width: `${pageMetrics(worksheet.pageSize).contentW}pt`,
      }}
      aria-hidden
    >
      <div data-measure-key={HEADER_KEY}>
        <SheetHeader worksheet={worksheet} />
      </div>
      {items.map((item) => (
        <div className="ws-block" key={item.key} data-measure-key={item.key}>
          <FlowItemContent item={item} worksheet={worksheet} mode="print" />
        </div>
      ))}
    </div>
  );
}

export type SheetPagination = Pagination & {
  items: FlowItem[];
  /** True once every item has been measured and the fonts are in — the print route waits for this. */
  ready: boolean;
  /** Mount this beside the sheet: the off-screen column the heights are read from. */
  measureNode: ReactNode;
};

export function useSheetPagination(
  worksheet: Worksheet | null,
  theme: Theme,
  includeAnswerKey: boolean,
): SheetPagination {
  const [heights, setHeights] = useState<Record<string, number>>({});
  const [fontsReady, setFontsReady] = useState(false);

  const onHeights = useCallback((next: Record<string, number>) => {
    setHeights((prev) => (differs(prev, next) ? next : prev));
  }, []);

  const onFontsReady = useCallback(() => setFontsReady(true), []);

  const items = useMemo(
    () => (worksheet ? buildFlow(worksheet, includeAnswerKey) : []),
    [worksheet, includeAnswerKey],
  );

  const headerHeight = heights[HEADER_KEY] ?? 0;
  // Switching paper changes the page box, so the split and the oversize check both re-run off the
  // worksheet's own size rather than a fixed A4 constant.
  const contentH = pageMetrics(worksheet?.pageSize).contentH;
  const { pages, oversize } = useMemo(
    () => paginate(items, heights, headerHeight, contentH),
    [items, heights, headerHeight, contentH],
  );

  const ready =
    fontsReady &&
    !!worksheet &&
    heights[HEADER_KEY] !== undefined &&
    items.every((item) => heights[item.key] !== undefined);

  const measureNode = worksheet ? (
    <MeasureColumn
      worksheet={worksheet}
      theme={theme}
      items={items}
      onHeights={onHeights}
      onFontsReady={onFontsReady}
    />
  ) : null;

  return { items, pages, oversize, ready, measureNode };
}
