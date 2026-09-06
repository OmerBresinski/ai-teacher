import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
} from "@tj/ui";
import { MoreHorizontal, Pause, Play, RotateCcw, X } from "lucide-react";
import { useState } from "react";
import { Panel } from "../kit/Panel";
import { formatClock } from "../slide/elements";
import { StageButton } from "./StageButton";
import { ground, paper, STAGE_PILL_STYLE, STAGE_SCOPE_CLASS } from "./stage-tokens";
import {
  timerElapsedMs,
  timerFaceState,
  timerFraction,
  timerRemainingMs,
  timerTicking,
} from "./timer";
import { useStageHover, useStageIdle } from "./use-idle";
import { useNow } from "./use-now";
import { usePresent } from "./use-present-session";

/*
 * The classroom-facing timer (TeachDeck `components/v2/present/TimerReadout.tsx`): a pill at the
 * top right of the stage with a ring that drains, the clock, and its own menu. It is chrome, not
 * slide content, so it wears the dark pill rather than the theme's surface. It sits in the
 * letterbox band when there is one deep enough. It never fades while it is counting.
 */

const PILL_H = 52;
const EDGE = 24;

/** Ring geometry. 3px stroke. */
const RING = 26;
const RING_R = (RING - 3) / 2;
const RING_C = 2 * Math.PI * RING_R;

const ICON = { size: 16, strokeWidth: 1.5 } as const;

export function TimerReadout({ letterbox = 0 }: { letterbox?: number }) {
  const { state, dispatch } = usePresent();
  const timer = state.timer;
  // A finished countdown is not going to change again: stop the interval.
  const now = useNow(timerTicking(timer));

  const [menuOpen, setMenuOpen] = useState(false);
  const { hovering, bind: hover } = useStageHover();

  /**
   * Focus holds the pill up, as the pointer does: chrome that fades on idle must not leave a
   * control that still takes Tab but cannot be seen or hit (WCAG 2.4.7).
   */
  const [focused, setFocused] = useState(false);
  const focus = {
    onFocusCapture: () => setFocused(true),
    onBlurCapture: (e: React.FocusEvent<HTMLDivElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
    },
  };

  const faceState = timerFaceState(timer, now);
  const done = faceState === "done";
  // Armed, not running: a paused clock that fades off the stage reads as a cleared one.
  const visible = useStageIdle(menuOpen || hovering || focused || timer.armed);

  if (!timer.armed) return null;

  const seconds =
    timer.mode === "countdown"
      ? timerRemainingMs(timer, now) / 1000
      : timerElapsedMs(timer, now) / 1000;
  const left = timerFraction(timer, now);

  // Colour is spent on the two states worth interrupting a lesson for: amber under a fifth left,
  // red at zero. A clock simply running is neutral stage text.
  const digits = done
    ? "var(--destructive)"
    : faceState === "warning"
      ? "var(--warning)"
      : "var(--foreground)";
  const ring = done ? "var(--destructive)" : faceState === "warning" ? "var(--warning)" : paper(55);
  const inBand = letterbox >= PILL_H + 12;
  const top = inBand ? Math.round((letterbox - PILL_H) / 2) : EDGE;
  const at = () => Date.now();

  return (
    <div
      className="td-autohide absolute z-[460]"
      data-hidden={!visible}
      style={{ top, right: EDGE }}
      {...hover}
      {...focus}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
    >
      {/* The clock is `aria-live="off"`: five updates a second is not an announcement. Zero is
          worth exactly one — the region is mounted empty and changes once, on the edge. */}
      <p className="sr-only" role="status" aria-live="polite">
        {done ? "Time is up" : ""}
      </p>

      <Panel
        style={{
          ...STAGE_PILL_STYLE,
          height: PILL_H,
          gap: 10,
          borderRadius: 999,
          paddingLeft: 12,
          paddingRight: 6,
          boxShadow:
            done || faceState === "warning"
              ? `0 0 0 1.5px ${done ? "var(--destructive)" : "var(--warning)"}, 0 8px 24px ${ground(60)}`
              : `0 0 0 1px var(--border), 0 8px 24px ${ground(60)}`,
        }}
      >
        <TimerRing left={done ? 0 : left} color={ring} paused={!timer.running && !done} />

        {/* Chrome type, not the lesson's: the same control looks the same in every lesson. */}
        <span
          className={cn("font-semibold text-title tabular-nums", done && "td-timer-done")}
          role="timer"
          aria-live="off"
          aria-label={`${timer.mode === "countdown" ? "Time remaining" : "Time elapsed"} ${formatClock(seconds)}${
            timer.running ? "" : done ? ", finished" : ", paused"
          }`}
          style={{ letterSpacing: "-0.02em", color: digits }}
        >
          {formatClock(seconds)}
        </span>

        {/* At zero the only thing left to do is take it off the screen. */}
        {done ? (
          <Tooltip label="Clear timer" side="bottom" contentClassName={STAGE_SCOPE_CLASS}>
            <StageButton label="Clear timer" onClick={() => dispatch({ type: "clearTimer" })}>
              <X {...ICON} />
            </StageButton>
          </Tooltip>
        ) : (
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <StageButton label="Timer options" open={menuOpen}>
                <MoreHorizontal {...ICON} />
              </StageButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className={cn(STAGE_SCOPE_CLASS, "min-w-[168px]")}>
              {timer.running ? (
                <DropdownMenuItem onSelect={() => dispatch({ type: "pauseTimer", at: at() })}>
                  <Pause {...ICON} />
                  Pause
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => dispatch({ type: "resumeTimer", at: at() })}>
                  <Play {...ICON} />
                  Resume
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => dispatch({ type: "resetTimer" })}>
                <RotateCcw {...ICON} />
                Reset
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={() => dispatch({ type: "clearTimer" })}>
                <X {...ICON} />
                Clear
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </Panel>
    </div>
  );
}

/**
 * The ring drains clockwise from the top. Drawn, not animated: the clock already re-renders five
 * times a second, and an arc that jumps a fifth of a degree is an arc nobody can see jump.
 */
function TimerRing({ left, color, paused }: { left: number; color: string; paused: boolean }) {
  const c = RING / 2;
  return (
    <svg
      width={RING}
      height={RING}
      viewBox={`0 0 ${RING} ${RING}`}
      aria-hidden
      focusable="false"
      className="shrink-0"
    >
      <circle cx={c} cy={c} r={RING_R} fill="none" stroke={paper(18)} strokeWidth={3} />
      {left > 0 ? (
        <circle
          cx={c}
          cy={c}
          r={RING_R}
          fill="none"
          stroke={color}
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={RING_C}
          strokeDashoffset={RING_C * (1 - left)}
          opacity={paused ? 0.6 : 1}
          transform={`rotate(-90 ${c} ${c})`}
        />
      ) : null}
    </svg>
  );
}
