import { type LessonFacts, SLIDE_W, type Slide, type SlideKind } from "@tj/domain/documents";
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@tj/ui";
import { type ReactElement, type ReactNode, useMemo, useRef, useState } from "react";
import { PanelLabel } from "../kit/Panel";
import { Segmented } from "../kit/Segmented";
import {
  ACTIVITY_DESCRIPTIONS,
  ACTIVITY_GROUPS,
  ACTIVITY_LABELS,
  ACTIVITY_MINUTES,
  ACTIVITY_TIERS,
  type ActivityId,
  type ActivityTier,
  buildActivity,
} from "../model/derive-activities";
import { newSlide } from "../model/factories";
import { SLIDE_KIND_DESCRIPTIONS, SLIDE_KIND_LABELS, SLIDE_KIND_ORDER } from "../model/layouts";
import { getTheme } from "../model/themes";
import { SlideScaler } from "../slide/SlideScaler";
import { SlideView } from "../slide/SlideView";

const PREVIEW_W = 144;
const PREVIEW_H = 81;
const COLS = 3;

export type PickerTab = "layouts" | "activities";

/**
 * The slide picker (TeachDeck `components/v2/editor/AddSlidePicker.tsx`): a popover of real
 * 144x81 renders with the pedagogical name and a line saying what the slide does beneath, so the
 * teacher chooses a slide by recognising its shape rather than by reading a list of nouns. Two
 * tabs (TEACH-185): Layouts is every slide kind; Activities is the one activity picker, grouped
 * Check, Apply, Structure, with a tier chip. Its cards preview the slide they insert, derived
 * from the lesson's facts when it has them.
 */
export function AddSlidePicker({
  themeId,
  facts,
  onPick,
  onInsert,
  trigger,
  side = "top",
  align = "start",
  initialTab = "layouts",
}: {
  themeId: string;
  /** The lesson's facts, when it has them: the activity cards derive from these. */
  facts?: LessonFacts;
  /** Layouts tab: add a fresh slide of this kind. */
  onPick: (kind: SlideKind) => void;
  /** Activities tab: insert this built slide. */
  onInsert: (slide: Slide) => void;
  trigger: ReactElement;
  side?: "top" | "bottom" | "right";
  align?: "start" | "end";
  initialTab?: PickerTab;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<PickerTab>(initialTab);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent side={side} align={align} className="w-[520px] p-0" aria-label="Add slide">
        <Tabs value={tab} onValueChange={(v) => setTab(v as PickerTab)} className="gap-0 p-3">
          <div className="flex items-center justify-between gap-2 pb-2">
            <PanelLabel className="px-0.5">Add slide</PanelLabel>
            <TabsList aria-label="Slide picker">
              <TabsTrigger value="layouts">Layouts</TabsTrigger>
              <TabsTrigger value="activities">Activities</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="layouts">
            <LayoutGrid
              themeId={themeId}
              onPick={(kind) => {
                onPick(kind);
                setOpen(false);
              }}
            />
          </TabsContent>
          <TabsContent value="activities">
            <ActivityGrid
              themeId={themeId}
              facts={facts}
              onInsert={(slide) => {
                onInsert(slide);
                setOpen(false);
              }}
            />
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Roving tabindex over the cards inside `grid`: one card is ever a Tab stop, so the others do not
 * queue up behind it, and the arrows walk the grid.
 */
function useRovingGrid() {
  const grid = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step =
      e.key === "ArrowRight"
        ? 1
        : e.key === "ArrowLeft"
          ? -1
          : e.key === "ArrowDown"
            ? COLS
            : e.key === "ArrowUp"
              ? -COLS
              : 0;
    if (!step) return;
    e.preventDefault();
    const items = Array.from(
      grid.current?.querySelectorAll<HTMLButtonElement>("button[role='menuitem']") ?? [],
    );
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = Math.min(items.length - 1, Math.max(0, (i < 0 ? 0 : i) + step));
    setActive(next);
    items[next]?.focus();
  };
  return { grid, active, setActive, onKeyDown };
}

function LayoutGrid({ themeId, onPick }: { themeId: string; onPick: (kind: SlideKind) => void }) {
  const theme = useMemo(() => getTheme(themeId), [themeId]);
  const previews = useMemo(
    () => SLIDE_KIND_ORDER.map((kind) => ({ kind, slide: newSlide(kind, themeId) })),
    [themeId],
  );
  const { grid, active, setActive, onKeyDown } = useRovingGrid();
  return (
    /* A menu of layout choices drawn as pictures: the keyboard model is a menu's, so the roles say so. */
    <div
      ref={grid}
      role="menu"
      aria-label="Slide kinds"
      className="grid max-h-[460px] grid-cols-3 gap-3 overflow-y-auto"
    >
      {previews.map(({ kind, slide }, i) => (
        <Card
          key={kind}
          label={SLIDE_KIND_LABELS[kind]}
          description={SLIDE_KIND_DESCRIPTIONS[kind]}
          tabIndex={i === active ? 0 : -1}
          onFocus={() => setActive(i)}
          onKeyDown={onKeyDown}
          onClick={() => onPick(kind)}
        >
          <SlideScaler zoom={PREVIEW_W / SLIDE_W}>
            <SlideView slide={slide} theme={theme} mode="thumb" />
          </SlideScaler>
        </Card>
      ))}
    </div>
  );
}

function ActivityGrid({
  themeId,
  facts,
  onInsert,
}: {
  themeId: string;
  facts?: LessonFacts;
  onInsert: (slide: Slide) => void;
}) {
  const theme = useMemo(() => getTheme(themeId), [themeId]);
  const [tier, setTier] = useState<ActivityTier>("core");
  // The preview is the slide the card inserts, built once per facts, theme and tier.
  const previews = useMemo(() => {
    const out = new Map<ActivityId, Slide>();
    for (const group of ACTIVITY_GROUPS)
      for (const id of group.activities) out.set(id, buildActivity(id, themeId, { facts, tier }));
    return out;
  }, [themeId, facts, tier]);
  const { grid, active, setActive, onKeyDown } = useRovingGrid();
  let index = -1;
  return (
    <div className="flex flex-col gap-2">
      <Segmented
        aria-label="Tier"
        value={tier}
        options={ACTIVITY_TIERS}
        onChange={setTier}
        className="self-start"
      />
      <div
        ref={grid}
        role="menu"
        aria-label="Activities"
        className="flex max-h-[440px] flex-col gap-3 overflow-y-auto"
      >
        {ACTIVITY_GROUPS.map((group) => (
          // biome-ignore lint/a11y/useSemanticElements: a fieldset cannot sit inside a menu; the group role names the section for a screen reader
          <div
            key={group.id}
            role="group"
            aria-label={group.label}
            className="flex flex-col gap-1.5"
          >
            <PanelLabel className="px-0.5">{group.label}</PanelLabel>
            <div className="grid grid-cols-3 gap-3">
              {group.activities.map((id) => {
                index += 1;
                const i = index;
                const slide = previews.get(id);
                if (!slide) return null;
                return (
                  <Card
                    key={id}
                    label={ACTIVITY_LABELS[id]}
                    description={ACTIVITY_DESCRIPTIONS[id]}
                    minutes={ACTIVITY_MINUTES[id]}
                    data-activity={id}
                    tabIndex={i === active ? 0 : -1}
                    onFocus={() => setActive(i)}
                    onKeyDown={onKeyDown}
                    // Insert a copy: the preview stays put and the inserted slide is its own object.
                    onClick={() => onInsert(structuredClone(slide))}
                  >
                    <SlideScaler zoom={PREVIEW_W / SLIDE_W}>
                      <SlideView slide={slide} theme={theme} mode="thumb" />
                    </SlideScaler>
                  </Card>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Card({
  label,
  description,
  minutes,
  children,
  ...rest
}: {
  label: string;
  description: string;
  minutes?: number;
  children: ReactNode;
  tabIndex: number;
  onFocus: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onClick: () => void;
  "data-activity"?: string;
}) {
  return (
    <Button
      variant="ghost"
      role="menuitem"
      // The name is the kind, not the preview's own words plus the description.
      aria-label={label}
      aria-description={minutes ? `${description}. ${minutes} minutes` : description}
      className="group/kind h-auto w-full items-stretch justify-start rounded-control p-1 text-left font-normal"
      {...rest}
    >
      <span className="flex w-full flex-col items-stretch gap-1 self-start">
        <span
          aria-hidden
          className="block overflow-hidden rounded-chip shadow-[0_0_0_1px_var(--border)] group-hover/kind:shadow-[0_0_0_1px_var(--border-strong)]"
          style={{ width: PREVIEW_W, height: PREVIEW_H }}
        >
          {children}
        </span>
        <span className="flex items-baseline justify-between gap-1">
          <span className="truncate text-ink-2 text-meta group-hover/kind:text-foreground">
            {label}
          </span>
          {minutes ? (
            <span className="shrink-0 text-eyebrow text-ink-3 tabular-nums">{minutes} min</span>
          ) : null}
        </span>
        <span className="line-clamp-2 whitespace-normal text-eyebrow text-ink-3">
          {description}
        </span>
      </span>
    </Button>
  );
}
