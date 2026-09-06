import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
} from "@tj/ui";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Crosshair,
  Eraser,
  Grid2x2,
  Highlighter,
  MoreHorizontal,
  Pen,
  Timer as TimerIcon,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { Panel } from "../kit/Panel";
import type { PresentTool } from "./present-reducer";
import { StageButton, StageDivider } from "./StageButton";
import { paper, STAGE_PILL_STYLE, STAGE_SCOPE_CLASS } from "./stage-tokens";
import { TimerPanel } from "./TimerPanel";
import { nextLabel, timerFinished, timerTicking } from "./timer";
import { useStageHover, useStageIdle } from "./use-idle";
import { useNow } from "./use-now";
import { usePresent } from "./use-present-session";

/*
 * The one piece of chrome on the stage (TeachDeck `components/v2/present/Controls.tsx`): a pill at
 * the bottom right that appears when the teacher moves the mouse and fades two seconds later, so
 * a slide is never permanently covered. The step dots are a segment inside it, so the pill is one
 * object.
 */

const ICON = { size: 16, strokeWidth: 1.5 } as const;

/** A countdown that has run out stays red on the bottom pill until it is cleared. */
const DONE_STYLE = {
  color: "var(--destructive)",
  boxShadow: "inset 0 0 0 1.5px var(--destructive)",
} as const;

const PILL_STYLE = {
  ...STAGE_PILL_STYLE,
  height: 36,
  gap: 2,
  borderRadius: 999,
  paddingInline: 6,
} as const;

/** Pen, highlighter, laser, eraser — the laser sits between them because it is the other thing you point with. */
const INK_TOOLS: {
  tool: Exclude<PresentTool, "none">;
  label: string;
  key: string;
  icon: React.ReactNode;
}[] = [
  { tool: "pen", label: "Pen", key: "P", icon: <Pen {...ICON} /> },
  { tool: "highlighter", label: "Highlighter", key: "H", icon: <Highlighter {...ICON} /> },
];

export type ControlsProps = {
  slideCount: number;
  /** Reveal steps on the current slide; 0 means the slide advances in one go. */
  stepCount: number;
  /** The current slide asks something, so its last step is the answer. */
  isQuestion?: boolean;
  onExit: () => void;
};

export function Controls({ slideCount, stepCount, isQuestion = false, onExit }: ControlsProps) {
  const { state, dispatch, ink } = usePresent();
  const { index, step, tool, laser, timerOpen, pillCollapsed: collapsed, timer } = state;
  const slideId = state.slideIds[index];
  const hasInk = slideId ? ink.hasInk(slideId) : false;

  const [menuOpen, setMenuOpen] = useState(false);
  const { hovering, bind: hover } = useStageHover();

  /**
   * Chrome that fades on idle must not fade out from under the keyboard (WCAG 2.4.7). Focus holds
   * the pill exactly as the pointer does; `relatedTarget` is where focus is going, so moving
   * between two buttons inside the pill does not blink it.
   */
  const [focused, setFocused] = useState(false);
  const focus = {
    onFocusCapture: () => setFocused(true),
    onBlurCapture: (e: React.FocusEvent<HTMLDivElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
    },
  };

  const visible = useStageIdle(menuOpen || timerOpen || hovering || focused);

  // A whole second is plenty here: the only thing this clock decides is whether the timer button
  // has gone red.
  const now = useNow(timerTicking(timer), 1000);
  const timerDone = timerFinished(timer, now);

  const reveal = nextLabel(step, stepCount, isQuestion);

  // Collapsing takes any panel anchored to the pill with it: a popover whose trigger has just
  // unmounted has nothing left to point at.
  const collapse = () => {
    setMenuOpen(false);
    dispatch({ type: "setTimerOpen", open: false });
    dispatch({ type: "setPillCollapsed", collapsed: true });
  };

  const counter = (
    <Tooltip label="Overview" shortcut="O" contentClassName={STAGE_SCOPE_CLASS}>
      <Button
        variant="ghost"
        size="sm"
        aria-label={`Slide ${index + 1} of ${slideCount}. Open overview`}
        onClick={() => dispatch({ type: "setOverviewOpen", open: true })}
      >
        <span className="tabular-nums">
          {index + 1} / {slideCount}
        </span>
      </Button>
    </Tooltip>
  );

  if (collapsed) {
    return (
      <div
        className="td-autohide absolute right-5 bottom-5 z-[440]"
        data-hidden={!visible}
        {...hover}
        {...focus}
      >
        <Panel style={PILL_STYLE}>
          {counter}
          {/* The steps left on this slide are the one number no other presenter tool shows. */}
          {stepCount > 0 ? <StepDots step={step} total={stepCount} /> : null}
          <StageDivider />
          <Tooltip label="Expand" shortcut="C" contentClassName={STAGE_SCOPE_CLASS}>
            <StageButton
              label="Expand controls"
              onClick={() => dispatch({ type: "setPillCollapsed", collapsed: false })}
            >
              <ChevronsLeft {...ICON} />
            </StageButton>
          </Tooltip>
        </Panel>
      </div>
    );
  }

  return (
    <div
      className="td-autohide absolute right-5 bottom-5 z-[440]"
      data-hidden={!visible}
      {...hover}
      {...focus}
    >
      <Panel style={PILL_STYLE}>
        {counter}
        {stepCount > 0 ? <StepDots step={step} total={stepCount} /> : null}

        <StageDivider />

        <Tooltip label="Previous" shortcut="←" contentClassName={STAGE_SCOPE_CLASS}>
          <StageButton
            label="Previous"
            onClick={() => dispatch({ type: "prev" })}
            disabled={index === 0 && step === 0}
          >
            <ChevronLeft {...ICON} />
          </StageButton>
        </Tooltip>
        {reveal ? (
          // A slide that uncovers says so: the label is the whole point of the control.
          <Tooltip label={reveal} shortcut="→" contentClassName={STAGE_SCOPE_CLASS}>
            <Button
              variant="ghost"
              size="sm"
              aria-label={reveal}
              onClick={() => dispatch({ type: "next" })}
            >
              {reveal}
              <ChevronRight {...ICON} />
            </Button>
          </Tooltip>
        ) : (
          <Tooltip label="Next" shortcut="→" contentClassName={STAGE_SCOPE_CLASS}>
            <StageButton label="Next" onClick={() => dispatch({ type: "next" })}>
              <ChevronRight {...ICON} />
            </StageButton>
          </Tooltip>
        )}

        <StageDivider />

        {/* The four things you can point or draw with are one set; the separators carry the grouping. */}
        <fieldset className="m-0 flex min-w-0 items-center gap-0.5 border-0 p-0">
          <legend className="sr-only">Annotation tools</legend>
          {INK_TOOLS.map((t) => (
            <Tooltip
              key={t.tool}
              label={t.label}
              shortcut={t.key}
              contentClassName={STAGE_SCOPE_CLASS}
            >
              <StageButton
                label={t.label}
                active={tool === t.tool}
                onClick={() => dispatch({ type: "toggleTool", tool: t.tool })}
              >
                {t.icon}
              </StageButton>
            </Tooltip>
          ))}
          <Tooltip label="Laser pointer" shortcut="L" contentClassName={STAGE_SCOPE_CLASS}>
            <StageButton
              label="Laser pointer"
              active={laser}
              onClick={() => dispatch({ type: "toggleLaser" })}
            >
              <Crosshair {...ICON} />
            </StageButton>
          </Tooltip>
          <Tooltip label="Eraser" shortcut="E" contentClassName={STAGE_SCOPE_CLASS}>
            <StageButton
              label="Eraser"
              active={tool === "eraser"}
              onClick={() => dispatch({ type: "toggleTool", tool: "eraser" })}
            >
              <Eraser {...ICON} />
            </StageButton>
          </Tooltip>
        </fieldset>

        <StageDivider />

        <Popover open={timerOpen} onOpenChange={(open) => dispatch({ type: "setTimerOpen", open })}>
          <PopoverTrigger asChild>
            {/* Red until it is cleared, so a teacher looking at the pill still knows the time is up. */}
            <StageButton label="Timer" open={timerOpen} style={timerDone ? DONE_STYLE : undefined}>
              <TimerIcon {...ICON} />
            </StageButton>
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={10} className={cn(STAGE_SCOPE_CLASS, "w-auto")}>
            <TimerPanel />
          </PopoverContent>
        </Popover>

        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <StageButton label="More" open={menuOpen}>
              <MoreHorizontal {...ICON} />
            </StageButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className={cn(STAGE_SCOPE_CLASS, "min-w-[196px]")}>
            <DropdownMenuItem onSelect={() => dispatch({ type: "setNotesOpen", open: true })}>
              Presenter notes
              <DropdownMenuShortcut>N</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => dispatch({ type: "setOverviewOpen", open: true })}>
              <Grid2x2 {...ICON} />
              Overview
              <DropdownMenuShortcut>O</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => dispatch({ type: "setShortcutsOpen", open: true })}>
              Keyboard shortcuts
              <DropdownMenuShortcut>?</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {/* An interactive whiteboard often has no keyboard within reach, so X needs a way in that is not a key. */}
            <DropdownMenuItem
              disabled={!hasInk}
              onSelect={() => {
                if (slideId) ink.clearInk(slideId);
              }}
            >
              <Trash2 {...ICON} />
              Clear annotations
              <DropdownMenuShortcut>X</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled>Students join (phase 2)</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onExit}>
              Exit presenting
              <DropdownMenuShortcut>Esc</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <StageDivider />

        <Tooltip label="Collapse" shortcut="C" contentClassName={STAGE_SCOPE_CLASS}>
          <StageButton label="Collapse controls" onClick={collapse}>
            <ChevronsRight {...ICON} />
          </StageButton>
        </Tooltip>
      </Panel>
    </div>
  );
}

/**
 * Remaining reveal steps on this slide, inside the pill beside the counter it qualifies, so the
 * bar never moves when a slide has steps. Dots fill UP TO the current step: how far in, and how
 * much is left, without reading anything. Rest dots at 50% paper: at 35 the upcoming dot measured
 * 3.01:1, the 1.4.11 floor exactly, on a 5px object read from the back of a room.
 */
function StepDots({ step, total }: { step: number; total: number }) {
  return (
    <span
      aria-label={`Step ${step + 1} of ${total + 1}`}
      role="img"
      className="flex shrink-0 items-center gap-1 px-1.5"
    >
      {Array.from({ length: total + 1 }, (_, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: dots are positional
          key={i}
          className="size-[5px] rounded-full motion-safe:transition-colors"
          style={{ background: i <= step ? "var(--primary)" : paper(50) }}
        />
      ))}
    </span>
  );
}
