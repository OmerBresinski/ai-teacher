import type { Id, Slide, Theme } from "@tj/domain/documents";
import { fitSlide } from "./fit-slide";
import { intersects, rectOf } from "./geometry";
import { isDecorative, lintAsDrawn, renderedHeights } from "./lint";
import { type MaterialiseMeta, materialiseSlide } from "./materialise";
import { ANSWERS_NAME, isBackdrop, isFrozen, isLayerBelow, textPartsOf } from "./reflow";
import type { SlideSpec } from "./specs";
import { measureHeadless } from "./text-measure";
import { ladderStops, resolveFontSize } from "./text-style";
import { getTheme, THEMES } from "./themes";

/*
 * One ruler for planning, the save gate and Tidy (the lesson designer plan, PR 1). A slide is
 * judged the way the editor's first open judges it — `fitSlide` with the headless ruler, then the
 * editor's own linter on the slide as drawn (`lintAsDrawn`) — on every theme, because a teacher
 * can change the look after the lesson is written. `fitsExitTicket` (generation's
 * `planner/coded-slides.ts`) is the pattern: materialise the spec in each theme and measure it.
 *
 * `stepDown` is the headroom rule. Planning asks for 0: the slide fits with every text at its own
 * size, so a run that writes a line longer than planned still has a stop to give. The save gate
 * asks for 1: a stop down (UX ruling 91's one size, once) is allowed, nothing more.
 */

export type StepDown = 0 | 1;

/** What one theme made of a slide. */
export type ThemeFit = {
  theme: string;
  ok: boolean;
  /** Ids past the safe area once fitted (`fitSlide`), or flagged as overflowing by the linter. */
  overflow: Id[];
  /** Overlapping pairs the linter found on the slide as drawn. */
  overlaps: number;
  /** Ids standing in the "Why?" panel's lane. */
  lane: Id[];
  /** Ladder stops the smallest-stepped text sits under its own size. */
  steps: number;
  /** Ids of what the answers reveal covers once it is shown (`answersOverQuestions`). */
  answers: Id[];
};

export type FitsPlannedResult = {
  ok: boolean;
  /** The themes the slide does not fit, with what went wrong. Empty when `ok`. */
  failing: ThemeFit[];
};

export type FitsPlannedOptions = {
  stepDown: StepDown;
  /** Defaults to every theme in the catalogue. */
  themes?: readonly Theme[];
  meta?: MaterialiseMeta;
};

const CHECK_META: MaterialiseMeta = {
  promptVersion: "fit-check",
  model: "code",
  at: "1970-01-01T00:00:00.000Z",
};

/**
 * A slide as generation wrote it: every element carries `authoredBy: "ai"`. The first text edit
 * flips an element to `"teacher"` (`flipToTeacher`), and an element a teacher inserts carries no
 * `authoredBy`, so either makes the slide the teacher's. Tidy formats a generated slide and never
 * adds pages to it (the lesson designer plan, requirement 2): generation saved it fitted.
 */
export function isGeneratedSlide(slide: Slide): boolean {
  return slide.elements.length > 0 && slide.elements.every((el) => el.authoredBy === "ai");
}

/**
 * How many stops of the theme's ladder the most-stepped text on the slide sits under the size it
 * would have with no override (its preset's size, held at the role's projector floor). 0 when
 * every text is at its own size.
 */
export function stepsTaken(slide: Slide, theme: Theme): number {
  const stops = ladderStops(theme);
  let most = 0;
  for (const el of slide.elements) {
    if (isFrozen(el)) continue;
    const parts = textPartsOf(el, slide);
    if (!parts || parts.style?.fontSize === undefined) continue;
    const own = resolveFontSize(theme, parts.preset, undefined, parts.role);
    const set = resolveFontSize(theme, parts.preset, parts.style.fontSize, parts.role);
    const n = stops.filter((s) => s < own - 0.5 && s >= set - 0.5).length;
    most = Math.max(most, n);
  }
  return most;
}

/**
 * What a question slide's answers cover when they are revealed, in any view: every step of the
 * reveal, the slide as drawn (each auto-height box at the height its words need, `measure`). The
 * answers are the reveal panel a set carries (`ANSWERS_NAME`, shown on its reveal step); what they
 * may not cover is anything shown with or before them — the questions, the options, the heading —
 * other than the ground they sit on (a backdrop, a rule, a card that holds them). Empty when the
 * answers keep clear, or the slide has none. Ids in draw order.
 */
export function answersOverQuestions(slide: Slide, theme: Theme): Id[] {
  const drawn = renderedHeights(slide, measureHeadless(theme));
  const out = new Set<Id>();
  for (const panel of drawn.elements) {
    const step = panel.revealStep ?? 0;
    if (panel.name !== ANSWERS_NAME || step <= 0) continue;
    const box = rectOf(panel);
    const inset = {
      x: box.x + 0.5,
      y: box.y + 0.5,
      w: Math.max(0, box.w - 1),
      h: Math.max(0, box.h - 1),
    };
    for (const el of drawn.elements) {
      if (el === panel || (el.revealStep ?? 0) >= step) continue;
      if (isBackdrop(el) || isDecorative(el)) continue;
      const r = rectOf(el);
      // A card the answers are laid on is their ground, not a question.
      if (
        isLayerBelow(el) &&
        r.x <= box.x &&
        r.y <= box.y &&
        r.x + r.w >= box.x + box.w &&
        r.y + r.h >= box.y + box.h
      )
        continue;
      if (intersects(inset, r)) out.add(el.id);
    }
  }
  return drawn.elements.filter((el) => out.has(el.id)).map((el) => el.id);
}

/**
 * A materialised slide judged in one theme: fitted with the headless ruler, then linted as the
 * editor draws it. The slide is taken as it stands (positions from whichever theme laid it out),
 * as the editor takes a lesson after a theme change.
 */
export function slideFits(slide: Slide, theme: Theme, stepDown: StepDown): ThemeFit {
  const fitted = fitSlide(slide, theme);
  const lint = lintAsDrawn(fitted.slide, measureHeadless(theme), theme);
  const overflow = [...new Set([...fitted.overflow, ...lint.overflow])];
  const steps = stepsTaken(fitted.slide, theme);
  const answers = answersOverQuestions(fitted.slide, theme);
  return {
    theme: theme.id,
    ok: overflow.length === 0 && lint.ok && steps <= stepDown && answers.length === 0,
    overflow,
    overlaps: lint.overlaps.length,
    lane: lint.laneOverflow,
    steps,
    answers,
  };
}

/**
 * Does the slide a spec makes fit, on every theme? `materialiseSlide` → `fitSlide` → `lintSlide`
 * per theme, the spec laid out by that theme's own recipe. The slide as materialised (what
 * generation stores) must also lint clean as drawn, so the editor's first open, which lints the
 * stored slide, finds nothing to do.
 */
export function fitsPlanned(spec: SlideSpec, opts: FitsPlannedOptions): FitsPlannedResult {
  const themes = opts.themes ?? THEMES;
  const meta = opts.meta ?? CHECK_META;
  let n = 0;
  const ids = () => `fit${++n}`;
  const failing = themes.flatMap((theme) => {
    const slide = materialiseSlide(spec, theme.id, meta, ids);
    const t = getTheme(theme.id);
    const fit = slideFits(slide, t, opts.stepDown);
    const stored = lintAsDrawn(slide, measureHeadless(t), t);
    const storedAnswers = answersOverQuestions(slide, t);
    if (fit.ok && stored.ok && storedAnswers.length === 0) return [];
    return [
      {
        ...fit,
        ok: false,
        overflow: [...new Set([...fit.overflow, ...stored.overflow])],
        overlaps: Math.max(fit.overlaps, stored.overlaps.length),
        lane: [...new Set([...fit.lane, ...stored.laneOverflow])],
        answers: [...new Set([...fit.answers, ...storedAnswers])],
      },
    ];
  });
  return { ok: failing.length === 0, failing };
}
