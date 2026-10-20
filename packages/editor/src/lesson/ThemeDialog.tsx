import type { Lesson, Slide } from "@tj/domain/documents";
import { Button, cn, Dialog, DialogContent, DialogHeader, DialogTitle } from "@tj/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { clearMeasureCache, createMeasurer, warmMeasurer } from "../layout/measure";
import { recolourSlide, rethemeFromReducer, rethemeMeasureInputs } from "../layout/retheme";
import { layoutKit, loadLayoutKit } from "../model/layout-kit";
import { boundAgeBand, getTheme, renderTheme } from "../model/themes";
import { lessonPicks, type ThemeSamples } from "../theme-picker/samples";
import { ThemePicker } from "../theme-picker/ThemePicker";
import { useHistory, useLesson } from "./document-context";

/*
 * The theme picker (TEACH-258, ruling 116; its entry point is ruling 123). One quiet callout names
 * the selected theme — under the slide stage while the lesson is made, in the editor's top bar once
 * it is editable — and opens the theme picker in a modal (`ThemePicker`, decision 34: each theme's
 * own cover and slides, fonts, colours and who it suits).
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

  // A re-theme re-lays every adaptive layout in the new faces: fetch the template code on open.
  useEffect(() => {
    void loadLayoutKit();
  }, []);

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
    if (themeId === opening.themeId || layoutKit()) return settle(themeId);
    // The template code is still loading: the final re-fit waits for it, or a saved deck's Answers
    // slides and adaptive layouts keep the old theme's measurements (TEACH-191 part d).
    void loadLayoutKit().then(
      () => settle(themeId),
      () => settle(themeId),
    );
  };
  const settle = (themeId: string) => {
    if (tx.current === null) return;
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

/** The picker (decision 34) with Cancel and Done. Stateless. */
function ThemeChoices({
  opening,
  selectedId,
  onPick,
  onCancel,
  onDone,
  applying = false,
}: {
  /** The lesson as the picker found it: the previews carry its title at its key stage. */
  opening: Lesson;
  selectedId: string;
  onPick: (themeId: string) => void;
  onCancel: () => void;
  onDone: () => void;
  applying?: boolean;
}) {
  // "See your lesson in this theme" (review 20 Oct): every tile and the large preview draw this
  // lesson's own cover and its most visual slides, recoloured by role into each theme (as the
  // canvas is while a lesson is made), built once per theme while the picker is open.
  const samplesFor = useMemo(() => {
    const picks = lessonPicks(opening);
    const from = renderTheme(opening);
    const built = new Map<string, ThemeSamples>();
    return (themeId: string): ThemeSamples => {
      const hit = built.get(themeId);
      if (hit) return hit;
      const to = renderTheme(opening, themeId);
      const inTheme = (slide: Slide) => recolourSlide(slide, from, to);
      const samples = {
        theme: to,
        cover: inTheme(picks.cover),
        visual: inTheme(picks.visual),
        layouts: picks.layouts.map(inTheme),
      };
      built.set(themeId, samples);
      return samples;
    };
  }, [opening]);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <ThemePicker
        selectedId={selectedId}
        onPick={onPick}
        title={opening.title}
        ageBand={boundAgeBand(opening)}
        samplesFor={samplesFor}
      />
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
      <DialogContent size="full" className="max-w-[1040px]" data-theme-dialog>
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
      <DialogContent size="full" className="max-w-[1040px]" data-theme-dialog>
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
  const from = renderTheme(lesson);
  const to = renderTheme(lesson, themeId);
  return {
    ...lesson,
    themeId: to.id,
    slides: lesson.slides.map((slide) => recolourSlide(slide, from, to)),
  };
}
