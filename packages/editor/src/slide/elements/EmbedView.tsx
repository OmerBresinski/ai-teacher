import type { EmbedElement } from "@tj/domain/documents";
import { Play } from "lucide-react";
import { type ElementViewProps, resolveFontSize, type SlideMode, withAlpha } from "./kit";

type Parsed = { src: string; label: string } | null;

/** YouTube and Vimeo only; anything else shows the poster plate with its host name. */
export function parseEmbed(url: string): Parsed {
  const yt =
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([A-Za-z0-9_-]{6,})/.exec(
      url,
    );
  if (yt)
    return {
      src: `https://www.youtube-nocookie.com/embed/${yt[1]}?rel=0&modestbranding=1`,
      label: "YouTube",
    };
  const vimeo = /vimeo\.com\/(?:video\/)?(\d+)/.exec(url);
  if (vimeo) return { src: `https://player.vimeo.com/video/${vimeo[1]}`, label: "Vimeo" };
  return null;
}

/** Live iframes only where they can actually play; everywhere else, a poster plate. */
const LIVE: SlideMode[] = ["view", "present"];

export function EmbedView({ element, theme, mode }: ElementViewProps<EmbedElement>) {
  const parsed = parseEmbed(element.url);
  const radius = theme.radius;

  if (parsed && LIVE.includes(mode)) {
    return (
      <iframe
        src={parsed.src}
        title={parsed.label}
        // A lesson's embed URL can come from imported JSON (SPEC §10), so the frame is
        // constrained to what a video player actually needs.
        sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="strict-origin-when-cross-origin"
        loading="lazy"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        style={{
          width: "100%",
          height: "100%",
          border: 0,
          borderRadius: radius,
          background: "#000",
        }}
      />
    );
  }

  const caption = resolveFontSize(theme, "caption");
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        borderRadius: radius,
        overflow: "hidden",
        background: "#101215",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <span
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 76,
          height: 76,
          borderRadius: "50%",
          background: withAlpha("#FFFFFF", 0.12),
          border: "2px solid rgb(255 255 255 / 0.55)",
          color: "#FFFFFF",
        }}
      >
        {/* Icon exception: slide content, not chrome — the embed's own play mark. */}
        <Play size={30} strokeWidth={2} fill="currentColor" style={{ marginLeft: 3 }} />
      </span>
      <span
        style={{
          position: "absolute",
          left: 16,
          bottom: 12,
          color: "rgb(255 255 255 / 0.62)",
          fontFamily: theme.fonts.body,
          fontSize: caption,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          fontWeight: 600,
        }}
      >
        {parsed?.label ?? hostOf(element.url)}
      </span>
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Video";
  }
}
