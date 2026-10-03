import type { BriefLevel } from "./brief";
import { deriveAgeBand, yearNumberOf } from "./create-lesson";
import type { AgeBand } from "./lesson";

/*
 * Visuality (UX ruling 147, TEACH-169): how visual a lesson is, derived in code from its context
 * (year group, topic, difficulty; `subject` is accepted for the tuning to come), never asked of a model and never shown to the teacher.
 * One level and the settings it implies; every planner reads the same value. The objectives-first
 * outline uses `pictureShare` to decide how many teaching slides carry a photograph or diagram
 * (TEACH-163); plan-write reads the whole setting when it becomes the default planner (TEACH-169).
 * The table is deliberately small and in one place: it is the part most likely to be tuned.
 */

export type VisualityLevel = 1 | 2 | 3 | 4 | 5;

export type Visuality = {
  /** 5 is the most visual (KS1, lower KS2), 1 the least (post-16). */
  level: VisualityLevel;
  /** The share of teaching slides that carry a photograph or diagram, 0–1. */
  pictureShare: number;
  textLoad: "short" | "medium" | "full";
  /** Options a multiple-choice or hinge question offers. */
  options: 3 | 4;
  /** Picture tasks (picture matching, labelling) suit the class. */
  pictureTasks: boolean;
};

export type VisualityContext = {
  ageBand?: AgeBand | undefined;
  /** The year-group label ("Year 8"); read before `ageBand` when it names a year. */
  yearGroup?: string | undefined;
  /** A reading level below the year group ("Year 5" in a Year 8 class) is one step more visual. */
  readingLevel?: string | undefined;
  subject?: string | undefined;
  topic?: string | undefined;
  level?: BriefLevel | undefined;
  /** A level set outright (a later teacher edit prompt); skips the table. */
  override?: VisualityLevel | undefined;
};

/** Base level by year: Years 1–4 highest, post-16 lowest (ruling 147). */
function baseLevel(year: number | undefined, band: AgeBand | undefined): VisualityLevel {
  if (year !== undefined) {
    if (year <= 4) return 5;
    if (year <= 6) return 4;
    if (year <= 9) return 3;
    if (year <= 11) return 2;
    return 1;
  }
  switch (band) {
    case "eyfs":
    case "ks1":
      return 5;
    case "ks2":
      return 4;
    case "ks4":
      return 2;
    case "post16":
      return 1;
    default:
      return 3;
  }
}

/**
 * Topics about abstract terms, symbols or textual analysis: the low end of the level's picture
 * band, whatever the subject.
 */
const ABSTRACT_TOPIC =
  /\b(grammar|punctuation|clauses?|tenses?|persuasi\w*|rhetoric\w*|argument\w*|essays?|analys\w*|algebra\w*|proof|equations?|expressions?|ethics|philosoph\w*)\b/i;

/**
 * Per level: the picture band as a share of teaching slides (VIS147A, 3 Oct 2026, 204 visual
 * judgments over 108 decks: overall visual quality peaks at about 35–50 % pictured and drops past
 * 70 %, where pictures read as decorative), then text load, options and picture tasks. `share` is
 * the default, `low` the band's low end for abstract topics. Science and geography get no step of
 * their own: the judgments found the same band for them.
 */
const SETTINGS: Record<
  VisualityLevel,
  Omit<Visuality, "level" | "pictureShare"> & { share: number; low: number }
> = {
  5: { share: 0.7, low: 0.55, textLoad: "short", options: 3, pictureTasks: true },
  4: { share: 0.6, low: 0.55, textLoad: "short", options: 3, pictureTasks: true },
  3: { share: 0.45, low: 0.35, textLoad: "medium", options: 4, pictureTasks: false },
  2: { share: 0.4, low: 0.3, textLoad: "full", options: 4, pictureTasks: false },
  1: { share: 0.35, low: 0.3, textLoad: "full", options: 4, pictureTasks: false },
};

function clampLevel(n: number): VisualityLevel {
  return Math.min(5, Math.max(1, Math.round(n))) as VisualityLevel;
}

/** The lesson's visuality from its context. Pure; a fresh object per call. */
export function visualityFor(context: VisualityContext): Visuality {
  const year = yearNumberOf(context.yearGroup);
  let level: VisualityLevel;
  if (context.override !== undefined) {
    level = clampLevel(context.override);
  } else {
    const band = context.ageBand ?? deriveAgeBand(context.yearGroup);
    let n: number = baseLevel(year, band);
    const reading = yearNumberOf(context.readingLevel);
    if (
      (reading !== undefined && year !== undefined && reading < year) ||
      context.level === "easier"
    )
      n += 1;
    if (context.level === "harder") n -= 1;
    level = clampLevel(n);
  }
  const { share, low, ...rest } = SETTINGS[level];
  const abstract = ABSTRACT_TOPIC.test(context.topic ?? "");
  const settings: Visuality = { level, pictureShare: abstract ? low : share, ...rest };
  // Ruling 147's floor: Years 1 to 4 get three options, short text and picture tasks.
  if (year !== undefined && year <= 4) {
    return { ...settings, options: 3, textLoad: "short", pictureTasks: true };
  }
  return settings;
}
