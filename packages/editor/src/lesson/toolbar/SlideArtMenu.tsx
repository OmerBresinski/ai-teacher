import { SLIDE_H, SLIDE_W, type Slide, type SlideArt, type Theme } from "@tj/domain/documents";
import { artChoices, slideArtRole, slideBackground } from "@tj/slides";
import { DropdownMenuLabel, DropdownMenuRadioItem } from "@tj/ui";
import * as reducers from "../../model/reducers";
import { useHistory } from "../document-context";
import { DropTrigger } from "./shared";

/*
 * The slide's theme art variant (UX ruling 107): Auto lets the layout choose, or the teacher picks
 * the theme's title art, its margin art, its picture motif or the plain ground. Only the variants
 * that fit this slide whole are offered (`artChoices`), so a pick never puts art behind a word.
 * One write through `setSlideBackground`, one undo step. Hidden when the theme has no variants or
 * the slide has its own colour or picture, which win over the art.
 */

const LABELS: Record<SlideArt, string> = {
  auto: "Auto",
  title: "Title art",
  content: "Margin art",
  picture: "Picture motif",
  plain: "Plain",
};

const THUMB_W = 64;
const THUMB_H = (THUMB_W * SLIDE_H) / SLIDE_W;

/** The slide's ground and the art a choice would draw, at thumbnail size. */
function ArtThumb({ theme, slide, art }: { theme: Theme; slide: Slide; art: SlideArt }) {
  const background = slideBackground(theme, { ...slide, background: { ...slide.background, art } });
  return (
    <span
      aria-hidden
      className="relative inline-block shrink-0 overflow-hidden rounded-[3px] border border-line"
      style={{ width: THUMB_W, height: THUMB_H, background: theme.colors.background }}
    >
      <span
        className="absolute top-0 left-0"
        style={{
          width: SLIDE_W,
          height: SLIDE_H,
          background,
          transform: `scale(${THUMB_W / SLIDE_W})`,
          transformOrigin: "top left",
        }}
      />
    </span>
  );
}

export function SlideArtMenu({ slide, theme }: { slide: Slide; theme: Theme }) {
  const history = useHistory();
  if (slide.background?.color || slide.background?.image) return null;
  const choices = artChoices(theme, slide);
  if (choices.length === 0) return null;
  const current = slide.background?.art ?? "auto";
  const autoLabel = `Auto (${LABELS[slideArtRole(slide).role].toLowerCase()})`;
  const set = (art: SlideArt) => {
    if (art === current) return;
    const { art: _old, ...rest } = slide.background ?? {};
    const next = art === "auto" ? rest : { ...rest, art };
    history.dispatch(
      reducers.setSlideBackground,
      slide.id,
      Object.keys(next).length ? next : undefined,
    );
  };
  return (
    <DropTrigger label="Background art" value={current} text={LABELS[current]}>
      <DropdownMenuLabel>Background art</DropdownMenuLabel>
      {choices.map((art) => (
        <DropdownMenuRadioItem key={art} value={art} onSelect={() => set(art)} className="gap-2.5">
          <ArtThumb theme={theme} slide={slide} art={art} />
          {art === "auto" ? autoLabel : LABELS[art]}
        </DropdownMenuRadioItem>
      ))}
    </DropTrigger>
  );
}
