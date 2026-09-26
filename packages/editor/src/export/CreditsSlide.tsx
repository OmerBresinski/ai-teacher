import type { Theme } from "@tj/domain/documents";
import { SLIDE_H, SLIDE_W } from "@tj/domain/documents";
import { resolveFontSize } from "../slide/elements/kit";
import { IMAGE_CREDITS_TITLE, type ImageCredit } from "./credits";

/**
 * The "Image credits" picture the PNG run ends on (TEACH-161; Images project Decision 2): a
 * 960x540 slide in the theme's colours and fonts, one line per credit with its addresses beneath in
 * small text, since a PNG has no links. A sibling of `SlideView`, never a mode of it: the slides
 * themselves stay untouched. Rendered on `ExportControl`'s offscreen capture stage and reached only
 * through `./png`, so it ships in the click-loaded PNG chunk.
 *
 * `data-slide-root` is what `stageSlide` looks for; there are no images, so `waitForSlidePaint`
 * waits on the fonts alone.
 */
export type CreditsSlideProps = { credits: ImageCredit[]; theme: Theme };

export function CreditsSlide({ credits, theme }: CreditsSlideProps) {
  // The PowerPoint credits slide's sizes, so the two read alike.
  const size = Math.max(14, Math.min(resolveFontSize(theme, "small"), 20));
  return (
    <div
      data-slide-root
      data-credits-slide
      style={{
        position: "relative",
        boxSizing: "border-box",
        width: SLIDE_W,
        height: SLIDE_H,
        overflow: "hidden",
        padding: "56px 64px",
        background: theme.colors.background,
        color: theme.colors.ink,
        fontFamily: theme.fonts.body,
        fontWeight: theme.weights.body,
      }}
    >
      <p
        style={{
          margin: "0 0 16px",
          fontFamily: theme.fonts.title,
          fontSize: resolveFontSize(theme, "heading"),
          fontWeight: theme.weights.heading,
          letterSpacing: theme.titleTracking,
          lineHeight: 1.4,
        }}
      >
        {IMAGE_CREDITS_TITLE}
      </p>
      <ul
        style={{
          margin: 0,
          padding: 0,
          listStyle: "none",
          columnCount: credits.length > 6 ? 2 : 1,
          columnGap: 36,
        }}
      >
        {credits.map((credit) => (
          <li key={credit.key} style={{ breakInside: "avoid", paddingBottom: 10 }}>
            <p style={{ margin: 0, fontSize: size, lineHeight: 1.3 }}>{credit.text}</p>
            {credit.links.map((link) => (
              <p
                key={`${link.label} ${link.href}`}
                style={{
                  margin: 0,
                  fontSize: Math.round(size * 0.7),
                  lineHeight: 1.35,
                  color: theme.colors.muted,
                  overflowWrap: "anywhere",
                }}
              >
                {link.label}: {link.href}
              </p>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}
