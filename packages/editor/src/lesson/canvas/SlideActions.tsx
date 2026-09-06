import type { Slide } from "@tj/domain/documents";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Tooltip,
} from "@tj/ui";
import { ChevronDown, ChevronUp, Copy, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { type ReactNode, type RefObject, useMemo } from "react";
import { Panel, PanelSeparator } from "../../kit/Panel";
import { AddSlidePicker } from "../AddSlidePicker";
import { useHistory, useLesson } from "../document-context";
import { hint } from "../keys";
import { addSlideAfter, deleteSlide, duplicateSlide, moveSlideBy } from "../slide-commands";
import { useActiveSlideId, useSessionActions } from "../use-editor-session";
import { CHROME_MIN_TOP, placeSlideActions } from "./place-slide-actions";
import { useSlideChrome } from "./use-slide-chrome";

// 20px is the contextual toolbar's allowance, and this pill floats in the same band.
const ICON = { size: 20, strokeWidth: 1.5 } as const;

/**
 * The slide's own actions, in a pill anchored to the top-right of the slide frame (TeachDeck
 * `components/v2/editor/canvas/SlideActions.tsx`). Rendered in screen space, like the selection
 * frame, so it neither scales nor moves with the zoom; hidden during a drag, resize or rotate and
 * while text is being edited. It shares the band above the slide with the Question / Answer tabs
 * and is the one that gives way.
 */
export function SlideActions({
  slide,
  stageRef,
  tabsRef,
  scale,
}: {
  slide: Slide;
  /** The 960x540 slide frame. */
  stageRef: RefObject<HTMLDivElement | null>;
  /** The Question / Answer tabs' wrapper: the other end of the same band. */
  tabsRef?: RefObject<HTMLDivElement | null>;
  scale: number;
}) {
  const lesson = useLesson();
  const history = useHistory();
  const session = useSessionActions();
  const activeSlideId = useActiveSlideId();
  const slideCount = lesson.slides.length;
  const index = lesson.slides.findIndex((sl) => sl.id === slide.id);

  const avoidRefs = useMemo(() => (tabsRef ? [tabsRef] : []), [tabsRef]);
  const { barRef, frame, avoid, size, viewport, hidden } = useSlideChrome({
    stageRef,
    avoidRefs,
    deps: [slide.id, index, scale, slideCount],
  });

  if (hidden || !frame) return null;
  const id = slide.id;
  const deps = { history, lesson, session };

  const { left, top: placedTop } = placeSlideActions({
    slide: frame,
    pill: { w: size.w, h: size.h },
    viewport,
    avoid,
  });
  // Floating chrome never rides nearer the top than the bar plus the panel gap (72px).
  const top = Math.max(placedTop, CHROME_MIN_TOP);
  const only = slideCount <= 1;

  return (
    // The kit's floating plate: `--shadow-2` carries the 1px ring, so there is no border.
    <Panel
      ref={barRef}
      data-slide-actions
      aria-label="Slide actions"
      style={{
        position: "fixed",
        left,
        top,
        zIndex: 41,
        visibility: size.w === 0 ? "hidden" : undefined,
      }}
    >
      <PillButton
        label="Duplicate slide"
        shortcut={hint("$mod+d")}
        onClick={() => duplicateSlide(deps, id)}
      >
        <Copy aria-hidden {...ICON} />
      </PillButton>

      <AddSlidePicker
        themeId={lesson.themeId}
        side="bottom"
        onPick={(kind) => addSlideAfter(deps, id, kind)}
        trigger={
          <PillButton label="Add slide after">
            <Plus aria-hidden {...ICON} />
          </PillButton>
        }
      />

      {/* The name carries the reason it is off: a screen reader gets the same sentence the tooltip shows. */}
      <PillButton
        label={only ? "Delete slide. A lesson needs at least one slide" : "Delete slide"}
        tooltipLabel={only ? "A lesson needs at least one slide" : undefined}
        disabled={only}
        onClick={() => deleteSlide(deps, id, activeSlideId)}
      >
        <Trash2 aria-hidden {...ICON} />
      </PillButton>

      <PanelSeparator />

      {/* Reordering only. Change layout belongs to the slide toolbar's kind dropdown (TEACH-105). */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <PillButton label="More slide actions" tooltip={false}>
            <MoreHorizontal aria-hidden {...ICON} />
          </PillButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={index <= 0} onSelect={() => moveSlideBy(deps, id, -1)}>
            <ChevronUp aria-hidden size={16} strokeWidth={1.5} />
            Move up
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={index < 0 || index >= slideCount - 1}
            onSelect={() => moveSlideBy(deps, id, 1)}
          >
            <ChevronDown aria-hidden size={16} strokeWidth={1.5} />
            Move down
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */

type PillButtonProps = Omit<React.ComponentProps<"button">, "disabled"> & {
  label: string;
  /** Tooltip text when it has to say more than the button's name. */
  tooltipLabel?: string;
  shortcut?: string;
  disabled?: boolean;
  tooltip?: boolean;
  children: ReactNode;
};

/**
 * `IconButton` with `disabled` never set: the kit's disabled state takes the button out of the
 * pointer stream and suppresses its tooltip, so the one control that most needs to say why it is
 * off — Delete, on the last slide — could not. `aria-disabled` keeps the focus stop; the handler is
 * guarded instead.
 */
function PillButton({
  label,
  tooltipLabel,
  shortcut,
  disabled,
  tooltip = true,
  children,
  onClick,
  ...rest
}: PillButtonProps) {
  const button = (
    <IconButton
      label={label}
      noTooltip
      aria-disabled={disabled || undefined}
      className={
        disabled ? "cursor-default opacity-50 hover:bg-transparent hover:text-ink-2" : undefined
      }
      onClick={(e) => {
        if (disabled) return;
        onClick?.(e);
      }}
      {...rest}
    >
      {children}
    </IconButton>
  );
  if (!tooltip) return button;
  return (
    <Tooltip label={tooltipLabel ?? label} shortcut={shortcut}>
      {button}
    </Tooltip>
  );
}
