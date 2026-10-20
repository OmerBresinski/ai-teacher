import { type Lesson, richDocToPlainText, type Slide, type Theme } from "@tj/domain/documents";
import { uid } from "@tj/slides";
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

type Kit = {
  layoutTemplate: typeof import("@tj/slides/templates").layoutTemplate;
  templateSamples: typeof import("@tj/slides/templates/samples").templateSamples;
};

let kit: Kit | null = null;
let loading: Promise<Kit> | null = null;

/** Fetch the template code (once). Resolves when `themeSamples` can build slides. */
export function loadSampleKit(): Promise<Kit> {
  if (kit) return Promise.resolve(kit);
  loading ??= Promise.all([
    import("@tj/slides/templates"),
    import("@tj/slides/templates/samples"),
  ]).then(([templates, samples]) => {
    kit = { layoutTemplate: templates.layoutTemplate, templateSamples: samples.templateSamples };
    return kit;
  });
  return loading;
}

export const sampleKitReady = (): boolean => kit !== null;

/**
 * The sample photographs the previews place in a picture slot: set once by the app (bundled,
 * licence-free files). Unset, a slot draws the theme's picture placeholder.
 */
let photoFor: (label: string) => string = () => "";
export function setSamplePhotos(fn: (label: string) => string): void {
  photoFor = fn;
  cache.clear();
}

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
 * The sample lesson's layouts with no lesson yet (the blank dialog), in the order the large preview
 * shows them: one coherent Year 1 lesson, "Animals and their young" (a lamb with its ewe, a hen's
 * life cycle, a hinge question on which young look like their parents). The tile's second slide is
 * the life cycle diagram.
 */
export const SAMPLE_LAYOUTS = ["picture-text", "diagram-text", "hinge"] as const;

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
  const inputs = kit.templateSamples(photoFor);
  const lay = (template: string, patch: Record<string, unknown> = {}): Slide => {
    const input = inputs.find((i) => i.template === template);
    if (!input) throw new Error(`no sample for ${template}`);
    const laid = (kit as Kit).layoutTemplate({ ...input, ...patch } as typeof input, theme, stage);
    return { id: `sample-${themeId}-${template}`, ...laid.slide };
  };
  // The teacher's title on the cover, so its picture slot stays open: no photo of another topic.
  const cover = lay("title", {
    heading: title,
    lead: subtitle || undefined,
    figure: { photo: "", aspect: 4 / 3, alt: "" },
  });
  const layouts = SAMPLE_LAYOUTS.map((t) => lay(t));
  const samples = { theme, cover, visual: layouts[1] as Slide, layouts };
  if (cache.size >= MAX_CACHED) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, samples);
  return samples;
}

/** How much a slide shows of a theme's look: pictures, diagrams, answer cards, shapes. */
function visualScore(slide: Slide): number {
  if (["title", "objectives", "starter", "exit-ticket", "plenary"].includes(slide.kind)) return -1;
  let score = 0;
  const walk = (els: Slide["elements"]) => {
    for (const el of els) {
      if (el.type === "image") score += el.src && !el.src.startsWith("data:image/svg") ? 4 : 2;
      else if (el.type === "option") score += 1;
      else if (el.type === "icon" || el.type === "path") score += 0.5;
      else if (el.type === "table") score += 1;
      else if (el.type === "shape") score += 0.25;
      else if (el.type === "group") {
        score += 1;
        walk(el.children);
      }
    }
  };
  walk(slide.elements);
  if (slide.question) score += 2;
  return score;
}

/**
 * The open lesson's own slides for the picker (TEACH-258 part b, review 20 Oct: "see your lesson in
 * this theme"): its cover, its most visual slide for the tile, and up to three of its most visual
 * slides, in deck order, for the large preview. Slides with nothing visual fall back to the slides
 * after the cover.
 */
export function lessonPicks(lesson: Lesson): { cover: Slide; visual: Slide; layouts: Slide[] } {
  const cover = lesson.slides.find((s) => s.kind === "title") ?? lesson.slides[0];
  if (!cover) throw new Error("lesson has no slides");
  const rest = lesson.slides.filter((s) => s !== cover);
  const ranked = rest
    .map((slide, at) => ({ slide, at, score: visualScore(slide) }))
    .sort((a, b) => b.score - a.score || a.at - b.at);
  const best = ranked.filter((r) => r.score > 0);
  const chosen = (best.length ? best : ranked).slice(0, 3);
  const visual = chosen[0]?.slide ?? cover;
  const layouts = [...chosen].sort((a, b) => a.at - b.at).map((r) => r.slide);
  return { cover, visual, layouts };
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
  const k = await loadSampleKit();
  const input = k.templateSamples(() => "").find((i) => i.template === "title");
  if (!input) throw new Error("no title sample");
  const patched = { ...input, heading: title, lead: subtitle || undefined } as typeof input;
  return { id: uid(), ...k.layoutTemplate(patched, getTheme(themeId), "ks2").slide } as Slide;
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
