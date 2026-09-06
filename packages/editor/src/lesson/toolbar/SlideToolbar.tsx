import type { Slide, SlideKind, Theme, TransitionId } from "@tj/domain/documents";
import {
  ConfirmDialog,
  DropdownMenuLabel,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Textarea,
  Tooltip,
  toast,
} from "@tj/ui";
import { ImagePlus, WandSparkles } from "lucide-react";
import { Fragment, memo, useState } from "react";
import { ColorPicker } from "../../kit/Color";
import { Panel, PanelSeparator } from "../../kit/Panel";
import { createMeasurer } from "../../layout/measure";
import { type TidyOutcome, tidyMessage, tidySlideReducer } from "../../layout/tidy";
import { SLIDE_KIND_LABELS, SLIDE_KIND_ORDER } from "../../model/layouts";
import * as reducers from "../../model/reducers";
import { useEditSession } from "../../model/use-edit-session";
import { useHistory } from "../document-context";
import { AnswerDrawer } from "./AnswerDrawer";
import { BarButton, DropTrigger, ICON, useThemePalette } from "./shared";

const TRANSITIONS: { value: TransitionId; label: string }[] = [
  { value: "none", label: "None" },
  { value: "fade", label: "Fade" },
  { value: "push", label: "Push" },
  { value: "morph", label: "Morph" },
];

const NOTHING_TO_TIDY: TidyOutcome = {
  moved: 0,
  stepped: 0,
  continued: 0,
  overflow: [],
  laneOverflow: [],
  changed: false,
};

/** Where the picker's list stops being lesson furniture and starts being questions. */
const FIRST_QUESTION_KIND: SlideKind = "true-false";

/**
 * The slide toolbar (TeachDeck `SlideToolbar`): kind/layout, background, transition, notes, the
 * answer drawer, Tidy. Background *image* and Tidy are off until TEACH-107 and TEACH-106.
 * Duplicate / Add after / Delete live on the slide's action pill — one home per action.
 */
export const SlideToolbar = memo(function SlideToolbar({
  slide,
  theme,
}: {
  slide: Slide;
  theme: Theme;
}) {
  const history = useHistory();
  const notes = useEditSession(history);
  const [convertTo, setConvertTo] = useState<SlideKind | null>(null);
  const palette = useThemePalette(theme);

  const currentTransition =
    TRANSITIONS.find((t) => t.value === (slide.transition ?? "fade")) ?? TRANSITIONS[1];

  return (
    <Panel as="bar" role="toolbar" aria-label="Slide" data-slide-toolbar>
      <DropTrigger label="Slide layout" value={slide.kind} text={SLIDE_KIND_LABELS[slide.kind]}>
        <DropdownMenuLabel>Convert this slide to</DropdownMenuLabel>
        {SLIDE_KIND_ORDER.map((kind) => (
          <Fragment key={kind}>
            {kind === FIRST_QUESTION_KIND ? <DropdownMenuSeparator /> : null}
            <DropdownMenuRadioItem
              value={kind}
              onSelect={() => kind !== slide.kind && setConvertTo(kind)}
            >
              {SLIDE_KIND_LABELS[kind]}
            </DropdownMenuRadioItem>
          </Fragment>
        ))}
      </DropTrigger>

      <PanelSeparator />

      <ColorPicker
        label="Slide background"
        value={slide.background?.color ?? theme.colors.background}
        palette={palette}
        onChange={(color) =>
          history.dispatch(reducers.setSlideBackground, slide.id, { ...slide.background, color })
        }
      />
      <Tooltip label="Background images arrive with a later release">
        <span className="inline-flex">
          <IconButton
            label="Background image"
            noTooltip
            aria-disabled="true"
            className="opacity-50"
          >
            <ImagePlus aria-hidden {...ICON} />
          </IconButton>
        </span>
      </Tooltip>

      <PanelSeparator />

      <DropTrigger
        label="Transition"
        value={currentTransition?.value ?? "fade"}
        text={currentTransition?.label}
      >
        <DropdownMenuLabel>Transition</DropdownMenuLabel>
        {TRANSITIONS.map((t) => (
          <DropdownMenuRadioItem
            key={t.value}
            value={t.value}
            onSelect={() =>
              history.dispatch(reducers.updateSlide, slide.id, { transition: t.value })
            }
          >
            {t.label}
          </DropdownMenuRadioItem>
        ))}
      </DropTrigger>

      <Popover onOpenChange={(open) => !open && notes.end()}>
        <PopoverTrigger asChild>
          <BarButton>{slide.notes?.trim() ? "Notes ·" : "Notes"}</BarButton>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[300px] p-3" aria-label="Presenter notes">
          <Textarea
            rows={6}
            value={slide.notes ?? ""}
            aria-label="Presenter notes"
            placeholder="What you will say, and the questions you will ask."
            onChange={(e) =>
              notes.run(() => history.dispatch(reducers.setSlideNotes, slide.id, e.target.value))
            }
            onBlur={notes.end}
          />
        </PopoverContent>
      </Popover>

      {slide.question ? <AnswerDrawer slide={slide} question={slide.question} /> : null}

      <PanelSeparator />

      {/* The text fitting engine, on demand: measures the slide with the real theme faces, grows
          every auto-height box to its type, pushes what collides down the 7pt rhythm, steps
          heading/body/small down a stop if the slide still overruns, and continues a long list on
          a new slide rather than going below the 24pt floor. One reducer, so one undo step. */}
      <IconButton
        label="Tidy slide"
        onClick={() => {
          const made = history.dispatch(tidySlideReducer, slide.id, createMeasurer(theme));
          toast(tidyMessage(made?.outcome ?? NOTHING_TO_TIDY));
        }}
      >
        <WandSparkles aria-hidden {...ICON} />
      </IconButton>

      <ConfirmDialog
        open={convertTo !== null}
        onOpenChange={(open) => !open && setConvertTo(null)}
        title={convertTo ? `Convert to ${SLIDE_KIND_LABELS[convertTo].toLowerCase()}?` : ""}
        body="This replaces everything on the slide with the new layout. Your presenter notes, transition and background are kept, and one undo puts it back."
        confirmLabel="Convert"
        destructive={false}
        onConfirm={() => {
          if (convertTo) history.dispatch(reducers.changeLayout, slide.id, convertTo);
          setConvertTo(null);
        }}
      />
    </Panel>
  );
});
