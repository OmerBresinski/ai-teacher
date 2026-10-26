import type { Theme } from "@tj/domain/documents";
import { accentTint, PLACEHOLDER_IMAGE } from "@tj/slides";
import { Camera, Shapes } from "lucide-react";
import { useEffect, useRef } from "react";
import { useProposals } from "../../lesson/proposals-context";
import { useReducedMotion } from "../../present/use-fullscreen";

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
      {kind === "photo" ? <PendingSheen radius={radius} /> : null}
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

/**
 * A picture slot the generating job will fill: it still holds the placeholder picture, and it is
 * not a blank picture box the teacher added (the layouts' blanks ask the teacher to "Describe this
 * image…", the job's slots carry what the picture shows).
 */
export function isJobPictureSlot(el: { src: string; alt?: string | undefined }): boolean {
  return el.src === PLACEHOLDER_IMAGE && !(el.alt ?? "").startsWith("Describe this");
}

/**
 * A picture still on its way (TEACH-202 part o; Greg 25 Oct: "no animation on image placeholders
 * to show they're loading"): while the lesson's job runs, a soft band of light sweeps across the
 * slot every 2.4 s. The document cannot tell a picture that failed from one still coming (a failed
 * slot is laid away only when the lesson turns editable), so the sweep stops when the job ends.
 * With reduced motion nothing moves: the slot takes a soft tint and says "Adding picture…". (Not
 * named for the effect's usual word: it contains
 * "immer", which the thumb test bans.)
 */
export function PendingSheen({ radius }: { radius?: number | undefined }) {
  const { writingSlideIds } = useProposals();
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement | null>(null);
  const coming = writingSlideIds !== undefined;
  useEffect(() => {
    if (!coming || reduced) return;
    const a = ref.current?.animate?.(
      [
        { transform: "translateX(-100%)", offset: 0 },
        { transform: "translateX(100%)", offset: 0.6 },
        { transform: "translateX(100%)", offset: 1 },
      ],
      { duration: 2400, easing: "ease-in-out", iterations: Number.POSITIVE_INFINITY },
    );
    return () => a?.cancel();
  }, [coming, reduced]);
  if (!coming) return null;
  if (reduced)
    return (
      <div
        data-slot-sheen="still"
        className="pointer-events-none absolute inset-0 flex items-end justify-start"
        style={{ borderRadius: radius || undefined, background: "rgba(255,255,255,0.3)" }}
      >
        <span
          style={{
            margin: 12,
            padding: "4px 12px",
            borderRadius: 999,
            background: "rgba(255,255,255,0.85)",
            color: "rgba(0,0,0,0.6)",
            fontSize: 18,
            lineHeight: 1.3,
          }}
        >
          Adding picture…
        </span>
      </div>
    );
  return (
    <div
      aria-hidden
      data-slot-sheen
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ borderRadius: radius || undefined }}
    >
      <div
        ref={ref}
        style={{
          position: "absolute",
          inset: 0,
          transform: "translateX(-100%)",
          background:
            "linear-gradient(100deg, transparent 20%, rgba(255,255,255,0.55) 50%, transparent 80%)",
        }}
      />
    </div>
  );
}
