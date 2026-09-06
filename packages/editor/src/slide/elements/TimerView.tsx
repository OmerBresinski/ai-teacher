import type { Theme, TimerElement } from "@tj/domain/documents";
import { type ElementViewProps, withAlpha } from "./kit";

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

export type TimerFaceProps = {
  seconds: number;
  theme: Theme;
  /** Box size in slide points; the digits are sized from the height. */
  width: number;
  height: number;
  /** 'idle' | 'running' | 'warning' (≤20% left) | 'done'. Present mode drives this. */
  state?: "idle" | "running" | "warning" | "done";
  label?: string;
};

/**
 * The static face. Present mode owns the countdown and re-renders this with a new
 * `seconds` and `state` each tick, so the visual language stays in one place.
 */
export function TimerFace({
  seconds,
  theme,
  width,
  height,
  state = "idle",
  label,
}: TimerFaceProps) {
  const digitSize = Math.max(28, Math.min(height * 0.52, width * 0.3));
  const tone =
    state === "done"
      ? theme.colors.incorrect
      : state === "warning"
        ? theme.colors.accent2
        : theme.colors.ink;
  const ring =
    state === "done"
      ? theme.colors.incorrect
      : state === "warning"
        ? theme.colors.accent2
        : theme.colors.line;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: Math.round(digitSize * 0.14),
        background:
          state === "done" ? withAlpha(theme.colors.incorrect, 0.08) : theme.colors.surface,
        border: `${state === "idle" ? 1.5 : 2}px solid ${ring}`,
        borderRadius: theme.radius,
        color: tone,
      }}
    >
      {label ? (
        <span
          style={{
            fontFamily: theme.fonts.body,
            fontSize: Math.max(14, digitSize * 0.22),
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: theme.colors.muted,
          }}
        >
          {label}
        </span>
      ) : null}
      <span
        style={{
          fontFamily: theme.fonts.title,
          fontSize: digitSize,
          fontWeight: theme.weights.title,
          letterSpacing: "-0.02em",
          lineHeight: 1,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {formatClock(seconds)}
      </span>
    </div>
  );
}

export function TimerView({ element, theme }: ElementViewProps<TimerElement>) {
  return <TimerFace seconds={element.seconds} theme={theme} width={element.w} height={element.h} />;
}
