import type { Lesson, Slide, TextElement, Theme } from "@tj/domain/documents";
import { Card, cn, Dialog, DialogContent, DialogTitle } from "@tj/ui";
import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { SlideStatic } from "../slide/SlideStatic";
import { docToPlainText } from "../text/static";
import { StageButton } from "./StageButton";
import { STAGE_SCOPE_CLASS } from "./stage-tokens";
import { usePresent } from "./use-present-session";

/** The slide's own heading, if it has one: the first `title` or `heading` text, flattened. */
function slideTitle(slide: Slide): string {
  const el = slide.elements.find(
    (e): e is TextElement =>
      e.type === "text" && (e.style.preset === "title" || e.style.preset === "heading"),
  );
  return el ? docToPlainText(el.doc).replace(/\s+/g, " ").trim() : "";
}

const THUMB = 208;
const GAP = 16;

/**
 * Jump between slides without leaving present mode (TeachDeck `components/v2/present/Overview.tsx`).
 * Arrows move the cursor, Enter goes, Esc comes back — the grid never advances the lesson by
 * accident, and the stage's own keys are held off while it is up.
 */
export function Overview({ lesson, theme }: { lesson: Lesson; theme: Theme }) {
  const { state } = usePresent();
  if (!state.overviewOpen) return null;
  // Remounting on open is what resets the cursor to the current slide.
  return <OverviewGrid key={state.index} lesson={lesson} theme={theme} index={state.index} />;
}

function OverviewGrid({ lesson, theme, index }: { lesson: Lesson; theme: Theme; index: number }) {
  const { dispatch } = usePresent();
  const close = () => dispatch({ type: "setOverviewOpen", open: false });

  const gridRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState(index);

  // The cursor is real DOM focus, so there is one notion of "selected".
  const focusCursor = useCallback((to: number) => {
    setCursor(to);
    gridRef.current?.querySelector<HTMLElement>(`[data-slide-index="${to}"]`)?.focus();
  }, []);

  /** Columns as laid out, rather than as calculated — the two used to disagree. */
  const columns = useCallback(() => {
    const grid = gridRef.current?.firstElementChild;
    if (!grid) return 1;
    return Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(" ").length);
  }, []);

  // Capture phase, so nothing else sees the arrows while the grid owns them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const last = lesson.slides.length - 1;
      const move = (to: number) => {
        e.preventDefault();
        e.stopPropagation();
        focusCursor(Math.max(0, Math.min(last, to)));
      };
      switch (e.key) {
        case "ArrowRight":
          return move(cursor + 1);
        case "ArrowLeft":
          return move(cursor - 1);
        case "ArrowDown":
          return move(cursor + columns());
        case "ArrowUp":
          return move(cursor - columns());
        case "Home":
          return move(0);
        case "End":
          return move(last);
        default:
          return;
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [cursor, lesson.slides.length, focusCursor, columns]);

  useEffect(() => {
    gridRef.current
      ?.querySelector<HTMLElement>(`[data-slide-index="${cursor}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent
        size="full"
        className={cn(STAGE_SCOPE_CLASS, "h-[calc(100vh-48px)] bg-background p-0")}
        // Opening puts focus on the current slide, so the roving cursor and DOM focus agree.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          focusCursor(index);
        }}
      >
        <div className="flex h-full flex-col">
          <div className="flex h-11 shrink-0 items-center justify-between px-5">
            <DialogTitle className="font-ui text-body text-foreground">
              {lesson.title} · {lesson.slides.length} slides
            </DialogTitle>
            <StageButton label="Close overview" onClick={close}>
              <X size={16} strokeWidth={1.5} />
            </StageButton>
          </div>

          {/* Top-aligned, not centred, so slide 1 is always in the same place. */}
          <div
            ref={gridRef}
            className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pt-2 pb-5"
          >
            <div
              className="grid"
              style={{
                gridTemplateColumns: `repeat(auto-fill, ${THUMB}px)`,
                gap: GAP,
                justifyContent: "start",
              }}
            >
              {lesson.slides.map((slide, i) => {
                const current = i === index;
                const focused = i === cursor;
                const title = slideTitle(slide);
                return (
                  // The cursor is real DOM focus with a roving tabindex, so the tile is a control
                  // that wraps the card exactly; `Button` would put a control's padding on a picture.
                  <button
                    key={slide.id}
                    type="button"
                    data-slide-index={i}
                    aria-current={current || undefined}
                    aria-label={`Slide ${i + 1}${title ? `: ${title}` : ""}`}
                    tabIndex={focused ? 0 : -1}
                    onFocus={() => setCursor(i)}
                    onClick={() => {
                      dispatch({ type: "goTo", index: i });
                      close();
                    }}
                    onPointerEnter={() => focusCursor(i)}
                    className="w-fit rounded-face text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <Card
                      variant="contained"
                      style={{ width: THUMB }}
                      className={cn(current && "ring-2 ring-primary")}
                      thumbnail={<SlideStatic slide={slide} theme={theme} width={THUMB} />}
                      heading={
                        title ? <span className="truncate text-body">{title}</span> : undefined
                      }
                      meta={current ? <span className="text-brand-text">{i + 1}</span> : i + 1}
                    />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
