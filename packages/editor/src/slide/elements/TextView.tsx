import type { TextElement, Theme } from "@tj/domain/documents";
import { TriangleAlert } from "lucide-react";
import type { CSSProperties, ReactNode, Ref } from "react";
import {
  type ElementViewProps,
  JUSTIFY,
  type ResolvedText,
  resolveTextStyle,
  type SlideMode,
  textTypeCss,
  withAlpha,
} from "./kit";
import { RichText } from "./RichText";

/**
 * Edit mode only: the store subscription, the ResizeObserver and (behind another lazy
 * boundary) Tiptap. Split out so the viewer, present, capture and thumb bundles carry
 * none of it — they render `StaticText` and nothing else.
 */
// phase C (TEACH-104): `const EditableText = lazy(() => import('./EditableText'))` returns here.

/**
 * The box every text-ish element sits in: padding, optional fill, vertical alignment,
 * and the overflow rule. Shared by text, gap-text, shape labels and option cards so
 * the metrics never drift between them.
 */
export function TextShell({
  r,
  mode,
  overflowing,
  theme,
  children,
  style,
}: {
  r: ResolvedText;
  mode: SlideMode;
  overflowing?: boolean;
  theme: Theme;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: JUSTIFY[r.valign],
        padding: r.padding || undefined,
        background: r.background,
        borderRadius: r.radius || undefined,
        overflow: r.autoHeight ? "visible" : "hidden",
        ...style,
      }}
    >
      {children}
      {overflowing && mode === "edit" ? <OverflowGlyph theme={theme} /> : null}
    </div>
  );
}

export function OverflowGlyph({ theme, title }: { theme: Theme; title?: string }) {
  return (
    <span
      title={title ?? "Text does not fit this fixed-height box"}
      style={{
        position: "absolute",
        right: 2,
        bottom: 2,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 22,
        height: 22,
        borderRadius: 6,
        background: withAlpha(theme.colors.incorrect, 0.14),
        color: theme.colors.incorrect,
        pointerEvents: "none",
      }}
    >
      {/* Icon exception: a slide badge, not chrome — 14px inside a 22px mark. */}
      <TriangleAlert size={14} strokeWidth={2} />
    </span>
  );
}

export function TextView(props: ElementViewProps<TextElement>) {
  const { element, theme, mode } = props;
  // phase C (TEACH-104): in `edit` mode wrap `staticView` in Suspense around `EditableText`.
  return <StaticText element={element} theme={theme} mode={mode} />;
}

/** Pure presentation: no hooks, no store, no observers. The only path outside edit mode. */
export function StaticText({
  element,
  theme,
  mode,
  bodyRef,
  overflowing,
}: {
  element: TextElement;
  theme: Theme;
  mode: SlideMode;
  bodyRef?: Ref<HTMLDivElement>;
  overflowing?: boolean;
}) {
  const r = resolveTextStyle(element.style, theme);
  return (
    <TextShell r={r} mode={mode} overflowing={overflowing} theme={theme}>
      <div ref={bodyRef} style={{ width: "100%", flex: "0 0 auto" }}>
        <RichText doc={element.doc} style={textTypeCss(r)} />
      </div>
    </TextShell>
  );
}
