import type { Theme } from "@tj/domain/documents";
import { accentTint, PLACEHOLDER_IMAGE } from "@tj/slides";
import { Camera, Shapes } from "lucide-react";
import { useEffect, useRef } from "react";
import { useProposals } from "../../lesson/proposals-context";
import { useReducedMotion } from "../../present/use-fullscreen";
import type { SlideMode } from "./kit";

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
      {kind === "photo" ? <PendingSheen radius={radius} theme={theme} /> : null}
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
 * A picture still on its way (TEACH-202 part o; TEACH-251 part av, Greg 26 Oct: "a clear
 * generating" cue, the way a dot matrix lights up): the slot is a field of small dots in the
 * lesson theme's muted colour on its accent tint, and a soft slanted band crosses it every 2 s,
 * lighting the dots it passes in the accent and drawing them larger. Only transforms move (the band
 * slides one way and the lit dots inside it slide back, so the dots stay put while the light
 * travels), every slot keeps the same phase, and nothing is laid out again, so a deck full of
 * pending slots stays cheap.
 *
 * The document cannot tell a picture that failed from one still coming (a failed slot is laid away
 * only when the lesson turns editable), so in the editor and its rail the field shows only while
 * the job runs. Present and the viewer load the lesson once; a slot still holding the placeholder
 * there was pending when it loaded (the api lays an open slot away on read once no job holds the
 * lesson), so they draw it as coming. Print and export never do.
 *
 * With reduced motion nothing moves: the dots stand still and the slot says "Adding picture…"
 * (not in the rail, where the words would be a smudge). (Not named for the effect's usual word: it
 * contains "immer", which the thumb test bans.)
 */
const PERIOD = 2000;
const SLANT =
  "linear-gradient(to right, transparent, #000 35%, #000 65%, transparent), linear-gradient(105deg, transparent 15%, #000 50%, transparent 85%)";
/** Dot pitch and radii in slide units; the rail draws them twice the size so they still read. */
const DOTS = { pitch: 14, dot: 1.5, lit: 2.6 };

export function PendingSheen({
  radius,
  theme,
  mode = "edit",
}: {
  radius?: number | undefined;
  /** The ground, the dots and the light are drawn in the lesson theme's own tokens (part av). */
  theme: Theme;
  mode?: SlideMode;
}) {
  const { writingSlideIds } = useProposals();
  const reduced = useReducedMotion();
  const band = useRef<HTMLDivElement | null>(null);
  const lit = useRef<HTMLDivElement | null>(null);
  const loadedPending = mode === "present" || mode === "view";
  const coming = loadedPending || writingSlideIds !== undefined;
  useEffect(() => {
    if (!coming || reduced) return;
    const timing = {
      duration: PERIOD,
      easing: "linear",
      iterations: Number.POSITIVE_INFINITY,
    };
    // The band is 0.6 of the slot wide; its brightest line runs from 0.2 of a slot before the left
    // edge to 0.2 past the right, so the light is on the dots most of the time and the loop's
    // restart happens out of sight. The lit dots (the slot's width) run back by the same distance,
    // so they hold still.
    const moves = [
      band.current?.animate?.(
        [{ transform: "translateX(-83.333%)" }, { transform: "translateX(150%)" }],
        timing,
      ),
      lit.current?.animate?.(
        [{ transform: "translateX(50%)" }, { transform: "translateX(-90%)" }],
        timing,
      ),
    ];
    // One phase for every slot on screen: the light crosses them together, never at random.
    for (const m of moves) {
      if (!m) continue;
      m.startTime = 0;
      // Cancelling rejects `finished`; nothing waits on it.
      m.finished?.catch(() => {});
    }
    return () => {
      for (const m of moves) m?.cancel();
    };
  }, [coming, reduced]);
  if (!coming) return null;
  const k = mode === "thumb" ? 2 : 1;
  const pitch = DOTS.pitch * k;
  const field = (colour: string, r: number) =>
    `radial-gradient(circle, ${colour} ${r * k}px, transparent ${r * k + 0.75}px) center / ${pitch}px ${pitch}px`;
  // The field fades out towards the slot's edges, so it has no hard grid border.
  const edges = "radial-gradient(ellipse 60% 60% at 50% 50%, #000 50%, transparent 100%)";
  const fill = {
    position: "absolute",
    inset: 0,
    maskImage: edges,
    WebkitMaskImage: edges,
  } as const;
  const dots = `color-mix(in srgb, ${theme.colors.muted} ${reduced ? 55 : 40}%, transparent)`;
  const light = `color-mix(in srgb, ${theme.colors.accent} 75%, ${theme.colors.ink})`;
  const ground = { borderRadius: radius || undefined, background: accentTint(theme) };
  if (reduced)
    return (
      <div
        data-slot-sheen="still"
        className="pointer-events-none absolute inset-0 flex items-end justify-start overflow-hidden"
        style={ground}
      >
        <div aria-hidden style={{ ...fill, background: field(dots, DOTS.dot) }} />
        {mode === "thumb" ? null : (
          <span
            style={{
              position: "relative",
              margin: 12,
              padding: "4px 12px",
              borderRadius: 999,
              background: theme.colors.surface,
              color: theme.colors.muted,
              fontFamily: theme.fonts.body,
              fontSize: 18,
              lineHeight: 1.3,
            }}
          >
            Adding picture…
          </span>
        )}
      </div>
    );
  return (
    <div
      aria-hidden
      data-slot-sheen
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={ground}
    >
      <div style={{ ...fill, background: field(dots, DOTS.dot) }} />
      <div
        ref={band}
        data-slot-light
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: 0,
          width: "60%",
          transform: "translateX(-83.333%)",
          // A slanted light, faded to nothing at the band's sides whatever the slot's shape.
          maskImage: SLANT,
          WebkitMaskImage: SLANT,
          maskComposite: "intersect",
          WebkitMaskComposite: "source-in",
        }}
      >
        <div
          ref={lit}
          style={{
            ...fill,
            right: "auto",
            width: "166.667%",
            transform: "translateX(50%)",
            background: field(light, DOTS.lit),
          }}
        />
      </div>
    </div>
  );
}
