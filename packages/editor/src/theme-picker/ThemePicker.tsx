import type { Slide, Theme } from "@tj/domain/documents";
import { cn } from "@tj/ui";
import { Check } from "lucide-react";
import {
  type KeyboardEvent,
  memo,
  type ReactNode,
  useCallback,
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
  groupThemes,
  paletteOf,
  suitsOf,
  type ThemeSamples,
  type ThemeTagId,
  tagLabel,
  themeSamples,
} from "./samples";

/*
 * The theme picker (Greg, decision 34): every place a teacher picks a theme — the blank lesson's
 * dialog, the editor's Theme dialog, the dialog while a lesson is being made — draws the same
 * choices. Each theme is shown by the slide renderer itself (`SlideFluid`, the library's
 * thumbnail): its own cover and a teaching slide, its fonts, its colours, its name and who it
 * suits, with a larger preview on hover or focus.
 *
 * Calm and fast: a tile draws its slides only once it scrolls near the view (an
 * IntersectionObserver), the sample slides are built once per theme and cached (`samples.ts`),
 * and a theme drawn once stays drawn when the picker reopens.
 *
 * Three layouts are built for Greg to compare (QUESTIONS.md): `spotlight` (tiles beside a large
 * preview), `cards` (rich cards in groups, a larger peek on hover) and `list` (a list beside a
 * large stage). `?picker=a|b|c` chooses one while the question is open.
 *
 * Keyboard: the tiles are one radio group (one tab stop; arrows, Home and End move and choose),
 * and the filter chips are toggle buttons. Each radio names the theme and describes its fonts,
 * colours and who it suits.
 */

export type PickerVariant = "spotlight" | "cards" | "list";

const VARIANT_PARAM: Record<string, PickerVariant> = {
  a: "spotlight",
  b: "cards",
  c: "list",
  spotlight: "spotlight",
  cards: "cards",
  list: "list",
};

/** The layout `?picker=` asks for, else the spotlight. */
export function pickerVariant(): PickerVariant {
  if (typeof window === "undefined") return "spotlight";
  try {
    const asked = new URLSearchParams(window.location.search).get("picker") ?? "";
    return VARIANT_PARAM[asked] ?? "spotlight";
  } catch {
    return "spotlight";
  }
}

export type ThemePickerProps = {
  selectedId: string;
  onPick: (themeId: string) => void;
  /** The lesson's title, drawn on every cover. */
  title: string;
  /** The lesson's age band: the previews use its type scale. */
  ageBand?: string | null;
  /** The cover's second line ("Year 4 · Science"); none when empty. */
  subtitle?: string;
  variant?: PickerVariant;
  className?: string;
};

/** Themes drawn at least once this session: they draw at once when the picker reopens. */
const drawn = new Set<string>();

/** Draws its children once the box comes within reach of the view; till then, the theme's ground. */
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

function Mini({
  slide,
  theme,
  near,
  className,
}: {
  slide: Slide;
  theme: Theme;
  near: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn("overflow-hidden rounded-chip shadow-[0_0_0_1px_var(--border)]", className)}
      style={{ background: theme.colors.background }}
    >
      {near ? (
        <SlideFluid slide={slide} theme={theme} />
      ) : (
        <div style={{ aspectRatio: "16 / 9" }} />
      )}
    </div>
  );
}

function Palette({ theme, size = "dots" }: { theme: Theme; size?: "dots" | "strip" | "named" }) {
  const colours = paletteOf(theme);
  if (size === "strip") {
    return (
      <span aria-hidden className="flex h-2 w-full overflow-hidden rounded-full" data-palette>
        {colours.map((c) => (
          <span key={c.name} className="flex-1" style={{ background: c.value }} />
        ))}
      </span>
    );
  }
  if (size === "named") {
    return (
      <ul className="flex flex-wrap gap-x-3 gap-y-1.5" data-palette aria-label="Colours">
        {colours.map((c) => (
          <li key={c.name} className="flex items-center gap-1.5 text-meta text-ink-2">
            <span
              aria-hidden
              className="size-4 rounded-full shadow-[0_0_0_1px_var(--border-strong)]"
              style={{ background: c.value }}
            />
            {c.name}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <span aria-hidden className="flex -space-x-1" data-palette>
      {colours.map((c) => (
        <span
          key={c.name}
          className="size-3.5 rounded-full shadow-[0_0_0_1.5px_var(--card)]"
          style={{ background: c.value }}
        />
      ))}
    </span>
  );
}

function Tags({ theme }: { theme: Theme }) {
  if (theme.tags.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {theme.tags.map((tag) => (
        <span
          key={tag}
          className="rounded-full bg-muted px-2 py-0.5 text-meta leading-none text-ink-2"
        >
          {tagLabel(tag)}
        </span>
      ))}
    </span>
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

/** The large preview: cover, teaching slide and question, fonts, colours, who it suits. */
function Spotlight({ samples, stage = false }: { samples: ThemeSamples; stage?: boolean }) {
  const { theme } = samples;
  const fonts = fontPair(theme);
  const { who, look } = suitsOf(theme);
  return (
    <div className="flex min-w-0 flex-col gap-3" data-theme-spotlight={theme.id} aria-hidden>
      <div className={cn("grid gap-2", stage && "grid-cols-2")}>
        <Mini slide={samples.cover} theme={theme} near />
        <Mini slide={samples.content} theme={theme} near />
      </div>
      <div className="flex flex-col gap-2">
        <ThemeName theme={theme} className={stage ? "text-title" : "text-heading"} />
        <p className="text-meta text-ink-2">
          <span className="text-foreground">{who}.</span> {look}
        </p>
        <div className="flex items-baseline gap-3">
          <span
            className="text-[28px] leading-none text-foreground"
            style={{ fontFamily: theme.fonts.title, fontWeight: theme.weights.title }}
          >
            Aa
          </span>
          <span className="text-meta text-ink-2">
            <span style={{ fontFamily: theme.fonts.title }}>{fonts.title}</span>
            {fonts.title === fonts.body ? null : (
              <>
                {" for titles, "}
                <span style={{ fontFamily: theme.fonts.body }}>{fonts.body}</span>
                {" for text"}
              </>
            )}
          </span>
        </div>
        <Palette theme={theme} size="named" />
        <Tags theme={theme} />
      </div>
    </div>
  );
}

type TileProps = {
  theme: Theme;
  title: string;
  ageBand?: string | null;
  subtitle?: string;
  selected: boolean;
  tabbable: boolean;
  layout: PickerVariant;
  onPick: (id: string) => void;
  onPeek: (id: string | null, el?: HTMLElement) => void;
};

/** One theme: a radio drawn as its slides. */
const Tile = memo(function Tile({
  theme: base,
  title,
  ageBand,
  subtitle,
  selected,
  tabbable,
  layout,
  onPick,
  onPeek,
}: TileProps) {
  const descId = useId();
  const [ref, near] = useNearView(`${base.id}|${title}|${ageBand ?? ""}|${subtitle ?? ""}`);
  const samples = useMemo(
    () => (near ? themeSamples(base.id, title, ageBand, subtitle) : null),
    [near, base.id, title, ageBand, subtitle],
  );
  const theme = samples?.theme ?? base;
  const fonts = fontPair(theme);
  const { who } = suitsOf(theme);
  const check = selected ? (
    <span className="absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-1">
      <Check size={13} strokeWidth={2.25} />
    </span>
  ) : null;

  const ready = Boolean(samples);
  const cover = samples?.cover as Slide;
  const content = samples?.content as Slide;
  const whoLine = <span className="line-clamp-2 text-meta text-ink-3">{who}</span>;

  let body: ReactNode;
  if (layout === "list") {
    body = (
      <span className="flex w-full items-center gap-3">
        <span className="relative w-28 shrink-0">
          <Mini slide={cover} theme={theme} near={ready} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <ThemeName theme={theme} className="text-body" />
          {whoLine}
          <span className="truncate text-meta text-ink-3">{fonts.label}</span>
        </span>
        {selected ? <Check size={16} className="shrink-0 text-primary" /> : null}
      </span>
    );
  } else if (layout === "cards") {
    body = (
      <span className="flex w-full flex-col gap-2">
        <span className="relative grid grid-cols-2 gap-1.5">
          <Mini slide={cover} theme={theme} near={ready} />
          <Mini slide={content} theme={theme} near={ready} />
          {check}
        </span>
        <span className="flex items-center justify-between gap-2">
          <ThemeName theme={theme} className="text-body" />
          <Palette theme={theme} />
        </span>
        <span className="line-clamp-2 text-meta text-ink-2">
          <span className="text-foreground">{who}</span> · {fonts.label}
        </span>
        <Tags theme={theme} />
      </span>
    );
  } else {
    // The cover with a teaching slide tucked into its corner: the theme's ground and art, and its
    // badges, cards and accent shapes, in one tile.
    body = (
      <span className="flex w-full flex-col gap-1.5">
        <span className="relative block pb-[14%]">
          <span className="block w-[82%]">
            <Mini slide={cover} theme={theme} near={ready} />
          </span>
          <span className="absolute right-0 bottom-0 block w-[52%] rounded-chip shadow-2">
            <Mini slide={content} theme={theme} near={ready} />
          </span>
          {check}
        </span>
        <ThemeName theme={theme} className="text-body" />
        {whoLine}
      </span>
    );
  }

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
        onFocus={(e) => onPeek(base.id, e.currentTarget)}
        onPointerEnter={(e) => onPeek(base.id, e.currentTarget)}
        className={cn(
          "flex w-full rounded-control p-1.5 text-left outline-none transition-colors",
          "hover:bg-muted focus-visible:shadow-focus",
          selected && "bg-muted shadow-[0_0_0_2px_var(--primary)]",
        )}
      >
        {body}
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

/** Where the cards' peek sits: beside the card, inside the picker. */
type PeekAt = { id: string; top: number; left: number; width: number };

export function ThemePicker({
  selectedId,
  onPick,
  title,
  ageBand,
  subtitle,
  variant = "spotlight",
  className,
}: ThemePickerProps) {
  const [tag, setTag] = useState<ThemeTagId | null>(null);
  const [peek, setPeek] = useState<string | null>(null);
  const [peekAt, setPeekAt] = useState<PeekAt | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shownTitle = title.trim() || "Untitled lesson";

  const themes = useMemo(() => (tag ? THEMES.filter((t) => t.tags.includes(tag)) : THEMES), [tag]);
  const counts = useMemo(() => {
    const m = new Map<ThemeTagId, number>();
    for (const t of THEMES) for (const g of t.tags) m.set(g, (m.get(g) ?? 0) + 1);
    return m;
  }, []);
  const tabbableId = themes.some((t) => t.id === selectedId) ? selectedId : themes[0]?.id;

  const onPeek = useCallback(
    (id: string | null, el?: HTMLElement) => {
      setPeek(id);
      if (variant !== "cards") return;
      if (peekTimer.current) clearTimeout(peekTimer.current);
      if (!id || !el) {
        setPeekAt(null);
        return;
      }
      // A short wait, so a pointer crossing the grid does not flash a peek on every card.
      peekTimer.current = setTimeout(() => {
        const root = rootRef.current?.getBoundingClientRect();
        const card = el.getBoundingClientRect();
        if (!root) return;
        const width = Math.min(380, root.width - 16);
        const right = card.right - root.left + 8;
        const left =
          right + width <= root.width ? right : Math.max(8, card.left - root.left - width - 8);
        const top = Math.max(0, Math.min(card.top - root.top, root.height - 420));
        setPeekAt({ id, top, left, width });
      }, 220);
    },
    [variant],
  );
  useEffect(
    () => () => {
      if (peekTimer.current) clearTimeout(peekTimer.current);
    },
    [],
  );

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
  const spotlight = useMemo(
    () =>
      themeSamples(
        THEMES.some((t) => t.id === shownId) ? shownId : "paper",
        shownTitle,
        ageBand,
        subtitle,
      ),
    [shownId, shownTitle, ageBand, subtitle],
  );

  // Keep the chosen tile in view when the picker opens (on open only, not on every pick).
  // biome-ignore lint/correctness/useExhaustiveDependencies: on open only.
  useLayoutEffect(() => {
    groupRef.current
      ?.querySelector<HTMLElement>(`[data-theme-tile="${selectedId}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, []);

  const tile = (theme: Theme) => (
    <Tile
      key={theme.id}
      theme={theme}
      title={shownTitle}
      ageBand={ageBand}
      subtitle={subtitle}
      selected={theme.id === selectedId}
      tabbable={theme.id === tabbableId}
      layout={variant}
      onPick={onPick}
      onPeek={onPeek}
    />
  );

  const radios = (children: ReactNode, cls: string) => (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label="Theme"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onPointerLeave={() => onPeek(null)}
      className={cls}
      data-picker-variant={variant}
    >
      {children}
    </div>
  );

  const chips = <FilterChips tag={tag} onTag={setTag} counts={counts} />;

  if (variant === "cards") {
    return (
      <div ref={rootRef} className={cn("relative flex min-w-0 flex-col gap-3", className)}>
        {chips}
        {radios(
          groupThemes(themes).map((group) => (
            // biome-ignore lint/a11y/useSemanticElements: a labelled band inside the radio group.
            <div
              key={group.id}
              role="group"
              aria-label={group.label}
              className="flex flex-col gap-2"
            >
              <h3 className="text-meta font-medium text-ink-3">{group.label}</h3>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {group.themes.map(tile)}
              </div>
            </div>
          )),
          "flex max-h-[min(66vh,620px)] flex-col gap-4 overflow-y-auto p-1",
        )}
        {peekAt ? (
          <div
            className="pointer-events-none absolute z-20 hidden rounded-card bg-card p-3 shadow-3 sm:block"
            style={{ top: peekAt.top, left: peekAt.left, width: peekAt.width }}
            data-theme-peek={peekAt.id}
          >
            <Spotlight samples={themeSamples(peekAt.id, shownTitle, ageBand, subtitle)} />
          </div>
        ) : null}
      </div>
    );
  }

  if (variant === "list") {
    return (
      <div className={cn("flex min-w-0 flex-col gap-3", className)}>
        {chips}
        <div className="flex min-w-0 flex-col-reverse gap-4 md:grid md:grid-cols-[300px_1fr]">
          {radios(
            themes.map(tile),
            "flex max-h-[min(44vh,560px)] flex-col gap-0.5 overflow-y-auto p-1 md:max-h-[min(66vh,580px)]",
          )}
          <div className="w-full min-w-0 max-w-[560px] max-md:hidden">
            <Spotlight samples={spotlight} stage />
          </div>
          <div className="md:hidden">
            <CompactSpotlight samples={spotlight} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex min-w-0 flex-col gap-3", className)}>
      {chips}
      <div className="flex min-w-0 flex-col-reverse gap-4 md:grid md:grid-cols-[1fr_320px]">
        {radios(
          themes.map(tile),
          "grid max-h-[min(40vh,560px)] grid-cols-2 content-start gap-1.5 overflow-y-auto p-1 sm:grid-cols-3 md:max-h-[min(66vh,580px)]",
        )}
        <div className="min-w-0 max-md:hidden">
          <Spotlight samples={spotlight} />
        </div>
        <div className="md:hidden">
          <CompactSpotlight samples={spotlight} />
        </div>
      </div>
    </div>
  );
}

/** The spotlight on a phone: two slides side by side and one line of facts. */
function CompactSpotlight({ samples }: { samples: ThemeSamples }) {
  const { theme } = samples;
  return (
    <div className="flex flex-col gap-2" aria-hidden data-theme-spotlight={theme.id}>
      <div className="grid grid-cols-2 gap-2">
        <Mini slide={samples.cover} theme={theme} near />
        <Mini slide={samples.content} theme={theme} near />
      </div>
      <div className="flex items-center justify-between gap-2">
        <ThemeName theme={theme} className="text-body" />
        <Palette theme={theme} />
      </div>
      <span className="text-meta text-ink-2">
        {fontPair(theme).label} · {suitsOf(theme).who}
      </span>
    </div>
  );
}
