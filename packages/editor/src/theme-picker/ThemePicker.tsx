import type { Slide, Theme } from "@tj/domain/documents";
import { cn } from "@tj/ui";
import { Check } from "lucide-react";
import {
  type KeyboardEvent,
  memo,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { THEMES } from "../model/themes";
import { SlideFluid } from "../slide/SlideStatic";
import {
  FILTER_TAGS,
  fontPair,
  loadSampleKit,
  paletteOf,
  sampleKitReady,
  suitsOf,
  type ThemeSamples,
  type ThemeTagId,
  tagLabel,
  themeSamples,
} from "./samples";

/*
 * The theme picker (Greg, decisions 34 and 72-75, layout A): every place a teacher picks a theme —
 * the blank lesson's dialog, the editor's Theme dialog, the dialog while a lesson is being made —
 * draws the same choices. Each tile is the theme drawn by the slide renderer itself: its cover with
 * a picture, and one of its visual layouts tucked into the corner, its name in its own title face
 * and who it suits. Beside the tiles a large preview shows the theme the pointer or focus is on
 * (else the chosen one): its fonts, who it suits and its cover and visual layouts at full width.
 *
 * Calm and fast: the template code loads once when the picker opens, a tile draws its slides only
 * once it scrolls near the view (an IntersectionObserver), the slides are built once per theme and
 * cached (`samples.ts`), and a theme drawn once stays drawn when the picker reopens.
 *
 * Keyboard: the tiles are one radio group (one tab stop; arrows, Home and End move and choose); the
 * filter chips are toggle buttons. Each radio names the theme and describes its fonts and who it
 * suits.
 */

export type ThemePickerProps = {
  selectedId: string;
  onPick: (themeId: string) => void;
  /** The lesson's title, drawn on every cover. */
  title: string;
  /** The lesson's age band: the previews use its key stage. */
  ageBand?: string | null;
  /** The cover's second line ("Year 4 · Science"); none when empty. */
  subtitle?: string;
  /**
   * An open lesson's own slides in a theme (the editor): every tile and the large preview draw
   * these instead of the sample lesson. Cached by the caller.
   */
  samplesFor?: (themeId: string) => ThemeSamples;
  className?: string;
};

/** Themes drawn at least once this session: they draw at once when the picker reopens. */
const drawn = new Set<string>();

/** Whether the box has come within reach of the view. */
function useNearView(key: string): [React.RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(
    () => drawn.has(key) || typeof IntersectionObserver === "undefined",
  );
  useEffect(() => {
    if (near) {
      drawn.add(key);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near, key]);
  return [ref, near];
}

/** A slide at the box's width; till it is drawn, the theme's ground. */
function Mini({ slide, theme, className }: { slide?: Slide; theme: Theme; className?: string }) {
  return (
    <div
      className={cn("overflow-hidden rounded-chip shadow-[0_0_0_1px_var(--border)]", className)}
      style={{ background: theme.colors.background }}
    >
      {slide ? (
        <SlideFluid slide={slide} theme={theme} />
      ) : (
        <div style={{ aspectRatio: "16 / 9" }} />
      )}
    </div>
  );
}

/** The theme's name in its own title face. */
function ThemeName({ theme, className }: { theme: Theme; className?: string }) {
  return (
    <span
      className={cn("truncate text-foreground", className)}
      style={{ fontFamily: theme.fonts.title, fontWeight: theme.weights.title }}
    >
      {theme.name}
    </span>
  );
}

/** What a screen reader hears after the name. */
function describe(theme: Theme): string {
  const { who, look } = suitsOf(theme);
  const tags = theme.tags.map(tagLabel).join(", ");
  return [who, look, `Fonts: ${fontPair(theme).label}`, tags ? `Good for: ${tags}` : ""]
    .filter(Boolean)
    .join(". ");
}

/** The large preview: whose it is, fonts, who it suits, then the cover and layouts at full width. */
function Spotlight({ samples, chosen }: { samples: ThemeSamples; chosen: boolean }) {
  const { theme } = samples;
  const fonts = fontPair(theme);
  const { who, look } = suitsOf(theme);
  return (
    <div
      className="flex min-w-0 flex-col gap-3"
      data-theme-spotlight={theme.id}
      data-spotlight-state={chosen ? "chosen" : "preview"}
      aria-hidden
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-meta text-ink-3">{chosen ? "Your theme" : "Preview"}</span>
        <ThemeName theme={theme} className="text-heading" />
        <p className="text-meta text-ink-2">
          <span className="text-foreground">{who}.</span> {look}
        </p>
        <div className="flex items-baseline gap-2.5">
          <span
            className="text-[26px] leading-none text-foreground"
            style={{ fontFamily: theme.fonts.title, fontWeight: theme.weights.title }}
          >
            Aa
          </span>
          <span className="text-meta text-ink-2">
            {fonts.title === fonts.body
              ? fonts.title
              : `${fonts.title} for titles, ${fonts.body} for text`}
          </span>
        </div>
        {/* Decision 72: one quiet row of small swatches, no labels. */}
        <span className="flex gap-1" data-palette>
          {paletteOf(theme).map((c) => (
            <span
              key={c.name}
              className="size-2.5 rounded-full shadow-[0_0_0_1px_var(--border)]"
              style={{ background: c.value }}
            />
          ))}
        </span>
      </div>
      <Mini slide={samples.cover} theme={theme} />
      {samples.layouts.map((slide) => (
        <Mini key={slide.id} slide={slide} theme={theme} />
      ))}
    </div>
  );
}

/** The large preview on a phone: whose it is, the cover beside a visual layout, one line of facts. */
function CompactSpotlight({ samples, chosen }: { samples: ThemeSamples; chosen: boolean }) {
  const { theme } = samples;
  return (
    <div
      className="flex flex-col gap-2"
      aria-hidden
      data-theme-spotlight={theme.id}
      data-spotlight-state={chosen ? "chosen" : "preview"}
    >
      <div className="grid grid-cols-2 gap-2">
        <Mini slide={samples.cover} theme={theme} />
        <Mini slide={samples.visual} theme={theme} />
      </div>
      <span className="flex items-baseline gap-2">
        <span className="text-meta text-ink-3">{chosen ? "Your theme" : "Preview"}</span>
        <ThemeName theme={theme} className="text-body" />
      </span>
      <span className="text-meta text-ink-2">
        {fontPair(theme).label} · {suitsOf(theme).who}
      </span>
    </div>
  );
}

type TileProps = {
  theme: Theme;
  title: string;
  ageBand?: string | null;
  subtitle?: string;
  samplesFor?: (themeId: string) => ThemeSamples;
  kitReady: boolean;
  selected: boolean;
  tabbable: boolean;
  onPick: (id: string) => void;
  onPeek: (id: string | null) => void;
};

/** One theme: a radio drawn as its cover with a visual layout tucked into the corner. */
const Tile = memo(function Tile({
  theme: base,
  title,
  ageBand,
  subtitle,
  samplesFor,
  kitReady,
  selected,
  tabbable,
  onPick,
  onPeek,
}: TileProps) {
  const descId = useId();
  const [ref, near] = useNearView(`${base.id}|${title}|${ageBand ?? ""}|${subtitle ?? ""}`);
  const samples = useMemo(
    () =>
      !near
        ? null
        : samplesFor
          ? samplesFor(base.id)
          : kitReady
            ? themeSamples(base.id, title, ageBand, subtitle)
            : null,
    [near, kitReady, base.id, title, ageBand, subtitle, samplesFor],
  );
  const theme = samples?.theme ?? base;
  const { who } = suitsOf(theme);

  return (
    <div ref={ref} data-theme-preview={base.id} data-ready={samples ? "true" : "false"}>
      {/* biome-ignore lint/a11y/useSemanticElements: a radio drawn as slide previews, not an input. */}
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        aria-label={theme.name}
        aria-describedby={descId}
        tabIndex={tabbable ? 0 : -1}
        data-theme-tile={base.id}
        onClick={() => onPick(base.id)}
        onFocus={() => onPeek(base.id)}
        onPointerEnter={() => onPeek(base.id)}
        className={cn(
          "flex w-full rounded-control p-1.5 text-left outline-none transition-colors",
          "hover:bg-muted focus-visible:shadow-focus",
          selected && "bg-muted shadow-[0_0_0_2px_var(--primary)]",
        )}
      >
        <span className="flex w-full flex-col gap-1.5">
          <span className="relative block pb-[14%]">
            <span className="block w-[82%]">
              <Mini slide={samples?.cover} theme={theme} />
            </span>
            <span className="absolute right-0 bottom-0 block w-[52%] rounded-chip shadow-2">
              <Mini slide={samples?.visual} theme={theme} />
            </span>
            {selected ? (
              <span className="absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-1">
                <Check size={13} strokeWidth={2.25} />
              </span>
            ) : null}
          </span>
          <ThemeName theme={theme} className="text-body" />
          <span className="line-clamp-2 text-meta text-ink-3">{who}</span>
        </span>
      </button>
      <span id={descId} className="sr-only">
        {describe(theme)}
      </span>
    </div>
  );
});

function FilterChips({
  tag,
  onTag,
  counts,
}: {
  tag: ThemeTagId | null;
  onTag: (tag: ThemeTagId | null) => void;
  counts: Map<ThemeTagId, number>;
}) {
  const chip = (id: ThemeTagId | null, label: string, count: number) => (
    <button
      key={id ?? "all"}
      type="button"
      aria-pressed={tag === id}
      onClick={() => onTag(id)}
      className={cn(
        "shrink-0 rounded-full px-3 py-1 text-meta outline-none transition-colors focus-visible:shadow-focus",
        tag === id
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-ink-2 hover:text-foreground",
      )}
    >
      {label}
      <span className="ml-1 opacity-70">{count}</span>
    </button>
  );
  return (
    <fieldset className="m-0 flex min-w-0 gap-1.5 overflow-x-auto border-0 p-0 pb-0.5">
      <legend className="sr-only">Show themes good for</legend>
      {chip(null, "All", THEMES.length)}
      {FILTER_TAGS.map((t) => chip(t, tagLabel(t), counts.get(t) ?? 0))}
    </fieldset>
  );
}

export function ThemePicker({
  selectedId,
  onPick,
  title,
  ageBand,
  subtitle,
  samplesFor,
  className,
}: ThemePickerProps) {
  const [tag, setTag] = useState<ThemeTagId | null>(null);
  const [peek, setPeek] = useState<string | null>(null);
  const [kitReady, setKitReady] = useState(sampleKitReady);
  const groupRef = useRef<HTMLDivElement>(null);
  const shownTitle = title.trim() || "Untitled lesson";

  useEffect(() => {
    if (kitReady || samplesFor) return;
    let live = true;
    void loadSampleKit().then(() => live && setKitReady(true));
    return () => {
      live = false;
    };
  }, [kitReady, samplesFor]);

  const themes = useMemo(() => (tag ? THEMES.filter((t) => t.tags.includes(tag)) : THEMES), [tag]);
  const counts = useMemo(() => {
    const m = new Map<ThemeTagId, number>();
    for (const t of THEMES) for (const g of t.tags) m.set(g, (m.get(g) ?? 0) + 1);
    return m;
  }, []);
  const tabbableId = themes.some((t) => t.id === selectedId) ? selectedId : themes[0]?.id;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];
    if (!keys.includes(e.key)) return;
    const ids = themes.map((t) => t.id);
    const at = Math.max(0, ids.indexOf(peek && ids.includes(peek) ? peek : (tabbableId ?? "")));
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? ids.length - 1
          : e.key === "ArrowRight" || e.key === "ArrowDown"
            ? (at + 1) % ids.length
            : (at - 1 + ids.length) % ids.length;
    const id = ids[next];
    if (!id) return;
    e.preventDefault();
    onPick(id);
    groupRef.current?.querySelector<HTMLElement>(`[data-theme-tile="${id}"]`)?.focus();
  };

  // The large preview follows the pointer or focus, else the chosen theme.
  const shownId = peek ?? selectedId;
  const chosen = shownId === selectedId;
  const spotlight = useMemo(() => {
    const id = THEMES.some((t) => t.id === shownId) ? shownId : "paper";
    if (samplesFor) return samplesFor(id);
    return kitReady ? themeSamples(id, shownTitle, ageBand, subtitle) : null;
  }, [kitReady, shownId, shownTitle, ageBand, subtitle, samplesFor]);

  // Keep the chosen tile in view when the picker opens (on open only, not on every pick).
  // biome-ignore lint/correctness/useExhaustiveDependencies: on open only.
  useLayoutEffect(() => {
    groupRef.current
      ?.querySelector<HTMLElement>(`[data-theme-tile="${selectedId}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, []);

  return (
    <div className={cn("flex min-w-0 flex-col gap-3", className)}>
      <FilterChips tag={tag} onTag={setTag} counts={counts} />
      <div className="flex min-w-0 flex-col-reverse gap-4 md:grid md:grid-cols-[1fr_340px]">
        <div
          ref={groupRef}
          role="radiogroup"
          aria-label="Theme"
          tabIndex={-1}
          onKeyDown={onKeyDown}
          onPointerLeave={() => setPeek(null)}
          className="grid max-h-[min(40vh,560px)] grid-cols-2 content-start gap-1.5 overflow-y-auto p-1 sm:grid-cols-3 md:max-h-[min(66vh,580px)]"
        >
          {themes.map((theme) => (
            <Tile
              key={theme.id}
              theme={theme}
              title={shownTitle}
              ageBand={ageBand}
              subtitle={subtitle}
              samplesFor={samplesFor}
              kitReady={kitReady}
              selected={theme.id === selectedId}
              tabbable={theme.id === tabbableId}
              onPick={onPick}
              onPeek={setPeek}
            />
          ))}
        </div>
        {spotlight ? (
          <>
            <div className="min-w-0 overflow-y-auto pr-1 max-md:hidden md:max-h-[min(66vh,580px)]">
              <Spotlight samples={spotlight} chosen={chosen} />
            </div>
            <div className="md:hidden">
              <CompactSpotlight samples={spotlight} chosen={chosen} />
            </div>
          </>
        ) : (
          <div className="min-h-24" aria-hidden />
        )}
      </div>
    </div>
  );
}
