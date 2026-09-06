import { useVirtualizer } from "@tanstack/react-virtual";
import {
  type Id,
  SLIDE_W,
  type Slide,
  type SlideKind,
  slideStepCount,
  type Theme,
} from "@tj/domain/documents";
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  IconButton,
} from "@tj/ui";
import { PanelLeftClose, PanelLeftOpen, Plus } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SLIDE_KIND_LABELS } from "../model/layouts";
import * as reducers from "../model/reducers";
import { getTheme } from "../model/themes";
import { SlideScaler } from "../slide/SlideScaler";
import { SlideView } from "../slide/SlideView";
import { AddSlidePicker } from "./AddSlidePicker";
import { useHistory, useLesson } from "./document-context";
import { hint } from "./keys";
import { addSlideAfter, duplicateSlide, moveSlides } from "./slide-commands";
import { useActiveSlideId, useSessionActions, useSessionUi } from "./use-editor-session";

/*
 * The slide rail (TeachDeck `components/v2/editor/Navigator.tsx`): virtualised thumbs with the
 * slide number to their left, keyboard navigation and reorder, pointer drag-reorder, a context menu
 * and the "Add slide" picker in the footer.
 *
 * Geometry — 168x94 thumbs, 8px gap, 22px number column. 94, not 16:9's exact 94.5: a half pixel
 * put every row boundary off the pixel grid, so the hairline under a thumbnail rendered at two
 * different weights down the rail.
 */
const FULL = { thumbW: 168, thumbH: 94, gap: 8, numW: 22 };
const COMPACT = { thumbW: 60, thumbH: 33.75, gap: 6, numW: 16 };
type Geometry = typeof FULL;

/** Browser preference: whether the rail is collapsed to the compact thumbs. */
export const NAVIGATOR_MODE_KEY = "tj:navigator";

type Mode = "full" | "compact";

function readMode(): Mode {
  try {
    return window.localStorage.getItem(NAVIGATOR_MODE_KEY) === "compact" ? "compact" : "full";
  } catch {
    return "full";
  }
}

/** A theme colour at `pct` percent over whatever is behind it. */
const tint = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

export function Navigator() {
  const lesson = useLesson();
  const history = useHistory();
  const session = useSessionActions();
  const activeSlideId = useActiveSlideId();
  const { clipboardSlide } = useSessionUi();
  const theme = useMemo(() => getTheme(lesson.themeId), [lesson.themeId]);

  const [mode, setMode] = useState<Mode>(readMode);
  const toggleMode = () => {
    const next: Mode = mode === "full" ? "compact" : "full";
    setMode(next);
    try {
      window.localStorage.setItem(NAVIGATOR_MODE_KEY, next);
    } catch {
      /* private mode: the rail simply opens full next time */
    }
  };

  const g = mode === "full" ? FULL : COMPACT;
  const rowH = g.thumbH + g.gap;

  const list = lesson.slides;
  const index = useMemo(() => new Map(list.map((s, i) => [s.id, i])), [list]);
  const activeId =
    (activeSlideId && index.has(activeSlideId) ? activeSlideId : list[0]?.id) ?? null;

  /* ---- multi-selection ------------------------------------------------ */
  // The rail is the only thing allowed to hold a multi-selection. It is remembered together with
  // the active slide it was made for: when the active slide changes from anywhere else (a canvas
  // click, an insert, a delete) the pair no longer matches and the selection collapses to the
  // active slide — derived at read time, never synced in an effect.
  const [picked, setPicked] = useState<{ ids: Id[]; forActive: Id | null }>({
    ids: [],
    forActive: null,
  });
  const anchor = useRef(0);
  const selection = useMemo<Id[]>(
    () =>
      picked.forActive === activeId && picked.ids.length ? picked.ids : activeId ? [activeId] : [],
    [picked, activeId],
  );
  const selected = useMemo(() => new Set(selection), [selection]);

  const choose = useCallback(
    (ids: Id[], active: Id) => {
      setPicked({ ids, forActive: active });
      session.setActiveSlide(active);
    },
    [session],
  );

  // "Latest value" refs so the per-row handlers stay referentially stable across document edits
  // while still reading current data: a fresh closure per render would defeat the row memo.
  const listRef = useRef(list);
  listRef.current = list;
  const indexRef = useRef(index);
  indexRef.current = index;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  const scroller = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: list.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => rowH,
    overscan: 6,
    getItemKey: (i) => list[i]?.id ?? i,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: `rowH` is the trigger — the estimate changed
  useEffect(() => {
    virtualizer.measure();
  }, [rowH, virtualizer]);

  // Keep the current slide in view when it changes from anywhere (an external DOM scroll).
  const virtualizerRef = useRef(virtualizer);
  virtualizerRef.current = virtualizer;
  useEffect(() => {
    const i = activeId ? indexRef.current.get(activeId) : undefined;
    if (i !== undefined) virtualizerRef.current.scrollToIndex(i, { align: "auto" });
  }, [activeId]);

  const pick = useCallback(
    (id: Id, e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => {
      const l = listRef.current;
      const i = indexRef.current.get(id) ?? 0;
      if (e.shiftKey && l.length) {
        const from = Math.min(anchor.current, i);
        const to = Math.max(anchor.current, i);
        choose(
          l.slice(from, to + 1).map((s) => s.id),
          id,
        );
        return;
      }
      if (e.metaKey || e.ctrlKey) {
        const prev = selectionRef.current;
        anchor.current = i;
        choose(prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id], id);
        return;
      }
      anchor.current = i;
      choose([id], id);
    },
    [choose],
  );

  /* ---- commands ------------------------------------------------------- */
  const deps = { history, lesson, session };
  const ids = selection;

  const nudgeSlides = (dir: -1 | 1) => {
    const positions = ids.map((id) => index.get(id) ?? 0).sort((a, b) => a - b);
    const first = positions[0] ?? 0;
    const last = positions[positions.length - 1] ?? 0;
    const target = dir === -1 ? Math.max(0, first - 1) : Math.min(list.length, last + 2);
    moveSlides(deps, ids, target);
  };

  const duplicate = () => {
    history.beginTransaction();
    let made: Id | null = null;
    for (const id of [...ids].sort((a, b) => (index.get(b) ?? 0) - (index.get(a) ?? 0))) {
      made = duplicateSlide(deps, id) ?? made;
    }
    history.endTransaction();
    if (made) setPicked({ ids: [made], forActive: made });
  };

  const remove = () => {
    if (list.length <= ids.length) return;
    const firstIdx = Math.min(...ids.map((id) => index.get(id) ?? 0));
    history.beginTransaction();
    let next = lesson;
    for (const id of ids) next = history.dispatch(reducers.deleteSlide, id) ?? next;
    history.endTransaction();
    // The rail lands on the survivor at the first removed position (or the new last slide).
    const survivor = next.slides[Math.min(firstIdx, next.slides.length - 1)];
    if (next !== lesson && survivor) choose([survivor.id], survivor.id);
  };

  const addAfterCurrent = (kind: SlideKind) => {
    const made = addSlideAfter(deps, activeId, kind);
    if (made) setPicked({ ids: [made], forActive: made });
  };

  const goTo = (i: number, extend = false) => {
    const target = list[Math.max(0, Math.min(list.length - 1, i))];
    if (!target) return;
    const at = index.get(target.id) ?? 0;
    if (extend) {
      const from = Math.min(anchor.current, at);
      const to = Math.max(anchor.current, at);
      choose(
        list.slice(from, to + 1).map((s) => s.id),
        target.id,
      );
      return;
    }
    anchor.current = at;
    choose([target.id], target.id);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = activeId ? (index.get(activeId) ?? 0) : 0;
    const mod = e.metaKey || e.ctrlKey;
    const keys: Record<string, () => void> = {
      // ⌘⇧↑/↓ moves the selection to the very top/bottom of the deck; plain ⌘ nudges by one;
      // neither held moves the active slide instead.
      ArrowDown: () => {
        if (mod && e.shiftKey) moveSlides(deps, ids, list.length);
        else if (mod) nudgeSlides(1);
        else goTo(i + 1, e.shiftKey);
      },
      ArrowUp: () => {
        if (mod && e.shiftKey) moveSlides(deps, ids, 0);
        else if (mod) nudgeSlides(-1);
        else goTo(i - 1, e.shiftKey);
      },
      Home: () => goTo(0),
      End: () => goTo(list.length - 1),
      Delete: remove,
      Backspace: remove,
      Enter: () => addAfterCurrent(list[i]?.kind ?? "blank"),
    };
    if (mod && (e.key === "d" || e.key === "D")) {
      e.preventDefault();
      duplicate();
      return;
    }
    if (mod && (e.key === "a" || e.key === "A")) {
      e.preventDefault();
      if (activeId)
        choose(
          list.map((s) => s.id),
          activeId,
        );
      return;
    }
    const run = keys[e.key];
    if (!run) return;
    e.preventDefault();
    run();
  };

  /* ---- drag to reorder ------------------------------------------------- */
  const [drag, setDrag] = useState<{ ids: Id[]; at: number } | null>(null);
  const dragStart = useRef<{ y: number; id: Id; started: boolean } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;

  const insertionAt = useCallback(
    (clientY: number) => {
      const el = scroller.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      const y = clientY - rect.top + el.scrollTop - 8;
      return Math.max(0, Math.min(listRef.current.length, Math.round(y / rowH)));
    },
    [rowH],
  );

  // Row handlers read the slide id off `data-id` rather than closing over it per row, so the same
  // handler instance is reused for every row and the row memo holds.
  const onRowPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    dragStart.current = { y: e.clientY, id, started: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onRowPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const start = dragStart.current;
      if (!start) return;
      if (!start.started) {
        if (Math.abs(e.clientY - start.y) < 4) return;
        start.started = true;
      }
      const sel = selectionRef.current;
      const moving = sel.includes(start.id) ? sel : [start.id];
      setDrag({ ids: moving, at: insertionAt(e.clientY) });
    },
    [insertionAt],
  );

  const depsRef = useRef(deps);
  depsRef.current = deps;
  const onRowPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const id = e.currentTarget.dataset.id;
      const start = dragStart.current;
      dragStart.current = null;
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      const current = dragRef.current;
      if (start?.started && current) {
        moveSlides(depsRef.current, current.ids, current.at);
        setDrag(null);
        return;
      }
      setDrag(null);
      if (start && id) pick(id, e);
    },
    [pick],
  );

  /* ---- context menu ---------------------------------------------------- */
  const [menuAt, setMenuAt] = useState<{ x: number; y: number; id: Id } | null>(null);

  const onRowContextMenu = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const id = e.currentTarget.dataset.id;
      if (!id) return;
      e.preventDefault();
      if (!selectionRef.current.includes(id))
        pick(id, { shiftKey: false, metaKey: false, ctrlKey: false });
      setMenuAt({ x: e.clientX, y: e.clientY, id });
    },
    [pick],
  );

  const draggingIds = drag ? new Set(drag.ids) : null;

  return (
    <aside
      data-navigator
      className="flex shrink-0 flex-col border-border border-r bg-background"
      style={{ width: mode === "full" ? "var(--navigator-width)" : "var(--navigator-width-sm)" }}
    >
      <div
        ref={scroller}
        role="listbox"
        aria-label="Slides"
        aria-multiselectable
        aria-activedescendant={activeId ? `slide-opt-${activeId}` : undefined}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="relative flex-1 overflow-x-hidden overflow-y-auto py-2 outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--border-strong)]"
      >
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((item) => {
            const slide = list[item.index];
            if (!slide) return null;
            return (
              // The row settles into its new place instead of snapping there: `getItemKey` is the
              // slide id, so a row's DOM node follows its slide and only the INDEX moves.
              <div
                key={item.key}
                className="transition-transform duration-(--duration-base) ease-(--ease-standard) motion-reduce:transition-none"
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${item.start}px)`,
                }}
              >
                <NavigatorRow
                  slide={slide}
                  number={item.index + 1}
                  theme={theme}
                  geometry={g}
                  active={slide.id === activeId}
                  selected={selected.has(slide.id)}
                  dragging={!!draggingIds?.has(slide.id)}
                  onPointerDown={onRowPointerDown}
                  onPointerMove={onRowPointerMove}
                  onPointerUp={onRowPointerUp}
                  onContextMenu={onRowContextMenu}
                />
              </div>
            );
          })}

          {drag ? (
            <span
              aria-hidden
              data-drop-indicator
              className="pointer-events-none absolute z-10 h-0.5 rounded-full bg-primary"
              // The gap above each thumb is 8px (py-2 plus the row's top edge); the line sits
              // centred in that gap rather than inside the target thumb.
              style={{ top: drag.at * rowH + 8 - g.gap / 2, left: g.numW + 4, width: g.thumbW }}
            >
              {drag.ids.length > 1 ? (
                <span className="-top-2 absolute right-0 rounded-key bg-primary px-1 text-eyebrow text-primary-foreground">
                  {drag.ids.length} slides
                </span>
              ) : null}
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex h-8 shrink-0 items-center gap-1 border-border border-t px-1.5">
        <AddSlidePicker
          themeId={lesson.themeId}
          onPick={addAfterCurrent}
          side="top"
          trigger={
            <Button variant="ghost" size="sm" className="h-6 flex-1 justify-start px-1.5">
              <Plus aria-hidden size={16} strokeWidth={1.5} />
              {mode === "full" ? "Add slide" : <span className="sr-only">Add slide</span>}
            </Button>
          }
        />
        <IconButton
          label={mode === "full" ? "Compact slides" : "Expand slides"}
          size="sm"
          onClick={toggleMode}
        >
          {mode === "full" ? (
            <PanelLeftClose aria-hidden size={16} strokeWidth={1.5} />
          ) : (
            <PanelLeftOpen aria-hidden size={16} strokeWidth={1.5} />
          )}
        </IconButton>
      </div>

      {/* The context menu: a controlled DropdownMenu whose trigger is a 1px anchor at the pointer. */}
      <DropdownMenu open={menuAt !== null} onOpenChange={(o) => !o && setMenuAt(null)}>
        <DropdownMenuTrigger asChild>
          <span
            aria-hidden
            style={{
              position: "fixed",
              left: menuAt?.x ?? 0,
              top: menuAt?.y ?? 0,
              width: 1,
              height: 1,
            }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" aria-label="Slide">
          <DropdownMenuItem onSelect={duplicate}>
            Duplicate
            <DropdownMenuShortcut>{hint("$mod+d")}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              const s = menuAt && list.find((x) => x.id === menuAt.id);
              if (s) session.copySlide(s);
            }}
          >
            Copy
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!clipboardSlide}
            onSelect={() => {
              if (!menuAt || !clipboardSlide) return;
              const made = history.dispatch(reducers.pasteSlide, clipboardSlide, menuAt.id);
              if (made) choose([made.id], made.id);
            }}
          >
            Paste after
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => nudgeSlides(-1)}>Move up</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => nudgeSlides(1)}>Move down</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={list.length <= ids.length}
            onSelect={remove}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </aside>
  );
}

/* ------------------------------------------------------------------ */

// Memoised so a document edit only re-renders the one row whose slide changed — immer keeps every
// other slide's identity intact (TEACH-102 row 1). Every other prop is stable: geometry is one of
// two module constants, theme is memoised by the caller, and the handlers are single instances.
const NavigatorRow = memo(function NavigatorRow({
  slide,
  number,
  theme,
  geometry,
  active,
  selected,
  dragging,
  ...handlers
}: {
  slide: Slide;
  number: number;
  theme: Theme;
  geometry: Geometry;
  active: boolean;
  selected: boolean;
  dragging: boolean;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
  onContextMenu: (e: React.MouseEvent<HTMLDivElement>) => void;
}) {
  const hasNotes = !!slide.notes?.trim();
  const hasSteps = slideStepCount(slide) > 0;

  return (
    <div
      role="option"
      // Focus stays on the listbox (`aria-activedescendant`); the row itself is never a tab stop.
      tabIndex={-1}
      id={`slide-opt-${slide.id}`}
      data-id={slide.id}
      data-navigator-row
      aria-selected={selected}
      aria-label={`Slide ${number}, ${SLIDE_KIND_LABELS[slide.kind]}`}
      {...handlers}
      className={cn(
        // One rounded object per row, at the thumbnail's own radius, so rest, hover, press and
        // selected are four intensities of one shape.
        "mx-1 flex cursor-default items-start gap-0 rounded-chip px-1 pb-2 select-none",
        "transition-colors duration-(--duration-fast) ease-(--ease-out-soft)",
        !(active || selected) && "hover:bg-accent active:bg-accent-active",
      )}
      style={{
        opacity: dragging ? 0.4 : 1,
        // Selection wears the open lesson's own accent, so the editor belongs to the deck in it;
        // focus stays on `--primary`. A row in the multi-selection but not open takes the same
        // accent one step quieter, with a hairline of the same tint.
        background: active
          ? tint(theme.colors.accent, 6)
          : selected
            ? tint(theme.colors.accent, 3)
            : undefined,
        boxShadow:
          selected && !active ? `inset 0 0 0 1px ${tint(theme.colors.accent, 14)}` : undefined,
      }}
    >
      <span
        aria-hidden
        data-tabular
        className={cn(
          "shrink-0 pt-1 text-right font-semibold text-meta tabular-nums",
          active ? "text-foreground" : "text-ink-3",
        )}
        style={{ width: geometry.numW - 4, marginRight: 4 }}
      >
        {number}
      </span>
      <span
        data-navigator-thumb
        className="relative block overflow-hidden rounded-chip transition-shadow duration-(--duration-base) ease-(--ease-out)"
        style={{
          width: geometry.thumbW,
          height: geometry.thumbH,
          // The open slide gets the system accent as a 2px ring; every other thumbnail keeps the
          // `--border` hairline, so the ring is the only ring in the rail.
          boxShadow: active ? "0 0 0 2px var(--primary)" : "0 0 0 1px var(--border)",
        }}
      >
        <SlideScaler zoom={geometry.thumbW / SLIDE_W}>
          <SlideView slide={slide} theme={theme} mode="thumb" />
        </SlideScaler>
        {hasNotes || hasSteps ? (
          <span className="absolute top-1 right-1 flex gap-1">
            {hasNotes ? (
              <span aria-hidden className="block size-2 rounded-full bg-[#2E9465]" />
            ) : null}
            {hasSteps ? (
              <span aria-hidden className="block size-2 rounded-full border border-[#2E9465]" />
            ) : null}
          </span>
        ) : null}
      </span>
    </div>
  );
});
