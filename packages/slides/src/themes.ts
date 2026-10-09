import type { CalloutKind, TextPreset, Theme } from "@tj/domain/documents";
import { FONT_STACKS } from "./fonts";

/**
 * Ten classroom themes (look/themes, 26 Sept 2026): four clean (Studio, Exam Hall, Night Lab,
 * Beacon), four playful (Playground, Crayon Box, Splash, Treehouse) and two between (Chalk & Cream,
 * Reading Room). Type stops are defined at 800x450 (docs/research/04-visual-direction.md) and
 * scaled by 1.2 to our 960x540 space. Every ink/muted/accent pair is WCAG AA or better on the
 * background, the surface and every colour in the theme's art (`themes.test.ts`). A new theme's
 * type must not narrow the content budgets (`content-shapes.test.ts`): set it no wider than Chalk.
 *
 * Preset mapping: title = research "display", subtitle = research "title",
 * heading = research "heading", body/small as is, caption = research "eyebrow".
 */

const S = 1.2;
/**
 * Teaching body (UX ruling 140): the `body` stop is the reading matter a slide
 * teaches with (explain and photo bodies, list items, captions). It is set at 0.7 of the display
 * ladder's body stop, about 30–33 px on a 1440 projector, so a teaching slide
 * carries a paragraph rather than three lines. Each theme keeps its own ratio; titles, headings,
 * question stems and option cards keep their stops.
 */
const TEACH = 0.7;
type Stops = [number, number][]; // [size@800, lineHeight] in order title, subtitle, heading, body, small, caption
const PRESETS: TextPreset[] = ["title", "subtitle", "heading", "body", "small", "caption"];

/** Each theme's display body stop, before the teaching cut (keyed by the theme's `sizes` object). */
const RAW_BODY = new WeakMap<Record<TextPreset, number>, number>();

function type(stops: Stops) {
  const sizes = {} as Record<TextPreset, number>;
  const lineHeights = {} as Record<TextPreset, number>;
  stops.forEach(([size, lh], i) => {
    const preset = PRESETS[i];
    if (!preset) return;
    sizes[preset] = Math.round(size * S * (preset === "body" ? TEACH : 1));
    if (preset === "body") RAW_BODY.set(sizes, Math.round(size * S));
    lineHeights[preset] = lh;
  });
  return { sizes, lineHeights };
}

const BASE: Theme[] = [
  {
    id: "chalk",
    name: "Chalk & Cream",
    suits: "The default. KS2, and any class with dyslexic readers.",
    tags: ["dyslexia", "low-stimulation"],
    colors: {
      background: "#FAF4E6",
      surface: "#FFFBF0",
      ink: "#2C2A24",
      muted: "#6E6656",
      accent: "#A94A18",
      accent2: "#4A5D8C",
      onAccent: "#FAF4E6",
      line: "#E7DCC4",
      correct: "#2F6B44",
      incorrect: "#A83A2E",
    },
    fonts: { title: FONT_STACKS.lexend, body: FONT_STACKS.lexend },
    ...type([
      [52, 1.1],
      [44, 1.14],
      [30, 1.2],
      [24, 1.55],
      [20, 1.55],
      [14, 1.25],
    ]),
    weights: { title: 600, heading: 600, body: 400 },
    titleTracking: "-0.01em",
    radius: 14,
  },
  {
    id: "playground",
    name: "Playground",
    suits: "Reception and KS1. A sun and a rainbow, star bullets, white cards on butter yellow.",
    tags: ["early-learners"],
    colors: {
      background: "#FFF6DA",
      surface: "#FFFFFF",
      ink: "#2B2118",
      heading: "#6532BE",
      muted: "#66533C",
      // Purple, not a fourth rust: the old Playground was Chalk with a heavier title.
      accent: "#6532BE",
      accent2: "#B93D0B",
      onAccent: "#FFFFFF",
      line: "#F0D27C",
      // White cards on the yellow ground, like stickers on a page.
      panel: "#FFFFFF",
      correct: "#2E7D4F",
      incorrect: "#B8412F",
    },
    fonts: { title: FONT_STACKS.gabarito, body: FONT_STACKS.figtree },
    ...type([
      [56, 1.06],
      [48, 1.1],
      [32, 1.18],
      [26, 1.5],
      [22, 1.5],
      [15, 1.25],
    ]),
    weights: { title: 700, heading: 700, body: 400 },
    titleTracking: "-0.015em",
    radius: 22,
    ornament: { tag: "solid", marker: "star" },
  },
  {
    id: "crayon",
    name: "Crayon Box",
    suits:
      "KS1 and lower KS2. An exercise book: ruled lines, a red margin, handwriting letters, sticky-note cards.",
    tags: ["early-learners"],
    colors: {
      background: "#FFFDF7",
      surface: "#FFFFFF",
      ink: "#232120",
      heading: "#1A52A8",
      muted: "#5C5752",
      accent: "#A31F2E",
      accent2: "#1A52A8",
      onAccent: "#FFFFFF",
      line: "#F5C9CF",
      // A sticky note: the key idea is stuck on the page.
      panel: "#FFF1A6",
      correct: "#2E7D32",
      incorrect: "#B3261E",
    },
    fonts: { title: FONT_STACKS.playpen, body: FONT_STACKS.playpen },
    ...type([
      [50, 1.12],
      [42, 1.14],
      [29, 1.22],
      [24, 1.5],
      [20, 1.5],
      [14, 1.25],
    ]),
    weights: { title: 700, heading: 700, body: 400 },
    titleTracking: "-0.005em",
    radius: 6,
    ornament: { tag: "tint", tagRadius: 4, marker: "dash" },
  },
  {
    id: "splash",
    name: "Splash",
    suits:
      "KS1 and KS2. The seaside: waves along the foot, rising bubbles, diamond bullets; science and topic work.",
    tags: ["early-learners"],
    colors: {
      background: "#EDF8FC",
      surface: "#FFFFFF",
      ink: "#10252F",
      heading: "#0A5CA2",
      muted: "#465F6B",
      accent: "#0A5CA2",
      accent2: "#B8175A",
      onAccent: "#FFFFFF",
      line: "#BFE1F0",
      correct: "#1E7A4C",
      incorrect: "#B3261E",
    },
    fonts: { title: FONT_STACKS.fredoka, body: FONT_STACKS.nunito },
    ...type([
      [56, 1.06],
      [48, 1.1],
      [32, 1.18],
      [26, 1.5],
      [22, 1.5],
      [15, 1.25],
    ]),
    weights: { title: 600, heading: 600, body: 400 },
    titleTracking: "0em",
    radius: 26,
    ornament: { tag: "tint", marker: "diamond" },
  },
  {
    id: "treehouse",
    name: "Treehouse",
    suits:
      "KS2. A storybook: serif headings, a hanging vine, leaf bullets and parchment cards; topic, science, geography.",
    tags: ["early-learners"],
    colors: {
      background: "#F1F7EA",
      surface: "#FFFFFF",
      ink: "#1D291D",
      heading: "#245F28",
      muted: "#4E5E4B",
      accent: "#245F28",
      accent2: "#8A4B12",
      onAccent: "#FFFFFF",
      line: "#CBE0BA",
      // Parchment, the page of the storybook.
      panel: "#FBF5E3",
      correct: "#245F28",
      incorrect: "#B3401F",
    },
    fonts: { title: FONT_STACKS.literata, body: FONT_STACKS.nunito },
    ...type([
      [52, 1.08],
      [44, 1.12],
      [30, 1.18],
      [26, 1.5],
      [22, 1.5],
      [15, 1.25],
    ]),
    weights: { title: 700, heading: 700, body: 400 },
    titleTracking: "-0.01em",
    radius: 10,
    ornament: { tag: "solid", tagRadius: 6, marker: "leaf" },
  },
  {
    id: "reading-room",
    name: "Reading Room",
    suits: "KS3 to KS5 English, history and RE. Serif titles on warm paper.",
    tags: ["low-stimulation"],
    colors: {
      background: "#F4EFE6",
      surface: "#FFFCF6",
      ink: "#22201C",
      muted: "#5F584D",
      // Library green: its own colour, not Exam Hall's navy or Chalk's rust.
      accent: "#2C5A4D",
      accent2: "#7A3B2E",
      onAccent: "#F4EFE6",
      line: "#DDD3C1",
      correct: "#2F6B44",
      incorrect: "#9A3B2E",
    },
    fonts: { title: FONT_STACKS.sourceSerif, body: FONT_STACKS.schibsted },
    ...type([
      [56, 1.04],
      [46, 1.1],
      [30, 1.2],
      [24, 1.45],
      [20, 1.45],
      [14, 1.2],
    ]),
    weights: { title: 600, heading: 600, body: 400 },
    titleTracking: "-0.015em",
    radius: 6,
  },
  {
    id: "studio",
    name: "Studio",
    suits: "KS3 to KS5. Crisp and modern; science, computing, maths.",
    tags: ["low-stimulation"],
    colors: {
      background: "#F7F9FB",
      surface: "#FFFFFF",
      ink: "#0F172A",
      muted: "#4F5D6E",
      accent: "#0B6E86",
      accent2: "#6D35D6",
      onAccent: "#FFFFFF",
      line: "#D9E1EA",
      correct: "#15803D",
      incorrect: "#B91C1C",
    },
    fonts: { title: FONT_STACKS.outfit, body: FONT_STACKS.outfit },
    ...type([
      [54, 1.06],
      [46, 1.1],
      [30, 1.2],
      [25, 1.45],
      [21, 1.45],
      [14, 1.2],
    ]),
    weights: { title: 600, heading: 600, body: 400 },
    titleTracking: "-0.02em",
    radius: 14,
  },
  {
    id: "exam-hall",
    name: "Exam Hall",
    suits: "GCSE and A level. White paper, black ink, navy and a red pen.",
    tags: ["low-stimulation", "adhd"],
    colors: {
      background: "#FFFFFF",
      surface: "#F3F5F8",
      ink: "#111418",
      muted: "#505862",
      accent: "#1B3A8C",
      accent2: "#B42318",
      onAccent: "#FFFFFF",
      line: "#CFD5DD",
      correct: "#1F6B4A",
      incorrect: "#B42318",
    },
    fonts: { title: FONT_STACKS.publicSans, body: FONT_STACKS.publicSans },
    ...type([
      [50, 1.08],
      [42, 1.14],
      [28, 1.22],
      [23, 1.45],
      [20, 1.45],
      [13, 1.2],
    ]),
    weights: { title: 700, heading: 700, body: 400 },
    titleTracking: "-0.01em",
    radius: 4,
  },
  {
    id: "night-lab",
    name: "Night Lab",
    suits: "Dark rooms: science demos, film, blinds down.",
    tags: ["dark", "low-stimulation"],
    dark: true,
    colors: {
      background: "#131519",
      surface: "#1C1F25",
      ink: "#ECEDEF",
      muted: "#99A0AB",
      accent: "#F2B551",
      accent2: "#86C7A8",
      onAccent: "#131519",
      line: "#2C313A",
      correct: "#86C7A8",
      incorrect: "#F08A7A",
    },
    fonts: { title: FONT_STACKS.bricolage, body: FONT_STACKS.instrumentSans },
    ...type([
      [54, 1.06],
      [46, 1.1],
      [30, 1.2],
      [24, 1.5],
      [20, 1.5],
      [14, 1.2],
    ]),
    weights: { title: 700, heading: 700, body: 400 },
    titleTracking: "-0.02em",
    radius: 12,
  },
  {
    id: "beacon",
    name: "Beacon",
    suits: "Bright rooms, low-vision pupils, back of the hall.",
    tags: ["low-vision", "dyslexia"],
    colors: {
      background: "#FFFDF2",
      surface: "#FFFFFF",
      ink: "#0E0E0E",
      muted: "#4A4A46",
      accent: "#0A46C8",
      accent2: "#A31212",
      onAccent: "#FFFDF2",
      line: "#111111",
      correct: "#0B6B3A",
      incorrect: "#A31212",
    },
    fonts: { title: FONT_STACKS.atkinson, body: FONT_STACKS.atkinson },
    ...type([
      [56, 1.08],
      [48, 1.14],
      [32, 1.2],
      [26, 1.55],
      [22, 1.55],
      [15, 1.25],
    ]),
    weights: { title: 700, heading: 700, body: 400 },
    titleTracking: "0em",
    radius: 6,
  },
];

/**
 * One type scale per key stage, read by the diagram drawer (`./diagrams`) so a drawing's labels
 * follow the lesson's reading size:
 *
 *   body       KS1 33, KS2 29, KS3-5 25
 *   bodySmall  one fixed step under body (0.85): diagram labels' floor (UX ruling 91)
 *   heading    the theme's heading stop at the stage; headingDisplay the slide heading (x1.15);
 *              title, subtitle the theme's display stops at the stage; caption the theme's eyebrow
 *              stop at the stage
 *
 * The stage travels with the theme: `atKeyStage(theme, band)` gives a copy of the theme read at
 * that stage, so two jobs at different stages never share state. A catalogue theme has no stage:
 * the themes' own sizes, which is every lesson until the writer planner binds a stage to its themes.
 */
export type KeyStage = "ks1" | "ks2" | "ks3" | "ks4" | "ks5";
type StageScale = { body: number; heading: number; caption: number };
/** Body in slide points (960 wide); display stops multiply the theme's own. */
export const KEY_STAGE_TYPE: Record<KeyStage, StageScale> = {
  ks1: { body: 33, heading: 1.15, caption: 1.1 },
  ks2: { body: 29, heading: 1.1, caption: 1.05 },
  ks3: { body: 25, heading: 1.05, caption: 1 },
  ks4: { body: 25, heading: 1.05, caption: 1 },
  ks5: { body: 25, heading: 1.05, caption: 1 },
};
/** bodySmall = body x this: the one step under body. */
export const BODY_SMALL = 0.85;
/** The slide heading over the theme's heading stop (`look.ts` HEADING_DISPLAY). */
const DISPLAY_HEADING = 1.15;

/** The key stages, as a set: `in` on `KEY_STAGE_TYPE` would also accept "constructor" or "toString". */
const STAGES = new Set<string>(Object.keys(KEY_STAGE_TYPE));
/**
 * The lesson's age bands that are not key stage names (`AgeBandSchema` in `@tj/domain`): sixth form
 * is KS5 and Reception reads at KS1, as the writer lays them out (`stageOf` in `@tj/generation`).
 */
const BAND_STAGE: Readonly<Record<string, KeyStage>> = { post16: "ks5", eyfs: "ks1" };
const asStage = (band: string | undefined | null): KeyStage | undefined => {
  const k = typeof band === "string" ? band.toLowerCase() : "";
  if (STAGES.has(k)) return k as KeyStage;
  return Object.hasOwn(BAND_STAGE, k) ? BAND_STAGE[k] : undefined;
};
/**
 * A theme read at a key stage carries the stage as a real field, so a spread copy downstream
 * (`{ ...theme, colors }`) keeps it.
 */
type StagedTheme = Theme & { keyStage?: KeyStage };
/** The key stage `t` is read at (undefined: the theme's own sizes). */
export const keyStageOf = (t: Theme): KeyStage | undefined => asStage((t as StagedTheme).keyStage);
/**
 * `t` read at `band`'s key stage: a copy that carries the stage, the catalogue theme untouched.
 * An unknown band gives `t` itself (the theme's own sizes).
 */
export function atKeyStage(t: Theme, band: string | undefined | null): Theme {
  const ks = asStage(band);
  if (!ks) return t;
  const staged: StagedTheme = { ...t, keyStage: ks };
  return staged;
}

export type TypeStep =
  | "title"
  | "subtitle"
  | "headingDisplay"
  | "heading"
  | "body"
  | "bodySmall"
  | "caption";
export type TypeScale = Record<TypeStep, number>;

function scaleAt(own: Record<TextPreset, number>, ks: KeyStage): TypeScale {
  const k = KEY_STAGE_TYPE[ks];
  const heading = Math.round(own.heading * k.heading);
  return {
    title: Math.round(own.title * k.heading),
    subtitle: Math.round(own.subtitle * k.heading),
    headingDisplay: Math.round(heading * DISPLAY_HEADING),
    heading,
    body: k.body,
    bodySmall: Math.round(k.body * BODY_SMALL),
    caption: Math.round(own.caption * k.caption),
  };
}

/** THE type scale at `t`'s key stage (`atKeyStage`). Undefined at no stage (the theme's own ladder). */
export function typeScale(t: Theme): TypeScale | undefined {
  const ks = keyStageOf(t);
  return ks ? scaleAt(t.sizes, ks) : undefined;
}

/** Every theme. Its art per slide role is `artOf(theme)` (`art.ts`, UX ruling 107). */
export const THEMES: Theme[] = BASE;

const DISPLAY_BODY: Record<string, number | undefined> = Object.fromEntries(
  BASE.map((t) => [t.id, RAW_BODY.get(t.sizes)]),
);

/**
 * The theme's display body stop, which the teaching cut took off `sizes.body`. It stays a stop of
 * the step-down ladder, so an option card or a question stem still steps one display stop under
 * its floor (UX ruling 91; chalk: an option card 31 → 29), not past it to `small`. At a key stage
 * there is no display body: options read at the stage's body like everything else.
 */
export const displayBodyStop = (theme: Theme): number | undefined =>
  typeScale(theme) ? undefined : DISPLAY_BODY[theme.id];

export { DEFAULT_THEME_ID } from "@tj/domain/documents";

/**
 * A callout's colours (UX ruling 84, TEACH-75): the card's tint, its hairline, the ink its label
 * and text share, and the drawn icon's stroke. One hue per kind, as Chalkie's cards are (rose for
 * a warning, mint for an example, amber for key words), so a deck shows at a glance which card is
 * which.
 */
export type CalloutTone = { fill: string; line: string; ink: string; icon: string };

/** The three tones a theme gives its callouts, one per kind. */
export type CalloutToneSet = Record<CalloutKind, CalloutTone>;

/**
 * The callout tokens, a set per theme keyed by its id. Every kind keeps one family across the ten
 * so a card is recognisable from theme to theme: a warm red for a common mistake (the family of
 * each theme's `incorrect`), a green for an example (its `correct`) and an amber for key words;
 * the theme then sets the temperature and depth of the tint to its own palette. Light themes: a
 * pale tint of the hue with a hairline one step darker and the hue's dark as the ink. Night Lab:
 * a wash of the hue a step up from the ground with the hue's pale as the ink and its own accents
 * as the icons. Beacon: the tints stay pale but the hairline is the icon's full colour, as its
 * other cards are edged in near-black. `themes.test.ts` holds every ink at 7:1 or better on its
 * fill, every icon at 4.5:1 or better, the card's edge off the ground, each kind's hue inside its
 * family on every theme, and Beacon's hairline at 3:1 on both fill and ground, so the card reads
 * from the back of the room on every theme.
 */
export const CALLOUT_TONES: Record<string, CalloutToneSet> = {
  chalk: {
    "watch-out": { fill: "#F7DFD8", line: "#DBA99C", ink: "#5A1D12", icon: "#A83A2E" },
    example: { fill: "#DCEBD8", line: "#A7C7A2", ink: "#1F4A2C", icon: "#2F6B44" },
    "key-words": { fill: "#F7E5B9", line: "#D8B86A", ink: "#4E3604", icon: "#8A5800" },
  },
  playground: {
    "watch-out": { fill: "#FFDFD8", line: "#F0AA9C", ink: "#661A10", icon: "#A6321F" },
    example: { fill: "#DAF3E2", line: "#9BD7B2", ink: "#154D2D", icon: "#256840" },
    "key-words": { fill: "#FFE9B8", line: "#F0C35C", ink: "#553700", icon: "#855000" },
  },
  crayon: {
    "watch-out": { fill: "#FFDCD6", line: "#EFA095", ink: "#621812", icon: "#A31F2E" },
    example: { fill: "#D9F1DD", line: "#97D1A4", ink: "#134A26", icon: "#1F6B35" },
    "key-words": { fill: "#FFEBA8", line: "#EDC04E", ink: "#513500", icon: "#805000" },
  },
  splash: {
    "watch-out": { fill: "#FDE1DC", line: "#EDADA1", ink: "#5E1B12", icon: "#A33424" },
    example: { fill: "#D6F0E4", line: "#94CFB5", ink: "#11452E", icon: "#1B6A47" },
    "key-words": { fill: "#FFEDBE", line: "#EAC25E", ink: "#4F3600", icon: "#7E5600" },
  },
  treehouse: {
    "watch-out": { fill: "#F9DDD5", line: "#DFA597", ink: "#5A1D12", icon: "#A0382A" },
    example: { fill: "#D7EDE8", line: "#9CCBBE", ink: "#124239", icon: "#1E6655" },
    "key-words": { fill: "#F8E6B5", line: "#D9B863", ink: "#4C3605", icon: "#7E5A0A" },
  },
  studio: {
    "watch-out": { fill: "#F8E0DE", line: "#DCA9A5", ink: "#561C19", icon: "#A03A33" },
    example: { fill: "#DAEDE3", line: "#A2CDB6", ink: "#13432C", icon: "#1D6B48" },
    "key-words": { fill: "#F5E7C4", line: "#D5BC78", ink: "#47370C", icon: "#7A580A" },
  },
  "reading-room": {
    "watch-out": { fill: "#EFDCD7", line: "#CDA79E", ink: "#54211A", icon: "#9A3B2E" },
    example: { fill: "#DEE7DA", line: "#ABC0A6", ink: "#23412C", icon: "#2F6B44" },
    "key-words": { fill: "#EEE2C3", line: "#CBB47A", ink: "#48370E", icon: "#7C5810" },
  },
  "exam-hall": {
    "watch-out": { fill: "#F5DFDE", line: "#D6A9A6", ink: "#571C19", icon: "#9A3B2E" },
    example: { fill: "#DCEAE2", line: "#A5C7B4", ink: "#15422C", icon: "#1F6B4A" },
    "key-words": { fill: "#F1E5C6", line: "#CFBA80", ink: "#48370E", icon: "#78580C" },
  },
  "night-lab": {
    "watch-out": { fill: "#3A282D", line: "#5A3F46", ink: "#F8CBC6", icon: "#F08A7A" },
    example: { fill: "#1D3630", line: "#2F5148", ink: "#B0E5CE", icon: "#86C7A8" },
    "key-words": { fill: "#3A3222", line: "#5A4A2C", ink: "#FAD38E", icon: "#F2B551" },
  },
  beacon: {
    "watch-out": { fill: "#FFE1DE", line: "#A31212", ink: "#3D0707", icon: "#A31212" },
    example: { fill: "#DFF3E6", line: "#0B6B3A", ink: "#062E1A", icon: "#0B6B3A" },
    "key-words": { fill: "#FFEDB8", line: "#7A5200", ink: "#3A2600", icon: "#7A5200" },
  },
};

/** A theme's set; a theme the table does not know takes Chalk's, or Night Lab's when it is dark. */
export const calloutTones = (t: Theme): CalloutToneSet =>
  CALLOUT_TONES[t.id] ?? (CALLOUT_TONES[t.dark ? "night-lab" : "chalk"] as CalloutToneSet);

/** The tone a callout of `kind` takes on theme `t`. */
export const calloutTone = (t: Theme, kind: CalloutKind): CalloutTone => calloutTones(t)[kind];

/** True for an id in the catalogue. `getTheme` falls back to the default for anything else. */
export function isThemeId(id: string): boolean {
  return THEMES.some((t) => t.id === id);
}

const BOUND_THEMES = new Map<string, Theme>();
/**
 * The theme `id`; with `ageBand`, read at that key stage (`atKeyStage`), one copy per theme and
 * stage. No band, or one that is not a key stage: the catalogue theme, its own sizes.
 */
export function getTheme(id: string | undefined | null, ageBand?: string | null): Theme {
  const t = THEMES.find((x) => x.id === id) ?? (THEMES[0] as Theme);
  const ks = asStage(ageBand);
  if (!ks) return t;
  const key = `${t.id}@${ks}`;
  let b = BOUND_THEMES.get(key);
  if (!b) {
    b = atKeyStage(t, ks);
    BOUND_THEMES.set(key, b);
  }
  return b;
}

/**
 * The lesson writer's `planned` stamp starts with this (TEACH-110 part b; `WRITER_VERSION` in
 * `@tj/generation`, which a test keeps equal). Only its lessons render at their key stage.
 */
export const WRITER_STAMP_PREFIX = "lesson-writer.";

type StagedLesson = {
  themeId?: string | null;
  ageBand?: string | null;
  generation?: { promptVersions?: { planned?: string } } | null;
};

/**
 * The age band a lesson renders at: its own for a lesson the writer planner wrote, none for every
 * other lesson. Production lessons already carry `ageBand`, so binding it for all of them would
 * restyle every existing deck; the writer's lessons are laid out at their stage and must render so.
 */
export function boundAgeBand(lesson: StagedLesson | null | undefined): string | undefined {
  const planned = lesson?.generation?.promptVersions?.planned;
  return planned?.startsWith(WRITER_STAMP_PREFIX) ? (lesson?.ageBand ?? undefined) : undefined;
}

/**
 * A lesson's theme at its own key stage, ungated: generation and the type-scale audit. Renderers
 * use `renderTheme`, which binds the stage only for writer lessons.
 */
export const lessonTheme = (lesson: { themeId?: string | null; ageBand?: string | null }): Theme =>
  getTheme(lesson.themeId, lesson.ageBand);

/**
 * The theme a lesson renders with (editor, presenter, print, export): `themeId` (default the
 * lesson's; a re-theme's target) at the age band `boundAgeBand` allows, so only writer lessons
 * are bound to their stage.
 */
export const renderTheme = (
  lesson: StagedLesson | null | undefined,
  themeId: string | null | undefined = lesson?.themeId,
): Theme => getTheme(themeId, boundAgeBand(lesson));

/**
 * What a piece of text is doing on the slide. The legibility floor is a property
 * of the role, not of the preset alone: an answer card is an option whichever
 * stop on the ladder it is set in.
 */
export type TextRole = "title" | "question" | "option" | "heading" | "body" | "small" | "caption";

/**
 * Projector minimums in slide points. research/02 decision 6 sets the working
 * minimums for a 3 to 4 metre classroom at 800x450 — title 40, question 32,
 * options 26, body 22 — and this space is that one scaled by 1.2 (SPEC §7).
 *
 * `heading` is the plain slide heading, and it is not a question stem. The stem is the
 * thing a class reads and answers, so it sits on the 38 the research gives a question;
 * a heading over a body block is a label for the reading matter under it and sits on the
 * same 26 as that body copy. Holding every heading at 38 would have pushed four of the
 * six themes above their own heading stop, which is the theme's decision, not ours.
 * `stem()` in layouts.ts therefore asks for the `question` role by name.
 *
 * `small` keeps the flat 24 the six themes were drawn against. It is the footnote
 * and task-instruction stop (`footnote()` in layouts.ts) and it is still readable;
 * raising it would put every theme's smallest reading size above its own ladder.
 * `caption` is the one to four word uppercase eyebrow and is exempt from the
 * reading floor (SPEC §16 amendment), with a floor of its own so the size stepper
 * always has somewhere to stop.
 */
export const MIN_FONT_SIZE: Record<TextRole, number> = {
  title: 48,
  question: 38,
  option: 31,
  heading: 26,
  body: 20,
  small: 24,
  caption: 14,
};

/**
 * The version of the table above. **Bump it whenever a floor in `MIN_FONT_SIZE`
 * changes**, and for nothing else: it is the only signal a stored lesson has that
 * its boxes were laid out against numbers that have since moved.
 *
 * A floor reaches a slide two ways, and both of them move when the table does.
 * `resolveFontSize` (`components/slide/elements/kit.ts`) clamps at render time for
 * the role the renderer can name — its preset for a text box, `option` because
 * `OptionView` passes it — so raising one of those grows the text inside boxes that
 * were positioned under the old number, and an auto-height box grows downward into
 * whatever sits below it. The `question` floor is not a render clamp: a stem is a
 * plain `heading` text with no role marker, so it draws at the heading floor, and the
 * 38 is the number `stem()` reserves box height with in `lib/model/layouts.ts`.
 * Changing it moves every question slide's cards instead of its type. Either way the
 * stored layout is behind: `lib/layout/fit-plan.ts` compares this number with the
 * `fitVersion` the lesson carries, and the editor re-fits the slides the linter flags
 * (`lib/layout/use-fit-migration.ts`).
 *
 * 1 — the sizes the app shipped with.
 * 2 — wave 4, 4 Sept 2026: the per-role projector floors above (SPEC §7).
 * 3 — UX ruling 140, 2 Oct 2026: the teaching body at 0.7 and its floor 26 → 20 (30 px at 1440).
 */
export const FIT_VERSION = 3;

/**
 * Preset to role. The preset names a stop on the theme's ladder; the role names
 * what that stop is used for in front of a class.
 *
 *   title, subtitle -> title     the slide's focal line
 *   heading         -> heading   a label over a block of reading matter
 *   body            -> body      reading matter
 *   small           -> small     footnotes and task instructions
 *   caption         -> caption   eyebrow label, exempt
 *
 * `option` and `question` are the two roles the preset cannot see. An answer card is
 * set in the `small` stop by design (research/04 §4, tighter than body copy) and a
 * question stem in the `heading` stop, so the code that knows which is which passes
 * the role by name: the card lands on the 31pt option floor rather than the 24pt
 * footnote one, and the stem on the 38pt question floor rather than the 26pt heading
 * one.
 */
const PRESET_ROLE: Record<TextPreset, TextRole> = {
  title: "title",
  subtitle: "title",
  heading: "heading",
  body: "body",
  small: "small",
  caption: "caption",
};

export const textRole = (preset: TextPreset, role?: TextRole): TextRole =>
  role ?? PRESET_ROLE[preset];

/** The smallest size this text may render at. */
export const fontFloor = (preset: TextPreset, role?: TextRole): number =>
  MIN_FONT_SIZE[textRole(preset, role)];

export const THEME_TAG_LABELS: Record<Theme["tags"][number], string> = {
  "early-learners": "Early learners",
  "low-stimulation": "Low stimulation",
  dyslexia: "Dyslexia",
  "low-vision": "Low vision",
  adhd: "ADHD",
  dark: "Dark room",
};
