import { SLIDE_W, type SlideKind } from "@tj/domain/documents";
import { Button, Popover, PopoverContent, PopoverTrigger } from "@tj/ui";
import { type ReactElement, useMemo, useRef, useState } from "react";
import { PanelLabel } from "../kit/Panel";
import { newSlide } from "../model/factories";
import { SLIDE_KIND_DESCRIPTIONS, SLIDE_KIND_LABELS, SLIDE_KIND_ORDER } from "../model/layouts";
import { getTheme } from "../model/themes";
import { SlideScaler } from "../slide/SlideScaler";
import { SlideView } from "../slide/SlideView";

const PREVIEW_W = 144;
const PREVIEW_H = 81;
const COLS = 3;

/**
 * The kind picker (TeachDeck `components/v2/editor/AddSlidePicker.tsx`): a 3-column popover of real
 * 144x81 renders with the pedagogical name and a line saying what the slide does beneath, so the
 * teacher chooses a slide by recognising its shape rather than by reading a list of nouns.
 */
export function AddSlidePicker({
  themeId,
  onPick,
  trigger,
  side = "top",
  align = "start",
}: {
  themeId: string;
  onPick: (kind: SlideKind) => void;
  trigger: ReactElement;
  side?: "top" | "bottom" | "right";
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent side={side} align={align} className="w-[520px] p-0" aria-label="Add slide">
        <Grid
          themeId={themeId}
          onPick={(kind) => {
            onPick(kind);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function Grid({ themeId, onPick }: { themeId: string; onPick: (kind: SlideKind) => void }) {
  const theme = useMemo(() => getTheme(themeId), [themeId]);
  const previews = useMemo(
    () => SLIDE_KIND_ORDER.map((kind) => ({ kind, slide: newSlide(kind, themeId) })),
    [themeId],
  );
  const grid = useRef<HTMLDivElement>(null);
  // Roving tabindex: one preview is ever a Tab stop, so the other 18 do not queue up behind it.
  const [active, setActive] = useState(0);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step =
      e.key === "ArrowRight"
        ? 1
        : e.key === "ArrowLeft"
          ? -1
          : e.key === "ArrowDown"
            ? COLS
            : e.key === "ArrowUp"
              ? -COLS
              : 0;
    if (!step) return;
    e.preventDefault();
    const items = Array.from(grid.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = Math.min(items.length - 1, Math.max(0, (i < 0 ? 0 : i) + step));
    setActive(next);
    items[next]?.focus();
  };

  return (
    <div className="flex flex-col gap-2 p-3">
      <PanelLabel className="px-0.5">Add slide</PanelLabel>
      {/* A menu of layout choices drawn as pictures: the keyboard model is a menu's, so the roles say so. */}
      <div
        ref={grid}
        role="menu"
        aria-label="Slide kinds"
        className="grid max-h-[460px] grid-cols-3 gap-3 overflow-y-auto"
      >
        {previews.map(({ kind, slide }, i) => (
          <Button
            key={kind}
            variant="ghost"
            role="menuitem"
            // The name is the kind, not the preview's own words plus the description.
            aria-label={SLIDE_KIND_LABELS[kind]}
            aria-description={SLIDE_KIND_DESCRIPTIONS[kind]}
            tabIndex={i === active ? 0 : -1}
            onFocus={() => setActive(i)}
            onKeyDown={onKeyDown}
            onClick={() => onPick(kind)}
            className="group/kind h-auto w-full items-stretch justify-start rounded-control p-1 text-left font-normal"
          >
            <span className="flex w-full flex-col items-stretch gap-1 self-start">
              <span
                aria-hidden
                className="block overflow-hidden rounded-chip shadow-[0_0_0_1px_var(--border)] group-hover/kind:shadow-[0_0_0_1px_var(--border-strong)]"
                style={{ width: PREVIEW_W, height: PREVIEW_H }}
              >
                <SlideScaler zoom={PREVIEW_W / SLIDE_W}>
                  <SlideView slide={slide} theme={theme} mode="thumb" />
                </SlideScaler>
              </span>
              <span className="truncate text-ink-2 text-meta group-hover/kind:text-foreground">
                {SLIDE_KIND_LABELS[kind]}
              </span>
              <span className="line-clamp-2 whitespace-normal text-eyebrow text-ink-3">
                {SLIDE_KIND_DESCRIPTIONS[kind]}
              </span>
            </span>
          </Button>
        ))}
      </div>
    </div>
  );
}
