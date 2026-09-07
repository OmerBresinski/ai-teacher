import type { PageSize, Theme, Worksheet } from "@tj/domain/documents";
import type { CSSProperties, ReactNode } from "react";
import { FlowItemContent, SheetHeader, type SheetMode } from "./BlockContent";
import { pageMetrics } from "./metrics";
import type { FlowItem, WorksheetPage } from "./paginate";

/**
 * A paginated worksheet (TeachDeck `components/worksheet/Sheet.tsx`). The editor and the print
 * route render this same component; only `mode` and the per-item wrapper differ.
 */

/**
 * The theme and the paper, as custom properties on the sheet root. The page box is a variable
 * rather than a fixed rule so switching to Letter reflows the same DOM; `--ws-print-*` is the same
 * page in real-world units, which is what the print media query needs.
 */
export function sheetVars(theme: Theme, size: PageSize = "A4"): CSSProperties {
  const m = pageMetrics(size);
  return {
    "--ws-ink": theme.colors.ink,
    "--ws-font-title": theme.fonts.title,
    "--ws-font-body": theme.fonts.body,
    "--ws-page-w": `${m.page.w}pt`,
    "--ws-page-h": `${m.page.h}pt`,
    "--ws-print-w": m.printW,
    "--ws-print-h": m.printH,
  } as CSSProperties;
}

/**
 * The wrapper class for one flow item. The self-assessment strip is pinned to the foot of its
 * page; pagination already reserved its height above.
 */
export function flowItemClass(item: FlowItem): string {
  return item.kind === "rag" ? "ws-block ws-rag-slot" : "ws-block";
}

export function PageView({
  worksheet,
  page,
  pageCount,
  mode,
  header,
  empty,
  children,
}: {
  worksheet: Worksheet;
  page: WorksheetPage;
  pageCount: number;
  mode: SheetMode;
  header?: ReactNode;
  /** Editor-only hint shown on an empty sheet. */
  empty?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className="ws-page"
      data-page={page.index + 1}
      style={mode === "edit" ? { boxShadow: "var(--shadow-slide)" } : undefined}
    >
      <div className="ws-content">
        {page.index === 0 ? (header ?? <SheetHeader worksheet={worksheet} />) : null}
        {children}
        {page.index === 0 && page.items.length === 0 ? empty : null}
      </div>
      <div className="ws-footer">
        <span className="ws-footer-title">{worksheet.header.title || worksheet.title}</span>
        <span className="ws-footer-page">
          Page {page.index + 1} of {pageCount}
        </span>
      </div>
    </div>
  );
}

export function Sheet({
  worksheet,
  theme,
  pages,
  mode,
  header,
  empty,
  renderItem,
  pageWrapper,
  className,
}: {
  worksheet: Worksheet;
  theme: Theme;
  pages: WorksheetPage[];
  mode: SheetMode;
  /** Editor override for the page-1 header strip (adds selection chrome). */
  header?: ReactNode;
  /** Editor-only hint shown when the sheet has no blocks yet. */
  empty?: ReactNode;
  /** Editor override that wraps each item in its hover/drag/selection shell. */
  renderItem?: (item: FlowItem) => ReactNode;
  /** Editor override that scales each page to fit the column. */
  pageWrapper?: (page: WorksheetPage, node: ReactNode) => ReactNode;
  className?: string;
}) {
  return (
    <div
      className={className ? `ws-sheet ${className}` : "ws-sheet"}
      style={sheetVars(theme, worksheet.pageSize)}
    >
      {pages.map((page) => {
        const node = (
          <PageView
            key={page.index}
            worksheet={worksheet}
            page={page}
            pageCount={pages.length}
            mode={mode}
            header={header}
            empty={empty}
          >
            {page.items.map((item) =>
              renderItem ? (
                renderItem(item)
              ) : (
                <div className={flowItemClass(item)} key={item.key}>
                  <FlowItemContent item={item} worksheet={worksheet} mode={mode} />
                </div>
              ),
            )}
          </PageView>
        );
        return pageWrapper ? pageWrapper(page, node) : node;
      })}
    </div>
  );
}
