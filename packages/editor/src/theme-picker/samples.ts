import { type Lesson, richDocToPlainText, type Slide, type Theme } from "@tj/domain/documents";
import { accentTint, isOpenPhotoSlot, uid } from "@tj/slides";
import { FONT_LABELS, FONT_STACKS, type FontKey } from "@tj/slides/fonts";
import { getTheme, THEME_TAG_LABELS, THEMES } from "../model/themes";

/*
 * What the theme picker draws (Greg, decisions 34 and 72-75): each theme's own slides, laid out by
 * the writer's templates (`layoutTemplate`, the code a generated lesson is laid out by): the cover
 * with its picture slot, then its most visual layouts (a picture with text, stages, a hinge
 * question with answer cards). The cover carries the lesson's own title and second line.
 *
 * The template code is a chunk of its own: `loadSampleKit` fetches it once, when the picker opens,
 * and the slides are built once per theme and words and cached for the session.
 */

type Kit = { layoutTemplate: typeof import("@tj/slides/templates").layoutTemplate };

let kit: Kit | null = null;
let loading: Promise<Kit> | null = null;

/** Fetch the template code (once). Resolves when `themeSamples` can build slides. */
export function loadSampleKit(): Promise<Kit> {
  if (kit) return Promise.resolve(kit);
  loading ??= import("@tj/slides/templates").then((templates) => {
    kit = { layoutTemplate: templates.layoutTemplate };
    return kit;
  });
  return loading;
}

export const sampleKitReady = (): boolean => kit !== null;

export type ThemeSamples = {
  theme: Theme;
  /** The cover: the lesson's own, or the sample's with its picture slot open. */
  cover: Slide;
  /** The tile's second slide: the most visual one. */
  visual: Slide;
  /** The large preview's slides after the cover. */
  layouts: Slide[];
};

const MAX_CACHED = 96;
const cache = new Map<string, ThemeSamples>();

/** The writer's key stage for an age band ("ks3"), else KS2. */
function stageOf(ageBand?: string | null): "ks1" | "ks2" | "ks3" | "ks4" | "ks5" {
  return ageBand && /^ks[1-5]$/.test(ageBand) ? (ageBand as "ks1") : "ks2";
}

/**
 * The sample with no lesson yet (the blank dialog, review 20 Oct): topic-free teaching slides with
 * generic words, so nothing names a topic the teacher did not type, and every picture slot is
 * the theme's open slot. The tile's second slide is "Think, pair, share" (the theme's stages).
 */
export const SAMPLE_INPUTS = {
  "picture-text": {
    template: "picture-text",
    heading: "Key words",
    lead: "Two words for today.",
    points: [
      { label: "Word 1", text: "what it means" },
      { label: "Word 2", text: "what it means" },
    ],
    figure: { photo: "", aspect: 4 / 3, alt: "Your picture" },
  },
  stages: {
    template: "stages",
    heading: "Think, pair, share",
    stages: [
      { name: "Think", line: "On your own first.", icon: "work-alone" },
      { name: "Pair", line: "Talk it over.", icon: "work-pairs" },
      { name: "Share", line: "Tell the class.", icon: "work-group" },
    ],
  },
  hinge: {
    template: "hinge",
    heading: "Quick check",
    stem: "Which answer is right?",
    options: ["Answer A", "Answer B", "Answer C", "Answer D"],
  },
} as const;

/** The large preview's order for the sample. */
export const SAMPLE_LAYOUTS = ["picture-text", "stages", "hinge"] as const;

/**
 * The theme's sample slides for a lesson called `title` (with `subtitle` on the cover, or none),
 * at `ageBand`'s key stage when given. `null` until `loadSampleKit` has resolved.
 */
export function themeSamples(
  themeId: string,
  title: string,
  ageBand?: string | null,
  subtitle?: string,
): ThemeSamples | null {
  if (!kit) return null;
  const key = `${themeId}\u0000${title}\u0000${ageBand ?? ""}\u0000${subtitle ?? ""}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const theme = getTheme(themeId, ageBand);
  const stage = stageOf(ageBand);
  const lay = (input: Record<string, unknown>): Slide => {
    const laid = (kit as Kit).layoutTemplate(input as never, theme, stage);
    return { id: `sample-${themeId}-${String(input.template)}`, ...laid.slide };
  };
  const cover = withSlotsDrawn(coverIn(theme, stage, title, subtitle, ""), theme);
  const layouts = SAMPLE_LAYOUTS.map((t) => withSlotsDrawn(lay(SAMPLE_INPUTS[t]), theme));
  const samples = { theme, cover, visual: layouts[1] as Slide, layouts };
  if (cache.size >= MAX_CACHED) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, samples);
  return samples;
}

/**
 * An open picture slot drawn as the editor draws it (`SlotPlaceholder`): the theme's accent tint
 * with a muted camera. A thumbnail lays an open slot away, so the picker gives it this picture to
 * show where the photo goes (Greg 75: "where's the photo placeholder?").
 */
export function slotPicture(theme: Theme, w: number, h: number): string {
  const s = Math.max(24, Math.min(w, h) * 0.22);
  const k = s / 24;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${accentTint(theme)}"/><g transform="translate(${(w - s) / 2} ${(h - s) / 2}) scale(${k})" fill="none" stroke="${theme.colors.muted}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></g></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

type El = Slide["elements"][number];
function drawElement(el: El, theme: Theme): El {
  if (el.type === "image" && (el.src === "" || isOpenPhotoSlot(el)))
    return { ...el, src: slotPicture(theme, Math.round(el.w), Math.round(el.h)), fit: "cover" };
  if (el.type === "group")
    return { ...el, children: el.children.map((c) => drawElement(c, theme)) };
  return el;
}

/** `slide` with every open picture slot drawn (`slotPicture`), so a thumbnail keeps it. */
export function withSlotsDrawn(slide: Slide, theme: Theme): Slide {
  return { ...slide, elements: slide.elements.map((el) => drawElement(el, theme)) };
}

const RANK: [RegExp, number][] = [
  [/^(image-text|picture-text|big-picture|picture-sequence)$/, 6],
  [/^(diagram|diagram-text|big-diagram|figure)$/, 5],
  [/^(stages|steps|steps-model|worked|worked-example|items-row)$/, 4],
  [/^(vocabulary|panel-list|cards-grid|split-compare|compare|reasons|myth)$/, 3],
  [/^(hinge|multiple-choice|question-set|matching|sort)$/, 2],
];

/** The writer's template behind a slide, when it was laid out by one. */
function templateOf(slide: Slide): string | undefined {
  for (const el of slide.elements) if (el.type === "group" && el.layout) return el.layout.template;
  return undefined;
}

/**
 * How well a slide shows a theme (review 20 Oct): a picture with text, then a diagram, stages or
 * a process, key-word cards, a hinge question, anything else; true/false only when nothing else.
 */
export function visualRank(slide: Slide): number {
  if (["title", "objectives", "starter", "exit-ticket", "plenary"].includes(slide.kind)) return 0;
  const hasPicture = slide.elements.some((el) => el.type === "image");
  const names = [templateOf(slide), slide.kind].filter(Boolean) as string[];
  let rank = slide.kind === "true-false" ? 0.5 : 1;
  for (const [re, r] of RANK) if (names.some((n) => re.test(n))) rank = Math.max(rank, r);
  if (hasPicture) rank = Math.max(rank, 6);
  return rank;
}

/**
 * The open lesson's own slides for the picker ("see your lesson in this theme"): its cover's
 * words and picture, its most visual slide for the tile, and up to three of its most visual slides
 * (by `visualRank`, kept in deck order) for the large preview.
 */
export function lessonPicks(lesson: Lesson): {
  title: string;
  subtitle: string;
  photo: string;
  /** The lesson's own cover, drawn until the template code has arrived. */
  cover: Slide;
  visual: Slide;
  layouts: Slide[];
} {
  const cover = lesson.slides.find((s) => s.kind === "title");
  const picture = cover?.elements.find(
    (el) => el.type === "image" && el.src && !el.src.startsWith("data:"),
  );
  const rest = lesson.slides.filter((s) => s !== cover);
  const ranked = rest
    .map((slide, at) => ({ slide, at, rank: visualRank(slide) }))
    .sort((a, b) => b.rank - a.rank || a.at - b.at);
  const chosen = ranked.slice(0, 3);
  const first = chosen[0]?.slide ?? cover ?? lesson.slides[0];
  if (!first) throw new Error("lesson has no slides");
  const words = coverWords(lesson);
  return {
    ...words,
    photo: picture?.type === "image" ? picture.src : "",
    cover: cover ?? first,
    visual: first,
    layouts: [...chosen].sort((a, b) => a.at - b.at).map((r) => r.slide),
  };
}

/**
 * The theme's own cover (its title template) with `title`, `subtitle` and a picture: `photo`, or
 * the open slot the editor draws as a tinted box with a camera ("" ).
 */
export function coverIn(
  theme: Theme,
  stage: "ks1" | "ks2" | "ks3" | "ks4" | "ks5",
  title: string,
  subtitle: string | undefined,
  photo: string,
): Slide {
  if (!kit) throw new Error("sample kit not loaded");
  const input = {
    template: "title",
    heading: title,
    lead: subtitle || undefined,
    figure: { photo, aspect: 4 / 3, alt: photo ? title : "Your cover photo" },
  };
  const laid = kit.layoutTemplate(input as never, theme, stage);
  return { id: `cover-${theme.id}-${photo ? "photo" : "open"}`, ...laid.slide };
}

/**
 * The theme's cover for a lesson (review 20 Oct): its title template with the lesson's words and
 * cover photo, or the theme's open slot drawn. `null` until `loadSampleKit` has resolved.
 */
export function themeCover(
  theme: Theme,
  ageBand: string | null | undefined,
  title: string,
  subtitle: string | undefined,
  photo: string,
): Slide | null {
  if (!kit) return null;
  return withSlotsDrawn(coverIn(theme, stageOf(ageBand), title, subtitle, photo), theme);
}

/**
 * A blank lesson's cover (decision 75): the theme's cover with its picture slot open, so the
 * teacher sees where the photo goes. Built by the same template as the previews.
 */
export async function blankCover(
  themeId: string,
  title: string,
  subtitle?: string,
): Promise<Slide> {
  await loadSampleKit();
  return { ...coverIn(getTheme(themeId), "ks2", title, subtitle, ""), id: uid() };
}

/**
 * The words an existing lesson's own cover carries, for the previews: its title and its second
 * line as the teacher sees them ("Year 5. Where rain comes from"), else the lesson's title and its
 * year and subject. A preview never invents a class the lesson is not for.
 */
export function coverWords(lesson: Lesson): { title: string; subtitle: string } {
  const cover = lesson.slides.find((s) => s.kind === "title");
  const textAt = (preset: string): string | undefined => {
    for (const el of cover?.elements ?? []) {
      if (el.type !== "text" || el.style?.preset !== preset || !el.doc) continue;
      const text = richDocToPlainText(el.doc).trim();
      if (text) return text;
    }
    return undefined;
  };
  return {
    title: textAt("title") ?? lesson.title,
    subtitle: textAt("subtitle") ?? [lesson.yearGroup, lesson.subject].filter(Boolean).join(" · "),
  };
}

/** Test seam: how many sample sets are cached. */
export const cachedSampleCount = (): number => cache.size;

const FONT_BY_STACK = new Map<string, string>(
  (Object.keys(FONT_STACKS) as FontKey[]).map((key) => [FONT_STACKS[key], FONT_LABELS[key]]),
);

/** The family a stack names first, as a teacher reads it ("Fredoka"). */
export function fontName(stack: string): string {
  const known = FONT_BY_STACK.get(stack);
  if (known) return known;
  const first = stack.split(",")[0] ?? stack;
  return first.replace(/var\(--font-|\)|["']/g, "").trim();
}

/** "Fredoka and Nunito", or one name when the title and the body share a family. */
export function fontPair(theme: Theme): { title: string; body: string; label: string } {
  const title = fontName(theme.fonts.title);
  const body = fontName(theme.fonts.body);
  return { title, body, label: title === body ? title : `${title} and ${body}` };
}

/** The colours a teacher sees on the slides: ground, cards, ink, headings and the two accents. */
export function paletteOf(theme: Theme): { name: string; value: string }[] {
  const c = theme.colors;
  const all = [
    { name: "Background", value: c.background },
    { name: "Cards", value: c.panel ?? c.surface },
    { name: "Text", value: c.ink },
    { name: "Headings", value: c.heading ?? c.ink },
    { name: "Accent", value: c.accent },
    { name: "Second accent", value: c.accent2 },
  ];
  const seen = new Set<string>();
  return all.filter(({ value }) => {
    const v = value.toLowerCase();
    if (seen.has(v)) return false;
    seen.add(v);
    return true;
  });
}

/** Who a theme suits: its age line (the first sentence of `suits`, up to a colon) and its look. */
export function suitsOf(theme: Theme): { who: string; look: string } {
  const [first = theme.suits, ...rest] = theme.suits.split(/(?<=\.)\s+/);
  // "Any age, for a calm room: flat, muted, ..." reads as who, then the look.
  const [who = first, detail] = first.replace(/\.$/, "").split(/:\s+/);
  const look = [detail ? `${detail[0]?.toUpperCase()}${detail.slice(1)}.` : "", ...rest];
  return { who, look: look.filter(Boolean).join(" ") };
}

export type ThemeTagId = Theme["tags"][number];

export const tagLabel = (tag: ThemeTagId): string => THEME_TAG_LABELS[tag];

/** The filter chips: every tag a picker theme carries, in the labels' order. */
export const FILTER_TAGS: ThemeTagId[] = (Object.keys(THEME_TAG_LABELS) as ThemeTagId[]).filter(
  (tag) => THEMES.some((t) => t.tags.includes(tag)),
);
