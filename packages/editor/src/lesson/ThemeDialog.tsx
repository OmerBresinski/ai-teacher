import { SLIDE_W, type Slide, type ThemeTag } from "@tj/domain/documents";
import { Button, cn, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@tj/ui";
import { Check } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { newSlide } from "../model/factories";
import * as reducers from "../model/reducers";
import { getTheme, THEME_TAG_LABELS, THEMES } from "../model/themes";
import { SlideScaler } from "../slide/SlideScaler";
import { SlideView } from "../slide/SlideView";
import { useHistory, useLesson } from "./document-context";
import { useActiveSlide } from "./use-editor-session";

const PREVIEW_W = 184;
const TAGS: (ThemeTag | "all")[] = [
  "all",
  "early-learners",
  "low-stimulation",
  "dyslexia",
  "low-vision",
  "adhd",
  "dark",
];

/** What a theme actually differs on: a body face, a type ladder, numbered items. */
const CONTENT_FIRST: Slide["kind"][] = ["objectives", "vocabulary"];

/**
 * The theme picker (TeachDeck `ThemeDialog`) paints the slide the teacher is actually looking at,
 * so the choice is made on their own words rather than on a stock sample.
 *
 * The whole dialog is one history transaction: it opens on mount-open, every tile click dispatches
 * `setTheme` inside it (the canvas previews live, nothing is recorded or saved), Done ends it (one
 * undo step, one autosave), and Cancel — button, Esc, backdrop — rolls it back, so a browse through
 * the six themes leaves no trace in the history and costs no save.
 */
export function ThemeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const lesson = useLesson();
  const history = useHistory();
  const slide = useActiveSlide(lesson.slides);
  const [tag, setTag] = useState<ThemeTag | "all">("all");
  const themes = useMemo(
    () => (tag === "all" ? THEMES : THEMES.filter((t) => t.tags.includes(tag))),
    [tag],
  );

  // A title slide is the one slide on which the six themes look alike, so preview a content slide
  // instead — still the teacher's own, from the same lesson.
  const preview = useMemo(() => {
    if (slide && slide.kind !== "title") return slide;
    const own =
      lesson.slides.find((s) => CONTENT_FIRST.includes(s.kind)) ??
      lesson.slides.find((s) => s.kind !== "title");
    return own ?? newSlide("objectives", lesson.themeId);
  }, [slide, lesson.slides, lesson.themeId]);

  // The transaction follows the committed open state: opened in an effect (never during render),
  // and rolled back if the dialog unmounts with it still open.
  const historyRef = useRef(history);
  historyRef.current = history;
  const inTx = useRef(false);
  useEffect(() => {
    if (!open) return;
    historyRef.current.beginTransaction();
    inTx.current = true;
    return () => {
      if (inTx.current) historyRef.current.rollbackTransaction();
      inTx.current = false;
    };
  }, [open]);

  const setTheme = (id: string) => history.dispatch(reducers.setTheme, id);
  const done = () => {
    if (inTx.current) history.endTransaction();
    inTx.current = false;
    onClose();
  };
  const cancel = () => {
    if (inTx.current) history.rollbackTransaction();
    inTx.current = false;
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && cancel()}>
      <DialogContent size="lg" data-theme-dialog>
        <DialogHeader>
          <DialogTitle>Theme</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <fieldset className="m-0 flex flex-wrap gap-1 border-0 p-0" aria-label="Filter themes">
            {TAGS.map((t) => (
              <Button
                key={t}
                variant="ghost"
                size="sm"
                aria-pressed={tag === t}
                onClick={() => setTag(t)}
                className={cn(
                  "h-6 rounded-full border px-2.5 font-semibold text-eyebrow",
                  // The selected chip is ink on paper inverted: the accent tint (3.3:1) and the
                  // accent fill (3.7:1) both fall under AA for 12px type.
                  tag === t
                    ? "border-foreground bg-foreground text-background hover:bg-foreground hover:text-background"
                    : "border-border bg-muted text-ink-3 hover:bg-accent hover:text-foreground",
                )}
              >
                {t === "all" ? "All" : THEME_TAG_LABELS[t]}
              </Button>
            ))}
          </fieldset>

          <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-3">
            {themes.map((theme) => {
              const selected = theme.id === lesson.themeId;
              return (
                <Button
                  key={theme.id}
                  variant="ghost"
                  role="radio"
                  aria-checked={selected}
                  aria-label={theme.name}
                  data-theme-tile={theme.id}
                  onClick={() => setTheme(theme.id)}
                  className="group/theme h-auto w-full items-stretch justify-start rounded-control p-0 text-left font-normal"
                >
                  <span className="flex w-full flex-col items-stretch gap-1.5 self-start">
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
                        <SlideView slide={preview} theme={getTheme(theme.id)} mode="thumb" />
                      </SlideScaler>
                      {/* The one place a theme's accent is visible at 184px wide. */}
                      <span
                        className="absolute inset-x-px top-px h-[3px]"
                        style={{ background: theme.colors.accent }}
                      />
                      {selected ? (
                        <span className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                          <Check size={16} strokeWidth={1.5} />
                        </span>
                      ) : null}
                    </span>
                    {/* Each name in its own theme's title face. */}
                    <span
                      className="text-body text-foreground"
                      style={{ fontFamily: theme.fonts.title }}
                    >
                      {theme.name}
                    </span>
                    <span className="-mt-1 line-clamp-2 whitespace-normal text-eyebrow text-ink-3">
                      {theme.suits}
                    </span>
                  </span>
                </Button>
              );
            })}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={cancel}>
            Cancel
          </Button>
          <Button onClick={done}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
