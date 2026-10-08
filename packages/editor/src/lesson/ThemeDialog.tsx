import { type Lesson, SLIDE_W, type Slide } from "@tj/domain/documents";
import { Button, cn, Dialog, DialogContent, DialogHeader, DialogTitle } from "@tj/ui";
import { Check } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { clearMeasureCache, createMeasurer, warmMeasurer } from "../layout/measure";
import { recolourSlide, rethemeFromReducer, rethemeMeasureInputs } from "../layout/retheme";
import { newSlide } from "../model/factories";
import { getTheme, lessonTheme, THEMES } from "../model/themes";
import { SlideScaler } from "../slide/SlideScaler";
import { SlideView } from "../slide/SlideView";
import { useHistory, useLesson } from "./document-context";

const PREVIEW_W = 132;

/*
 * The theme picker (TEACH-258, ruling 116; its entry point is ruling 123). One quiet callout names
 * the selected theme — under the slide stage while the lesson is made, in the editor's top bar once
 * it is editable — and opens a compact set of themes in a modal, each drawn as the teacher's own
 * title slide.
 *
 * The whole browse is one history transaction: it opens when the panel mounts; every tile click
 * re-themes the lesson *from the one it opened with* and re-fits it (`rethemeLesson`), so the
 * canvas and the slide rail preview the real result, nothing is recorded and nothing is saved.
 * Done waits for the chosen theme's faces, re-fits once more with them, and ends the transaction
 * (one undo step, one autosave; undo gives back the old theme with the old geometry). Cancel —
 * button, Esc, a click outside — rolls it back, so a browse leaves no trace.
 */

/** How long Done waits for a theme's faces before it measures with what it has. */
const FACES_TIMEOUT_MS = 1500;

/**
 * The theme's faces, loaded before anything is measured in them: `null` when there is nothing to
 * wait for (already loaded — the tiles drew them — or no font API), else a promise that never
 * rejects and settles within `FACES_TIMEOUT_MS`.
 */
function themeFacesPending(themeId: string): Promise<unknown> | null {
  const { fonts } = getTheme(themeId);
  const faces = [`400 32px ${fonts.body}`, `700 32px ${fonts.title}`];
  const api = typeof document === "undefined" ? undefined : document.fonts;
  if (!api?.load) return null;
  try {
    if (faces.every((face) => api.check(face))) return null;
  } catch {
    return null;
  }
  return Promise.race([
    Promise.all(faces.map((face) => api.load(face))).catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, FACES_TIMEOUT_MS)),
  ]);
}

/** The teacher's own title slide, or a title slide in the lesson's theme when it has none. */
function coverOf(lesson: Lesson): Slide {
  return lesson.slides.find((s) => s.kind === "title") ?? newSlide("title", lesson.themeId);
}

/** The themes, the preview and the transaction. Mounted only while the picker is open. */
function ThemePanel({ onClose }: { onClose: () => void }) {
  const lesson = useLesson();
  const history = useHistory();
  const historyRef = useRef(history);
  historyRef.current = history;
  const lessonRef = useRef(lesson);
  lessonRef.current = lesson;
  // The lesson as the picker found it: every preview starts from here, so browsing never stacks.
  const [opening] = useState(lesson);
  const tx = useRef<number | null>(null);
  const [applying, setApplying] = useState(false);

  // Opened in an effect (never during render), rolled back if the panel unmounts still open.
  // Opening first commits whatever else was in flight, so Cancel can never discard another edit.
  useEffect(() => {
    const h = historyRef.current;
    h.flushTransactions();
    tx.current = h.beginTransaction();
    return () => {
      if (tx.current !== null) h.rollbackTransaction(tx.current);
      tx.current = null;
    };
  }, []);

  const preview = (themeId: string) => {
    // Done is waiting for the chosen theme's faces: the choice is made.
    if (tx.current === null || applying) return;
    const theme = getTheme(themeId);
    historyRef.current.dispatch(rethemeFromReducer, opening, themeId, createMeasurer(theme));
  };

  const commit = () => {
    if (tx.current === null) return;
    const themeId = lessonRef.current.themeId;
    if (themeId !== opening.themeId) {
      // The faces are loaded now: measure again, from the opening lesson, with the real type.
      const theme = getTheme(themeId);
      clearMeasureCache();
      warmMeasurer(rethemeMeasureInputs(opening), theme);
      historyRef.current.dispatch(rethemeFromReducer, opening, themeId, createMeasurer(theme));
    }
    historyRef.current.endTransaction(tx.current);
    tx.current = null;
    onClose();
  };
  const done = () => {
    if (tx.current === null || applying) return;
    const themeId = lessonRef.current.themeId;
    const pending = themeId === opening.themeId ? null : themeFacesPending(themeId);
    if (!pending) return commit();
    setApplying(true);
    void pending.then(() => {
      setApplying(false);
      // Cancelled while the faces loaded: the rollback already ran and `commit` does nothing.
      commit();
    });
  };
  const cancel = () => {
    if (tx.current !== null) historyRef.current.rollbackTransaction(tx.current);
    tx.current = null;
    onClose();
  };

  return (
    <ThemeChoices
      opening={opening}
      selectedId={lesson.themeId}
      onPick={preview}
      onCancel={cancel}
      onDone={done}
      applying={applying}
    />
  );
}

/** The six themes drawn as the lesson's title slide, with Cancel and Done. Stateless. */
function ThemeChoices({
  opening,
  selectedId,
  onPick,
  onCancel,
  onDone,
  applying = false,
}: {
  /** The lesson as the picker found it: the tiles draw its cover, recoloured from its theme. */
  opening: Lesson;
  selectedId: string;
  onPick: (themeId: string) => void;
  onCancel: () => void;
  onDone: () => void;
  applying?: boolean;
}) {
  const cover = useMemo(() => coverOf(opening), [opening]);
  return (
    <div className="flex flex-col gap-3">
      <div
        role="radiogroup"
        aria-label="Theme"
        className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-2"
      >
        {THEMES.map((theme) => {
          const selected = theme.id === selectedId;
          return (
            <Button
              key={theme.id}
              variant="ghost"
              role="radio"
              aria-checked={selected}
              aria-label={theme.name}
              data-theme-tile={theme.id}
              onClick={() => onPick(theme.id)}
              className="group/theme h-auto w-full items-stretch justify-start rounded-control p-0 text-left font-normal"
            >
              <span className="flex w-full flex-col items-stretch gap-1 self-start">
                <span
                  aria-hidden
                  className={cn(
                    "relative block overflow-hidden rounded-chip",
                    selected
                      ? "shadow-[0_0_0_1px_var(--background),0_0_0_2.5px_var(--primary)]"
                      : "shadow-[0_0_0_1px_var(--border)] group-hover/theme:shadow-[0_0_0_1px_var(--border-strong)]",
                  )}
                  style={{ width: PREVIEW_W, height: Math.round((PREVIEW_W * 9) / 16) }}
                >
                  <SlideScaler zoom={PREVIEW_W / SLIDE_W}>
                    <SlideView
                      slide={recolourSlide(cover, getTheme(opening.themeId), theme)}
                      theme={theme}
                      mode="thumb"
                    />
                  </SlideScaler>
                  {selected ? (
                    <span className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check size={12} strokeWidth={2} />
                    </span>
                  ) : null}
                </span>
                <span className="truncate text-meta text-foreground">{theme.name}</span>
              </span>
            </Button>
          );
        })}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" disabled={applying} onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

/**
 * The selected-theme callout (ruling 123): the lesson's theme named beside its swatch, read as
 * information rather than a question. It has no motion of its own. A click opens the picker. It
 * sits under the slide stage while the lesson is made and in the editor's top bar once it is
 * editable; nothing else opens the picker.
 */
export function ThemeCallout({
  themeId,
  onClick,
  compact = false,
  className,
}: {
  themeId: string;
  onClick: () => void;
  /** Just the swatch and the name, for a phone's top bar. */
  compact?: boolean;
  className?: string;
}) {
  const theme = getTheme(themeId);
  return (
    <Button
      variant="ghost"
      size="sm"
      data-theme-callout={theme.id}
      aria-label={`Theme: ${theme.name}`}
      aria-haspopup="dialog"
      onClick={onClick}
      className={cn("h-7 min-w-0 gap-1.5 px-2 font-normal text-ink-2", className)}
    >
      <span
        aria-hidden
        data-theme-swatch
        className="relative size-3.5 shrink-0 overflow-hidden rounded-full shadow-[0_0_0_1px_var(--border-strong)]"
        style={{ background: theme.colors.background }}
      >
        <span
          className="absolute inset-y-0 right-0 w-1/2"
          style={{ background: theme.colors.accent }}
        />
      </span>
      <span className="truncate">
        {compact ? null : (
          <>
            <span className="text-ink-3">Theme</span>
            <span aria-hidden className="text-ink-3">
              {" · "}
            </span>
          </>
        )}
        {theme.name}
      </span>
    </Button>
  );
}

/** The picker in a modal, editing the open lesson as one undo step (the editor's top bar). */
export function ThemeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg" data-theme-dialog>
        <DialogHeader>
          <DialogTitle>Theme</DialogTitle>
        </DialogHeader>
        {open ? <ThemePanel onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The same modal while the lesson is still being made (ruling 123). There is no editor history
 * yet, so the app holds the theme: every tile click calls `onChange` and the app re-draws the
 * slides made and still arriving in it; Done keeps it; Cancel, Esc or a click outside puts back
 * the theme the picker opened on.
 */
export function GeneratingThemeDialog({
  open,
  lesson,
  onChange,
  onClose,
}: {
  open: boolean;
  /** The lesson as shown, in the theme it is shown in. */
  lesson: Lesson;
  onChange: (themeId: string) => void;
  onClose: () => void;
}) {
  const [opening, setOpening] = useState<Lesson | null>(null);
  if (open && !opening) setOpening(lesson);
  if (!open && opening) setOpening(null);
  const cancel = () => {
    if (opening && lesson.themeId !== opening.themeId) onChange(opening.themeId);
    onClose();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && cancel()}>
      <DialogContent size="lg" data-theme-dialog>
        <DialogHeader>
          <DialogTitle>Theme</DialogTitle>
        </DialogHeader>
        {open && opening ? (
          <ThemeChoices
            opening={opening}
            selectedId={lesson.themeId}
            onPick={onChange}
            onCancel={cancel}
            onDone={onClose}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The lesson drawn in `themeId` while it is still being made: the theme set and the recipes'
 * palette recoloured by role (`recolourSlide`), without the re-fit, which runs once at Ready.
 */
export function displayInTheme<L extends Lesson>(lesson: L, themeId: string | null | undefined): L {
  if (!themeId || themeId === lesson.themeId) return lesson;
  const from = lessonTheme(lesson);
  const to = lessonTheme(lesson, themeId);
  return {
    ...lesson,
    themeId: to.id,
    slides: lesson.slides.map((slide) => recolourSlide(slide, from, to)),
  };
}
