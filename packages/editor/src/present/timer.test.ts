import { describe, expect, test } from "bun:test";
import {
  freshTimer,
  nextLabel,
  pauseTimer,
  resetTimer,
  resumeTimer,
  setTimerDuration,
  setTimerMode,
  startTimer,
  timerElapsedMs,
  timerFaceState,
  timerFinished,
  timerFraction,
  timerRemainingMs,
  timerTicking,
} from "./timer";

const T0 = 1_000_000;

describe("timer", () => {
  test("a fresh timer is idle, reads the full duration and does not tick", () => {
    const t = freshTimer();
    expect(timerRemainingMs(t, T0)).toBe(300_000);
    expect(timerTicking(t, T0)).toBe(false);
    expect(timerFaceState(t, T0)).toBe("idle");
    expect(timerFinished(t, T0)).toBe(false);
  });

  test("a started countdown drains, turns amber at 20% and red at zero", () => {
    const t = startTimer(freshTimer(), T0, 60_000);
    expect(t.armed).toBe(true);
    expect(timerRemainingMs(t, T0 + 30_000)).toBe(30_000);
    expect(timerFaceState(t, T0 + 30_000)).toBe("running");
    expect(timerFraction(t, T0 + 30_000)).toBeCloseTo(0.5);
    expect(timerFaceState(t, T0 + 50_000)).toBe("warning");
    expect(timerFaceState(t, T0 + 60_000)).toBe("done");
    expect(timerFinished(t, T0 + 61_000)).toBe(true);
    // Finished, not stopped: `running` stays true but the readout no longer ticks.
    expect(t.running).toBe(true);
    expect(timerTicking(t, T0 + 61_000)).toBe(false);
  });

  test("pause banks what is left; resume continues from it", () => {
    let t = startTimer(freshTimer(), T0, 60_000);
    t = pauseTimer(t, T0 + 20_000);
    expect(t.running).toBe(false);
    expect(t.pausedRemainingMs).toBe(40_000);
    expect(timerRemainingMs(t, T0 + 99_000)).toBe(40_000);
    t = resumeTimer(t, T0 + 100_000);
    expect(timerRemainingMs(t, T0 + 110_000)).toBe(30_000);
    // Pausing a finished countdown is a no-op.
    const done = startTimer(freshTimer(), T0, 1000);
    expect(pauseTimer(done, T0 + 5000)).toBe(done);
  });

  test("count-up banks elapsed time across pauses", () => {
    let t = startTimer(freshTimer("elapsed"), T0);
    expect(timerElapsedMs(t, T0 + 5000)).toBe(5000);
    t = pauseTimer(t, T0 + 5000);
    t = resumeTimer(t, T0 + 50_000);
    expect(timerElapsedMs(t, T0 + 52_000)).toBe(7000);
    expect(timerFraction(t, T0)).toBe(1);
    expect(timerFaceState(t, T0)).toBe("running");
  });

  test("switching mode carries the time already spent across", () => {
    const countdown = startTimer(freshTimer(), T0, 300_000);
    const up = setTimerMode(countdown, "elapsed", T0 + 120_000);
    expect(up.mode).toBe("elapsed");
    expect(timerElapsedMs(up, T0 + 120_000)).toBe(120_000);
    expect(up.running).toBe(true);
    const back = setTimerMode(up, "countdown", T0 + 120_000);
    expect(timerRemainingMs(back, T0 + 120_000)).toBe(180_000);
    // Same mode is a no-op; unarmed just swaps the shape.
    expect(setTimerMode(back, "countdown", T0)).toBe(back);
    expect(setTimerMode(freshTimer(), "elapsed", T0).armed).toBe(false);
  });

  test("duration edits are refused while the clock is moving, accepted at zero", () => {
    const running = startTimer(freshTimer(), T0, 60_000);
    expect(setTimerDuration(running, 120_000, T0 + 1000)).toBe(running);
    expect(setTimerDuration(running, 120_000, T0 + 61_000).durationMs).toBe(120_000);
    expect(setTimerDuration(freshTimer(), 10, T0).durationMs).toBe(1000);
  });

  test("reset keeps it armed on the stage; clear takes it off", () => {
    const running = startTimer(freshTimer(), T0, 60_000);
    const reset = resetTimer(running);
    expect(reset.armed).toBe(true);
    expect(reset.running).toBe(false);
    expect(timerRemainingMs(reset, T0)).toBe(60_000);
    expect(clearTimerArmed(running)).toBe(false);
  });

  test("nextLabel: Reveal for a build, Answer for a question's last step, null when out", () => {
    expect(nextLabel(0, 2, false)).toBe("Reveal");
    expect(nextLabel(1, 2, true)).toBe("Answer");
    expect(nextLabel(1, 2, false)).toBe("Reveal");
    expect(nextLabel(2, 2, true)).toBeNull();
    expect(nextLabel(0, 0, false)).toBeNull();
  });
});

function clearTimerArmed(t: ReturnType<typeof freshTimer>): boolean {
  return resetTimer({ ...t, armed: false }).armed;
}
