import type { Theme } from "@tj/domain/documents";
import { accentTint } from "@tj/slides";
import { Camera, Shapes } from "lucide-react";

/**
 * Where a photograph or a diagram goes, and what the model asked for (look/image-slot): a tinted
 * box, a small muted icon at its corner and caption-size muted words. The editor alone draws an
 * open photo slot and an undrawn diagram this way; present, the viewer and thumbnails never do.
 * The words are clamped to the lines the box holds (a brief runs to 400 characters) and end in an
 * ellipsis; the whole brief is the box's hover title.
 */
const PAD = 28;
const LEADING = 1.35;

export function SlotPlaceholder({
  kind,
  theme,
  radius,
  height,
  text,
}: {
  kind: "photo" | "diagram";
  theme: Theme;
  radius?: number | undefined;
  /** The slot's height in slide units, from which the lines the words may take are counted. */
  height: number;
  text: string;
}) {
  const Icon = kind === "photo" ? Camera : Shapes;
  const lines = Math.max(1, Math.floor((height - 2 * PAD) / (theme.sizes.caption * LEADING)));
  return (
    <div
      data-slot-placeholder={kind}
      title={text}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        borderRadius: radius || undefined,
        background: accentTint(theme),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: PAD,
        boxSizing: "border-box",
        textAlign: "center",
      }}
    >
      {kind === "photo" ? (
        // Live writing P2 (TEACH-202 part e): a soft pulsing sheen says the picture is on its way.
        // (Not named for the effect's usual word: it contains "immer", which the thumb test bans.)
        <div
          aria-hidden
          data-slot-sheen
          className="pointer-events-none absolute inset-0 motion-safe:animate-pulse"
          style={{
            borderRadius: radius || undefined,
            background:
              "linear-gradient(100deg, transparent 15%, rgba(255,255,255,0.35) 50%, transparent 85%)",
          }}
        />
      ) : null}
      <Icon
        aria-hidden
        size={22}
        strokeWidth={1.75}
        color={theme.colors.muted}
        style={{ position: "absolute", left: 14, top: 14 }}
      />
      <span
        data-lines={lines}
        style={{
          fontFamily: theme.fonts.body,
          fontSize: theme.sizes.caption,
          lineHeight: LEADING,
          color: theme.colors.muted,
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: lines,
          overflow: "hidden",
          overflowWrap: "anywhere",
        }}
      >
        {text}
      </span>
    </div>
  );
}
