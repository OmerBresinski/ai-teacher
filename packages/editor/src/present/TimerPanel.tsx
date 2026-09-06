import { Button } from "@tj/ui";
import { NumberInput } from "../kit/NumberInput";
import { Segmented } from "../kit/Segmented";
import { formatClock } from "../slide/elements";
import { TIMER_PRESETS_MS, type TimerMode, timerRemainingMs, timerTicking } from "./timer";
import { useNow } from "./use-now";
import { usePresent } from "./use-present-session";

const MODES: { value: TimerMode; label: string }[] = [
  { value: "countdown", label: "Countdown" },
  { value: "elapsed", label: "Count up" },
];

/**
 * Timer controls (TeachDeck `components/v2/present/TimerPanel.tsx`). Presets first, because a
 * teacher setting a five-minute task should not have to type; the custom field is there for the
 * odd seven minutes. The popover around it carries the stage class, so the kit controls in here
 * resolve the stage palette.
 */
export function TimerPanel() {
  const { state, dispatch } = usePresent();
  const timer = state.timer;
  const now = useNow(timerTicking(timer));
  const at = () => Date.now();

  const countdown = timer.mode === "countdown";
  const minutes = Math.round(timer.durationMs / 60_000);
  const remaining = timerRemainingMs(timer, now);
  const ticking = timerTicking(timer, now);
  const finished = countdown && timer.armed && remaining <= 0;
  const close = () => dispatch({ type: "setTimerOpen", open: false });
  const start = (ms?: number) => dispatch({ type: "startTimer", at: at(), ms });

  return (
    <div className="flex w-[264px] flex-col gap-3">
      <Segmented
        aria-label="Timer mode"
        value={timer.mode}
        options={MODES}
        onChange={(mode) => dispatch({ type: "setTimerMode", mode, at: at() })}
        stretch
      />

      {countdown ? (
        <>
          <div className="grid grid-cols-4 gap-1">
            {TIMER_PRESETS_MS.map((ms) => (
              <Button
                key={ms}
                size="sm"
                variant={timer.durationMs === ms ? "secondary" : "ghost"}
                // A preset is the whole gesture: five minutes, go. It starts the clock and gets
                // out of the way; the pill at the top right carries it from there.
                onClick={() => {
                  start(ms);
                  close();
                }}
                className="px-0"
              >
                {ms / 60_000} min
              </Button>
            ))}
          </div>

          <NumberInput
            aria-label="Minutes"
            label="Minutes"
            unit="min"
            value={minutes}
            min={1}
            max={120}
            // Only a clock that is actually moving locks the field: a finished countdown keeps
            // `running` true, and the minutes are what "Start again" will use.
            disabled={ticking}
            onChange={(n) => dispatch({ type: "setTimerDuration", ms: n * 60_000, at: at() })}
            className="w-full"
          />
        </>
      ) : (
        <p className="text-ink-3 text-meta">Counts up from zero. Useful for timing a discussion.</p>
      )}

      <div className="flex items-center justify-between gap-2 border-border-faint border-t pt-3">
        <span className="text-body text-ink-2 tabular-nums">
          {finished
            ? "Finished"
            : countdown
              ? formatClock(remaining / 1000)
              : timer.armed
                ? "Running"
                : "Not started"}
        </span>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            onClick={() => dispatch({ type: "resetTimer" })}
            disabled={!timer.armed}
          >
            Reset
          </Button>
          {/* A countdown at zero is over: it is offered a restart, not a pause. */}
          {finished ? (
            <Button size="sm" onClick={() => start()}>
              Start again
            </Button>
          ) : timer.running ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => dispatch({ type: "pauseTimer", at: at() })}
            >
              Pause
            </Button>
          ) : timer.armed ? (
            <Button size="sm" onClick={() => dispatch({ type: "resumeTimer", at: at() })}>
              Resume
            </Button>
          ) : (
            <Button size="sm" onClick={() => start()}>
              Start
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
