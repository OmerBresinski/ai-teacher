import type { TextPreset, Theme } from "@tj/domain/documents";
import { FONT_STACKS } from "./fonts";

/**
 * Six classroom themes. Colours and type stops come from
 * docs/research/04-visual-direction.md (defined at 800x450) scaled by 1.2 to our
 * 960x540 space. Every ink/muted/accent pair on its background is WCAG AA or better.
 *
 * Preset mapping: title = research "display", subtitle = research "title",
 * heading = research "heading", body/small as is, caption = research "eyebrow".
 */

const S = 1.2;
type Stops = [number, number][]; // [size@800, lineHeight] in order title, subtitle, heading, body, small, caption
const PRESETS: TextPreset[] = ["title", "subtitle", "heading", "body", "small", "caption"];

function type(stops: Stops) {
  const sizes = {} as Record<TextPreset, number>;
  const lineHeights = {} as Record<TextPreset, number>;
  stops.forEach(([size, lh], i) => {
    const preset = PRESETS[i];
    if (!preset) return;
    sizes[preset] = Math.round(size * S);
    lineHeights[preset] = lh;
  });
  return { sizes, lineHeights };
}

export const THEMES: Theme[] = [
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
    suits: "Early years and KS1. Warm, one idea per slide.",
    tags: ["early-learners"],
    colors: {
      background: "#FFF7EF",
      surface: "#FFFFFF",
      ink: "#33261D",
      muted: "#7A6656",
      accent: "#BF4315",
      accent2: "#7048C4",
      onAccent: "#FFF7EF",
      line: "#F0DDCB",
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
    radius: 18,
  },
  {
    id: "reading-room",
    name: "Reading Room",
    suits: "Secondary English, history and RE. Serif titles.",
    tags: ["low-stimulation"],
    colors: {
      background: "#F2EFE8",
      surface: "#FFFFFF",
      ink: "#1F2328",
      muted: "#656C77",
      // Its own blue-grey, not a third rust. Chalk, Playground and Reading
      // Room were three rust cards on three cream grounds in the picker, which
      // read as one theme three times. 6.35:1 on this theme's background.
      accent: "#3C5A6E",
      accent2: "#7A3B2E",
      onAccent: "#F2EFE8",
      line: "#DFDBD1",
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
    radius: 10,
  },
  {
    id: "exam-hall",
    name: "Exam Hall",
    suits: "Exam prep. Dense and neutral, for mark schemes.",
    tags: ["low-stimulation", "adhd"],
    colors: {
      background: "#F6F7F5",
      surface: "#FFFFFF",
      ink: "#16191C",
      muted: "#5C646D",
      accent: "#26418F",
      accent2: "#9A3B2E",
      onAccent: "#F6F7F5",
      line: "#DFE2DE",
      correct: "#1F6B4A",
      incorrect: "#9A3B2E",
    },
    fonts: { title: FONT_STACKS.literata, body: FONT_STACKS.publicSans },
    ...type([
      [50, 1.08],
      [42, 1.14],
      [28, 1.22],
      [23, 1.45],
      [20, 1.45],
      [13, 1.2],
    ]),
    weights: { title: 600, heading: 600, body: 400 },
    titleTracking: "-0.005em",
    radius: 8,
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

export { DEFAULT_THEME_ID } from "@tj/domain/documents";

export function getTheme(id: string | undefined | null): Theme {
  return THEMES.find((t) => t.id === id) ?? (THEMES[0] as Theme);
}

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
  body: 26,
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
 */
export const FIT_VERSION = 2;

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
