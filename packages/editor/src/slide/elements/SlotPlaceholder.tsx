import type { Theme } from "@tj/domain/documents";
import { accentTint } from "@tj/slides";
import { Camera, Shapes } from "lucide-react";

/**
 * Where a photograph or a diagram goes, and what the model asked for (look/image-slot): a tinted
 * box, a small muted icon at its corner and caption-size muted words. The editor draws an open
 * photo slot this way; present draws both only under the demo switch (`slot-placeholders.ts`).
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
