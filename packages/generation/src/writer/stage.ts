import { safeErrorWhere } from "@tj/domain";
import type { Slide, Theme } from "@tj/domain/documents";
import { slotBox, slotOf, withBuilds } from "@tj/slides/diagrams";
import { listAnswers, modelBodyRect } from "@tj/slides/templates";
import { getTheme } from "@tj/slides/themes";
import { type DebugKind, recordDebug } from "../debug";
import { BASE_KIND, catalogue, FALLBACK_KIND, libSchema, libSystem } from "../library/catalogue";
import { libraryDiagram } from "../library/fill";
import { pointOf, type SlideForPicture } from "../stages/picture-director";
import {
  ACTIVITIES_DEFAULT,
  activityFaults,
  fromWriterActivity,
  isWriterActivity,
  withActivities,
  withActivityMenu,
} from "./activities";
import { BODY_MODELS } from "./body-figure";
import { type WriterBundleId, writerBundle } from "./bundle";
import { CHECKER_DEFAULTS, type CheckerFlags } from "./checker-flags";
import {
  ANY_POINTING,
  type CheckResult,
  checkSlide,
  duplicateFaults,
  offSlide,
  referentFault,
  slideNoEmDash,
} from "./checks";
import { closedSlides, hasExitLayout, NO_EXIT_LAYOUT, withClose, withCloseLine } from "./close";
import { contractSystem } from "./contract";
import { countMiss } from "./count";
import { writerDrawerSystem } from "./diagram-contract.gen";
import {
  acceptWriterSpec,
  DRAWER_TIMEOUT_MS,
  type DrawerCall,
  drawWriterDiagram,
  layoutSlotProbe,
  QUESTION_TEMPLATES,
  questionSafe,
  withBuildCounts,
} from "./diagrams";
import { type DraftOptions, type SlideDraft, SlideDrafts } from "./draft";
import {
  asPicture,
  asTableText,
  asWords,
  continueForFit,
  pictureFallbackOk,
  tableRows,
  tilesAsPictures,
} from "./fallbacks";
import { figureTextMismatch, specKey, syncFigure } from "./figure-sync";
import {
  FIGURE_SPEC_REPAIR_DEFAULT,
  FIGURE_TEXT_FROM_SPEC_DEFAULT,
  figureTextFix,
} from "./figure-text";
import {
  answerFirst,
  applyRepair,
  asksVisual,
  type Brief,
  charsOver,
  contextBlock,
  fillTemplate,
  fitTable,
  fixedFallback,
  keepAnswerKey,
  keepAsksHonest,
  layoutsFor,
  linkSteps,
  lookOf,
  lostFault,
  OVERFLOW,
  overflowPt,
  plainWords,
  promptStage,
  pupilWordLimit,
  repairTerms,
  roomLine,
  shuffleHinge,
  switchesFor,
  titleOneThing,
  withCorrectLetter,
  withLook,
  withoutHingeKey,
  writerIncomplete,
} from "./fixes";
import { gasFaults, rescaleGas } from "./gas";
import {
  carryPairs,
  judgeRepair,
  POINTING_WORDS,
  repairable,
  sameFigure,
  teaching,
  words as wordsOfText,
} from "./guards";
import { type DraftSizes, layDraft, stableIds } from "./lay-draft";
import { localise } from "./locale";
import { keepLanded, lostPictureFallback, splitLanded } from "./lost-picture";
import {
  codeObjectives,
  codeTitle,
  isStableGroupSlide,
  type Materialised,
  materialise,
  modelPoints,
  type Plan,
  questionsOf,
  stableIdPrefix,
  tileDiagramKeys,
  type VisualAsk,
  type VisualState,
  visualsOf,
  wordsOf,
} from "./materialise";
import {
  type CoverageRules,
  coverage,
  lessonNotes,
  notesOnlyLine,
  notesText,
  renderedLines,
  type SlideNotes,
} from "./notes";
import { PartialJson } from "./partial";
import { asksToSee, heldPhotoFills, orphansAfterFit, pastedPictureList } from "./picture-checks";
import { carryFigures, fitPilot, isPilot, pilotOvers, pilotSlips } from "./pilot-fit";
import {
  offeredLayouts,
  PILOT_PACKS,
  type PilotPack,
  type PilotPackId,
  packRepairMenu,
  packRepairSchema,
  pilotRepairSchema,
  pilotRequest,
  stripStringCaps,
} from "./pilot-pack";
import { pointTaskFault, stripPointTasks } from "./point-guard";
import { continuePractice } from "./practice-split";
import { continueQuickCheck } from "./question-set-split";
import { ROLE_ASK_DEFAULT, ROLE_STAMP_DEFAULT, slideHidesAnswer, slideRoles } from "./role";
import { eachBounded, TAIL_CONCURRENCY } from "./schedule";
import { writerSchema } from "./schema";
import {
  isFatal,
  nonFatal,
  nonFatalSync,
  SMALL_MODEL,
  WRITER_EFFORT,
  WRITER_MODEL,
  type WriterServices,
  whenNonFatal,
  writerMaxTokens,
} from "./services";
import { writerStageOfKey } from "./shown-cap";
import { slideStates } from "./slide-states";
import { slotFillArrival, slotFillSystem, withSlotFill } from "./slot-fill";
import { drawable, renumberSlideRefs, tableDrawn, tableSplitter } from "./table-pack";
import { withWaveCLibrary } from "./wave-c";

/*
 * The lesson writer stage (TEACH-110 part b), ported from the pinned writer's run: one streamed
 * writer call with the teacher's approved objectives as givens, K3 on its output, the seeded
 * hinge shuffle, the flow's `look_at` honoured, code checks on each laid-out slide, objective
 * coverage logged, one bounded fit repair (measure and retry), and one notes call on the final
 * slides as shown.
 *
 * Pictures and diagrams are not made here (parts d and TEACH-251/237 make them): every slot
 * stays an open placeholder unless `visual` says otherwise (the replay hands it the recorded
 * pictures and drawings). The fallbacks for a figure that cannot be shown (restage, reroute) run
 * only once something can fail a figure, so they come with those parts.
 */

type S = Record<string, unknown>;

export class WriterIncompleteError extends Error {
  /** A `length` finish: the same request stops at the same cap, so a retry would only pay twice. */
  readonly deterministic: boolean;
  constructor(readonly why: string) {
    super(`writer output incomplete: ${why}`);
    this.deterministic = why.startsWith("finish_reason length");
    this.name = "WriterIncompleteError";
  }
}

export type WriterRun = {
  brief: Brief;
  /** The approved objectives, teacher wording (the plan screen's). */
  objectives: string[];
  services: WriterServices;
  /** A visual's state; absent: every slot is an open placeholder. */
  visual?: (index: number, key: string, ask: VisualAsk) => VisualState;
  /** The writer's text, recorded (replay); absent: the streamed call. */
  recordedWriter?: { text: string; finishReason?: string | null };
  /** Why a placed picture was vetoed (the reroute call is told); the director's, TEACH-251. */
  vetoed?: (index: number, key: string) => string | undefined;
  /** The writer prompt bundle; absent: the shipped one (`WRITER_BUNDLE_ID`). */
  bundle?: WriterBundleId;
  /**
   * The pilot writer pack (TEACH-110 part s): its menu, schema and layouts replace the bundle's
   * system text and schema, as the real-writer smokes sent them. Absent: the bundle's own.
   */
  pilotPack?: PilotPackId;
  /** The pupil-wording call for slide 2; `false` keeps the teacher's wording (the evidence runs). */
  pupilWording?: boolean;
  /**
   * Draws the writer's diagrams before editable (TEACH-247): its own spec by code, else the drawer
   * call (gpt-6-luna). Absent: every diagram slot stays a placeholder (or `visual`'s state).
   */
  drawDiagrams?: { callDrawer: DrawerCall };
  /**
   * The diagram library (TEACH-247 part h, ADR 0035): the writer sees the shipped models'
   * catalogue and may ask for one; its params are filled on the drawer's call, the model is drawn
   * by code, and a model that cannot be drawn falls back to the drawer. Needs `drawDiagrams`.
   */
  library?: boolean;
  /**
   * Library turn-on, step 1 (diagrams-06; default off): a drawn model takes the slide body under
   * the heading and above its lead (`modelBodyRect`, up to 900 x 424; the slide's own line is
   * never dropped), and a model whose smallest words would show there under the 18 pt floor falls
   * back to the drawer.
   */
  libraryModelBody?: boolean;
  /**
   * Library turn-on, step 2 (diagrams-07; default off): a model's optional panels (lib-meta
   * `optionalPanels`, the heart's pulse first) are off unless the writer's intent names them.
   */
  libraryPanelsOff?: boolean;
  /**
   * Library turn-on, step 3 (diagrams-09; default off): a drawn model whose words print over one
   * another (read back from the still) falls back to the drawer.
   */
  libraryLabelOverlap?: boolean;
  /**
   * Library turn-on, label floor (default off; with `libraryModelBody`): a model's type grows until
   * its smallest words show at 18 pt where the slide places it; then the overlap check runs, and
   * words that collide or leave the model fall back to the drawer.
   */
  libraryLabelFloor?: boolean;
  /**
   * What the post-write checks do (TEACH-312 part i, Greg 10 Oct). "act" (default): today's
   * repair round, relayout, figure checks, strips and library fallbacks. "log": every check is
   * still computed and logged ("checks", "repair-skipped" per slide), but nothing acts on a
   * result: no repair call, revert, check-driven relayout, rewrite, strip or visual drop, and a
   * library model or writer spec falls back only when it cannot be drawn at all. Answer hiding
   * (roleAsk), text fit sizing and a visual that genuinely fails to load or draw still act, and so
   * does the split of a slide whose text or a card runs off the slide (Greg 70 B, 20 Oct).
   */
  checks?: "act" | "log";
  /**
   * Library turn-on, step 4 (CROSSCHECK point 1; default off): the writer's model menu and the
   * schema's model enum hold only models for the lesson's year and its subject (or general
   * ones); an empty list leaves out the Models block, the model kind line and the schema branch.
   */
  libraryMenuFilter?: boolean;
  /**
   * Library turn-on, step 5 (default off; with `libraryMenuFilter`): the kept models are ordered
   * by a deterministic word match of their teaches line against the lesson's objectives. Never
   * drops a model, only reorders.
   */
  libraryMenuRank?: boolean;
  /**
   * The activity layouts (TEACH-101 part c): the menu in the system text and the five families in
   * the schema. Absent: `ACTIVITIES_DEFAULT` (on).
   */
  activities?: boolean;
  /**
   * Tile visuals (TEACH-75 part d): compare cards and sequence stages may be drawn, and a hinge
   * takes a figure. Absent: `TILE_VISUALS_DEFAULT` (off, master's schema byte for byte).
   */
  tileVisuals?: boolean;
  /**
   * Typed callouts (TEACH-75 part e, ruling 203): a support point may be `{kind, text}`. Absent:
   * `CALLOUTS_DEFAULT` (off, master's schema byte for byte).
   */
  callouts?: boolean;
  /**
   * Slot-fill (slot-fill.ts): layout first, then fill the slots. Each slide def splits into one
   * def per measured way of filling it, named by the slide's `fit` field, with `maxLength` caps;
   * the menu's `Fits:` lines become word budgets generated from those caps. Absent: the bundle's
   * `features.slotFill` (base4g on), else off (schema unchanged).
   */
  slotFill?: boolean;
  /**
   * Cards grid (ruling 203, P3): the menu offers a grid of 2-4 icon cards. Absent:
   * `CARDS_GRID_DEFAULT` (off, master's schema byte for byte).
   */
  cardsGrid?: boolean;
  /**
   * Banner text (ruling 203, P4): the menu offers a picture strip over or under the words. Absent:
   * `BANNER_TEXT_DEFAULT` (off, master's schema byte for byte).
   */
  bannerText?: boolean;
  /**
   * Full-bleed hook (ruling 203, P5): the menu offers a photo hook under a dark scrim. Absent:
   * `HOOK_DEFAULT` (off, master's schema byte for byte).
   */
  hook?: boolean;
  /** A diagram's alt and shows rewritten from its spec when they disagree (figure-text.ts). */
  figureTextFromSpec?: boolean;
  /** A diagram spec that cannot be drawn (16 in 10 groups) corrected from its words. */
  figureSpecRepair?: boolean;
  /**
   * roleStamp (the slide-role contract, step 1): each written slide's role (role.ts) is worked out
   * once the writer's slides are all open and logged (`slide-role`). Nothing reads it yet. Absent:
   * `ROLE_STAMP_DEFAULT` (on).
   */
  roleStamp?: boolean;
  /**
   * roleAsk (the slide-role contract, step 2): a diagram or library model keeps its answer back
   * when the slide's role asks (role.ts `slideHidesAnswer`; a discussion hides nothing), not only
   * on the question templates. Absent: `ROLE_ASK_DEFAULT` (on).
   */
  roleAsk?: boolean;
  /**
   * lostPic (BAKEOFF base4f): place more photo asks after editable (a lost compound picture asked
   * again one subject each) and wait for them; absent, the asks read `visual` as they are.
   */
  placeMore?: (index: number, asks: VisualAsk[], slide: SlideForPicture) => Promise<void>;
  /** keepPic: a photo match6 dropped from an ask slide, for a slide that ends with no visual. */
  held?: (index: number, key: string) => VisualState | undefined;
  /**
   * The diagram kind the picture director chose to draw a failed photo ask as (its `code` route):
   * lostPic draws it with the drawer first, then asks the picture again (which then keeps the
   * picture route). Absent: no director drawing.
   */
  drawAs?: (index: number, key: string) => string | undefined;
  /** The failed photo ask may land if placed again (it ran out of time or its placement failed). */
  retryable?: (index: number, key: string) => boolean;
  /** False when this key was already asked again this round (the director re-asks a key once). */
  canReask?: (index: number, key: string) => boolean;
  /**
   * A slide as soon as it is laid out while the deck is still being made (TEACH-110 part h, C2):
   * each slide the writer's stream closes, and again when its diagram is drawn. Read-only: the
   * editable deck (`onEditable`) supersedes every one of them.
   */
  onSlide?: (index: number, slide: WriterSlide) => void;
  /**
   * Live writing P4 (TEACH-202 part c): the slide the stream is writing, before it closes. The
   * first draft of a slide comes as soon as its template closes, then its fields as they grow (an
   * open string cut where the stream is), at most one per `draft.ms` (default 200). Read-only and
   * best effort: drafts never feed the final parse, the laid slides, the checks or the costs, a
   * throwing callback only stops the drafts, and the slide's `onSlide` supersedes them.
   */
  onDraft?: (index: number, draft: SlideDraft) => void;
  /** The drafts' throttle and clock (tests pass a fake clock). */
  draft?: DraftOptions;
  /**
   * Live writing P6 (TEACH-202 part f, ADR 0039): each draft laid out (`layDraft`), as the slide it
   * will be (id `s<index + 1>`) with its words so far and open placeholders for its visuals. First
   * on the template's close, then as the words grow; type only steps down. Same contract as
   * `onDraft`: read-only, best effort, superseded by the slide's `onSlide`. Not for the objectives
   * slide (1), which code lays.
   */
  onDraftSlide?: (index: number, slide: WriterSlide) => void;
  /**
   * Live writing (ADR 0039): the writer's `flow` as soon as it closes in the stream (before any
   * slide): every slide it will write, in order. Best effort; a throw is logged and ignored.
   */
  onFlow?: (flow: Plan["flow"]) => void;
  /** Live writing: each `flow` entry as soon as it closes in the stream (the flow is long). */
  onFlowItem?: (item: NonNullable<Plan["flow"]>[number]) => void;
  /**
   * Live writing P2 (TEACH-202 part e): hands the caller a function to call when a picture lands
   * while the deck is still read-only. The slide is laid again and handed over (`onSlide`) at
   * once, so the picture shows as soon as it is placed rather than when the deck turns editable.
   * A slide not open (or opened again) is skipped: its old pictures were forgotten.
   */
  bindPictureLanded?: (landed: (index: number) => void) => void;
  /**
   * The final parse opened a slide again from other bytes than the stream did: its earlier asks
   * are void (the caller cancels their pictures); its asks follow through `onAsks`.
   */
  onReopen?: (index: number) => void;
  /** Aborted when the lesson fails: no diagram job starts another call after it. */
  signal?: AbortSignal;
  /**
   * The writer's `design` as soon as it is known: when it closes in the stream (before any slide),
   * else at the final parse, before the first slide opens.
   */
  onDesign?: (design: Plan["design"]) => void;
  /** Called as soon as every slide is laid out (the editable deck), before repair and notes. */
  onEditable?: (slides: WriterSlide[]) => Promise<void> | void;
  /**
   * A slide's visuals as soon as it is parsed, with the words a picture is chosen for (TEACH-251:
   * the picture director starts placing them off the writing clock).
   */
  onAsks?: (
    index: number,
    asks: VisualAsk[],
    slide: { heading: string; text: string; point: string },
  ) => void;
  /**
   * Awaited before the editable deck is laid out (TEACH-251: the pictures settle). Every slide is
   * laid out again afterwards, so no slot is left an open placeholder.
   */
  beforeEditable?: () => Promise<void>;
  /** The checker's flags (`checker-flags.ts`) over `CHECKER_DEFAULTS`; `false` turns one off. */
  checker?: CheckerFlags;
};
export type WriterSlide = Pick<Slide, "kind" | "elements" | "background" | "question"> & {
  id: string;
  notes: string;
};
export type WriterOutput = {
  slides: WriterSlide[];
  /** The writer's slides as finally shown (title and objectives first), for the record. */
  plan: Plan;
  checks: CheckResult[];
  title: string;
  writer: { usd: number; ms: number; firstTokenMs?: number; finishReason?: string | null };
  summary: { textOnlyTeach: number; dangling: { slide: number; fault: string }[] };
  /**
   * Slides whose text or a card still runs off the slide as shipped (no continuation split fits):
   * the deck slide's id and its off-slide faults, for the saved findings (Greg 71 A: a block past
   * its room but on the slide is not reported). Each is also logged as `overflow-shipped`.
   */
  overflow: { slide: number; id: string; faults: string[] }[];
};

/**
 * The writer's system text for the brief's stage: the pinned text with the contract lines that
 * come from the drawer's schema and the exact slide count (contract.ts), nothing appended.
 */
export function writerSystem(brief: Brief, P = writerBundle()): string {
  const k = promptStage(brief.keyStage);
  return contractSystem(k === "KS1" ? P.systemKS1 : k === "KS2" ? P.systemKS2 : P.systemKS3_5);
}

/**
 * A continuation slide's speaker notes (Greg 70 B): the slide's own notes stay on its first part,
 * and the parts after it say where they come from.
 */
export const CONTINUED_NOTE = "Continued from the previous slide: the same content, split to fit.";

/** The pupil-wording call's deadline: it runs beside the writer, so it is never the wait. */
export const PUPIL_WORDING_DEADLINE_MS = 8_000;

export async function runWriter(run: WriterRun): Promise<WriterOutput> {
  /** The checks act on their results ("act", the default) or are only logged (part i). */
  const act = run.checks !== "log";
  /**
   * A check found something to act on: logs it (with `applied: false` when the checks only log)
   * and says whether to act. Every check-driven change in this stage goes through here.
   */
  const actOn = (e: Record<string, unknown>): boolean => {
    log(act ? e : { ...e, applied: false });
    return act;
  };
  const { brief } = run;
  const P = writerBundle(run.bundle);
  // The pinned repair schema without the hinge's counted `correct`: code finds the key by the
  // answer's words (`keepAnswerKey`), so the model is not asked to count (ANSWER-BUG.md).
  const repairSchemaFor = (k: string) =>
    withoutHingeKey(
      JSON.parse(
        k === "KS1" ? P.repairSchemaKS1 : k === "KS2" ? P.repairSchemaKS2 : P.repairSchemaKS3_5,
      ),
    );
  // The repair's layouts menu. On a pilot pack (production), the pack's own layout lines, so a
  // repair offers only what the writer is offered (ruling 218: never the retired compare).
  // Otherwise the one the lab's repair calls sent (BAKEOFF prompts/T, heading room in characters),
  // not the arm's menu the system text was built from (TEACH-110 part f).
  const layoutsMenu = (k: string) =>
    pilot
      ? packRepairMenu(pilot.system, offeredLayouts(schema))
      : k === "KS1"
        ? P.repairLayoutsKS1
        : k === "KS2"
          ? P.repairLayoutsKS2
          : P.repairLayoutsKS3_5;
  /**
   * The repair's schema when a call names none. On a pilot pack, `slide` is one of the layouts its
   * menu shows (`layoutsFor`: the slide's own and those it may switch to) that the writer is
   * offered, defined as the writer's schema defines it; a slide whose layouts the writer is not
   * offered at all (stored JSON) may take any offered layout but an activity, as base4f-p123's
   * repair could. Else the bundle's repair schema. An uncapped pack strips the envelope's caps
   * too: a capped repair cuts its own fix.
   */
  const generalRepairSchema = (k: string, own: string) => {
    let r = repairSchemaFor(k);
    if (pilot) {
      const offered = offeredLayouts(schema);
      const shown = switchesFor(own, true).filter((l) => offered.includes(l));
      r = packRepairSchema(
        r,
        schema,
        shown.length ? shown : offered.filter((l) => !isWriterActivity(l)),
      );
    }
    return run.pilotPack && (PILOT_PACKS[run.pilotPack] as PilotPack).uncapped
      ? stripStringCaps(r)
      : r;
  };
  const baseVisuals = (k: string) =>
    k === "KS1" ? P.baseVisualsKS1 : k === "KS2" ? P.baseVisualsKS2 : P.baseVisualsKS3_5;

  /** The lesson's debug record (`../debug`): fire and forget, never awaited, never throws. */
  const debug = (kind: DebugKind, payload: unknown, slideIndex?: number) =>
    recordDebug(run.services.debug, kind, payload, slideIndex);
  /**
   * One per-slide fact check in the debug record (full verbosity, Greg 20 Oct): the claim, the
   * verdict and reason, whether it applied or was dropped, and the slide's words before and after.
   */
  const factCheck = (
    slideIndex: number,
    p: Record<string, unknown> & { before?: unknown; after?: unknown },
  ) => {
    if (!run.services.debug) return;
    const { before, after, ...rest } = p;
    debug(
      "fact-check",
      {
        model: "code",
        usd: 0,
        ...rest,
        ...(before !== undefined ? { beforeText: wordsOf(before as S), before } : {}),
        ...(after !== undefined ? { afterText: wordsOf(after as S), after } : {}),
      },
      slideIndex,
    );
  };
  const log = (e: object) => {
    run.services.log(e);
    // Every stage event also lands in the debug record, on its slide when it names one (1-based).
    if (run.services.debug) {
      const slide = (e as { slide?: unknown }).slide;
      debug("event", e, typeof slide === "number" && slide >= 1 ? slide - 1 : undefined);
    }
  };
  // Every model call's texts go through the locale step (`{{locale.country}}` in notes.txt).
  const chat: WriterServices["chat"] = (r) =>
    run.services.chat({ ...r, system: localise(r.system), user: localise(r.user) });
  const themeId = brief.teacherTheme ?? brief.theme;
  const base: { brief: Brief; theme: Theme; stage: Brief["keyStage"] } = {
    brief,
    theme: getTheme(themeId, brief.keyStage),
    stage: brief.keyStage,
  };
  const plan: Plan = {
    slides: [],
    // Slide 2 is laid from the approved objectives; pupil wording falls back to the teacher's.
    objectives: run.objectives.map((t) => ({ teacher: t, pupil: t })),
  };
  const asks = new Map<number, VisualAsk[]>();
  const laid = new Map<number, Materialised>();
  /** fallbackOnlyOnFailure: slides laid out full width to fit their drawn diagram (points to notes). */
  // Held by the slide object itself: a later step that swaps the slide out clears it, and a
  // restore that puts the relaid slide back brings it back.
  const relaid = new Map<number, unknown>();
  /** noTableText: a table that could not be shown, as note lines, held by the slide object as `relaid` is. */
  const tableNotes = new Map<number, { slide: unknown; lines: string[] }>();
  const notes = new Map<number, { notes: string; answers: string[] }>();
  /** A repaired slide keeps the visual of a figure it still asks for, under its new key. */
  const carried = new Map<string, { key: string; ask: VisualAsk }>();
  /** Diagrams drawn in this run, by `<slide>:<key>` (TEACH-247). */
  const drawnDiagrams = new Map<string, VisualState>();
  /** States code decided after the fact (match6 kept photo, orphan6, a stale drawing), by key. */
  const override = new Map<string, VisualState>();
  /** `restore` puts a slide's override and drawn states back as they were when it was swapped. */
  const states = slideStates<VisualState>([override, drawnDiagrams]);
  const visualState = (i: number) => (key: string) => {
    const o = override.get(`${i}:${key}`);
    if (o) return o;
    const was = carried.get(`${i}:${key}`);
    const drawn = drawnDiagrams.get(`${i}:${was?.key ?? key}`);
    if (drawn) return drawn;
    if (was)
      return run.visual ? run.visual(i, was.key, was.ask) : ({ status: "pending" } as VisualState);
    const a = (asks.get(i) ?? []).find((x) => x.key === key);
    return a && run.visual ? run.visual(i, key, a) : ({ status: "pending" } as VisualState);
  };
  // Slides whose diagram ships with warnings (no room drew it cleanly): every later relay keeps it.
  const warned = new Set<number>();
  const relay = (i: number, diagramWarnings = warned.has(i)) => {
    const s = plan.slides[i];
    if (!s) return;
    const lay = () =>
      materialise(s, {
        ...base,
        index: i,
        plan,
        visual: visualState(i),
        ...(diagramWarnings ? { diagramWarnings } : {}),
      });
    // A drawn diagram carries its builds (Present shows its parts one per Next).
    // Live writing (ADR 0039): the laid slide keeps its drafts' ids (`stableIds`), so nothing
    // remounts when it takes over from its last draft, nor when a later relay lands a picture.
    // A pilot layout group already has them (`stableIdPrefix`), bound to its fields: kept as is,
    // or the editor finds no items to add, delete or split (TEACH-110 part w).
    const keep = (x: Materialised): Materialised =>
      run.onDraftSlide && !isStableGroupSlide(x.slide, i)
        ? { ...x, slide: stableIds(x.slide, `s${i + 1}`) }
        : x;
    if (!run.drawDiagrams) return void laid.set(i, keep(lay()));
    const m = withBuilds(lay);
    laid.set(i, keep({ ...m, slide: withBuildCounts(m.slide) }));
  };
  /**
   * LAYOUT-SEL Egypt s1: a title picture that failed is searched once more for the lesson's topic
   * itself (not the cut-down phrase `titleOneThing` chose). Whatever then is not a placed photo is
   * failed for good, so the title is laid out with no picture slot, never a placeholder.
   */
  const retryTitle = async () => {
    const s0 = plan.slides[0] as S | undefined;
    const ask = (asks.get(0) ?? []).find(
      (a): a is Extract<VisualAsk, { type: "photo" }> => a.type === "photo",
    );
    if (!s0 || !ask) return;
    const topic = brief.topic.trim();
    const failed = visualState(0)(ask.key).status === "failed";
    // The director re-asks a key once per round; a title already re-asked is laid out without.
    if (failed && run.canReask && !run.canReask(0, ask.key))
      log({ ev: "title-retry", slide: 1, ok: false, skipped: "already-reasked" });
    else if (failed && run.placeMore && topic) {
      // Ruling 210: the topic is asked afresh, never as the failed ask's `named`; the director
      // decides from the topic whether it is a specific real thing (real only, else no picture)
      // or anything else (searched, then generated when the search misses).
      const again = { ...ask, shows: topic, mustSee: [topic], named: false };
      asks.set(
        0,
        (asks.get(0) ?? []).map((a) => (a === ask ? again : a)),
      );
      const pic = s0[ask.key] as S | undefined;
      if (pic) plan.slides[0] = { ...s0, [ask.key]: { ...pic, shows: topic, must_see: [topic] } };
      await run.placeMore(0, [again], {
        heading: String(s0.heading ?? ""),
        text: wordsOf(s0),
        point: pointOf(s0),
      });
      log({
        ev: "title-retry",
        slide: 1,
        shows: topic,
        named: again.named,
        ok: visualState(0)(ask.key).status === "photo",
      });
    }
    for (const a of asks.get(0) ?? [])
      if (a.type === "photo" && visualState(0)(a.key).status !== "photo")
        override.set(`0:${a.key}`, { status: "failed" });
  };
  const title = codeTitle(brief, base);
  laid.set(0, title);
  laid.set(1, codeObjectives({ ...base, index: 1, plan }));

  // ── pupil wording: one small call, started with the writer (the objectives are confirmed), so
  // slide 2 is laid once, before editable, and never changes after. A failed or late call keeps
  // the teacher's wording; a budget or abort error still stops the lesson, when it is awaited. ──
  const pupilJob: Promise<{ lines: unknown[] } | { fatal: unknown }> =
    run.pupilWording === false
      ? Promise.resolve({ lines: [] })
      : chat({
          model: SMALL_MODEL,
          effort: "low",
          system: P.pupilObjectives,
          user: fillTemplate(P.pupilObjectivesUser, brief, {
            objectives: plan.objectives ?? [],
            maxWords: pupilWordLimit(brief.keyStage, (plan.objectives ?? []).length),
          }),
          schema: JSON.parse(P.pupilObjectivesSchema),
          name: "pupil_objectives",
          maxTokens: 1500,
          timeoutMs: PUPIL_WORDING_DEADLINE_MS,
        }).then(
          (r) => ({ lines: (r.out as { pupil?: unknown[] } | undefined)?.pupil ?? [] }),
          (e: unknown) => {
            if (isFatal(e)) return { fatal: e };
            log({ ev: "pupil-objectives-error", err: String(e).slice(0, 200) });
            return { lines: [] };
          },
        );

  // ── the writer call ──
  const user = withCloseLine(
    contextBlock(
      brief,
      run.objectives.map((t) => ({ teacher: t, pupil: "" })),
      P.user,
    ),
    brief.exitTicketOnSlides,
  );
  const stageKey = promptStage(brief.keyStage);
  // The library's catalogue goes after base4's diagram kinds, in the system text and the schema.
  // A library that fails to load is no library: the writer runs with base4's kinds only.
  const models =
    run.library && run.drawDiagrams
      ? await nonFatal(
          () =>
            catalogue(
              stageKey,
              run.libraryMenuFilter
                ? {
                    yearGroup: brief.yearGroup,
                    subject: brief.subject,
                    ...(run.libraryMenuRank ? { objectives: run.objectives } : {}),
                  }
                : undefined,
            ),
          (e) => {
            log({ ev: "lib-catalogue-failed", err: String(e).slice(0, 200) });
            return [];
          },
        )
      : [];
  const activities = run.activities ?? ACTIVITIES_DEFAULT;
  const libbed = libSchema(
    writerSchema(stageKey, brief.slides, P, {
      objectives: run.objectives.length,
      ...(run.tileVisuals !== undefined ? { tileVisuals: run.tileVisuals } : {}),
      ...(run.callouts !== undefined ? { callouts: run.callouts } : {}),
      ...(run.cardsGrid !== undefined ? { cardsGrid: run.cardsGrid } : {}),
      ...(run.bannerText !== undefined ? { bannerText: run.bannerText } : {}),
      ...(run.hook !== undefined ? { hook: run.hook } : {}),
    }),
    models.map((m) => m.id),
  );
  const pilot = run.pilotPack
    ? pilotRequest(run.pilotPack, stageKey, libbed, (sc) =>
        libSchema(
          sc,
          models.map((m) => m.id),
        ),
      )
    : undefined;
  const unsplit = pilot ? pilot.schema : activities ? withActivities(libbed, stageKey) : libbed;
  // A pack's base schema is already split per fit (`template~fit`): arrival strips `fit`, and the
  // system text already carries its Fits lines.
  const slotFill = pilot
    ? Object.keys(pilot.schema.$defs ?? {}).some((k) => k.includes("~"))
    : (run.slotFill ?? P.features?.slotFill ?? false);
  // The lesson's last slide is its own required field (TEACH-110 part ab): the exit ticket, or the
  // closing slide that sends the class to the worksheet's.
  const closable = slotFill && !pilot ? withSlotFill(unsplit, stageKey) : unsplit;
  if (brief.exitTicketOnSlides && !hasExitLayout(closable))
    throw new WriterIncompleteError(NO_EXIT_LAYOUT);
  const schema = withClose(closable, brief.exitTicketOnSlides);
  const libbedSystem = libSystem(pilot ? pilot.system : writerSystem(brief, P), models);
  // Wave C (TEACH-110 part v): a model may go to figure-slide or step-model, as their lines say.
  const waveC = !!(run.pilotPack && (PILOT_PACKS[run.pilotPack] as PilotPack).waveC);
  const system0 = waveC ? withWaveCLibrary(libbedSystem, writerStageOfKey(stageKey)) : libbedSystem;
  const system = slotFill && !pilot ? slotFillSystem(system0, schema, stageKey) : system0;
  const roleAsk = run.roleAsk ?? ROLE_ASK_DEFAULT;
  /** The slide asks pupils, so its drawing keeps the answer back: by role (roleAsk) or template. */
  const asksPupils = (s: S) =>
    roleAsk ? slideHidesAnswer(s) : QUESTION_TEMPLATES.has(String(s.template ?? ""));
  /** A diagram ask as the drawer reads it, sized to the slide's slot. */
  const diagramAsk = (a: Extract<VisualAsk, { type: "diagram" }>, s: S) => {
    const slot = slotOf(String(s.template ?? ""));
    const box = slotBox(base.stage, slot);
    return {
      key: a.key,
      kind: a.kind,
      shows: a.shows,
      labels: a.labels,
      ...(a.spec !== undefined ? { spec: a.spec } : {}),
      words: wordsOf(s),
      yearGroup: brief.yearGroup,
      stage: base.stage,
      slot: {
        placement: slot === "full" ? ("across the slide" as const) : ("beside text" as const),
        w: box.w,
        h: box.h,
        name: slot,
      },
      question: asksPupils(s),
    };
  };
  /** One slide as the deck shows it (no continuation slides), or undefined before it is laid. */
  const slideAt = (i: number): WriterSlide | undefined => {
    const m = laid.get(i) ?? (i === 0 ? title : undefined);
    if (!m) return undefined;
    const own = notes.get(i)?.notes ?? "";
    const moved = modelPoints(plan.slides[i] as S | undefined).filter((p) => p && !own.includes(p));
    const fitted =
      relaid.has(i) && relaid.get(i) === plan.slides[i]
        ? relaidPoints(plan.slides[i] as S | undefined).filter((p) => p && !own.includes(p))
        : [];
    const tn = tableNotes.get(i);
    const table = tn && tn.slide === plan.slides[i] ? tn.lines : [];
    const said = [
      moved.length ? `On the slide: ${moved.join(" ")}` : "",
      fitted.length ? `Moved off the slide to fit the diagram: ${fitted.join(" ")}` : "",
      table.length ? `The table could not be shown on the slide:\n${table.join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    const q = m.slide.question ?? listQuestion(plan.slides[i] as S | undefined, notes.get(i));
    return {
      id: `s${i + 1}`,
      ...m.slide,
      ...(q ? { question: q } : {}),
      notes: [own, said].filter(Boolean).join("\n\n"),
    };
  };
  /** True once the editable deck is out: no more read-only slides are handed over. */
  let editable = false;
  const shown = (i: number) => {
    if (editable || !run.onSlide) return;
    const slide = slideAt(i);
    if (slide) run.onSlide(i, slide);
  };
  /** Diagram jobs (TEACH-247, R2), started as each slide opens (C10) and awaited before editable. */
  const diagramJobs = new Map<string, Promise<void>>();
  /** Each slide's diagram jobs' stops, so a reopened slide cancels its old jobs. */
  const diagramStops = new Map<number, AbortController[]>();
  let jobSeq = 0;
  /** Cancels a slide's diagram jobs and forgets what they drew. */
  const cancelDiagrams = (i: number) => {
    for (const c of diagramStops.get(i) ?? []) c.abort();
    diagramStops.delete(i);
    for (const k of [...diagramJobs.keys()]) if (k.startsWith(`${i}:`)) diagramJobs.delete(k);
    for (const k of [...drawnDiagrams.keys()]) if (k.startsWith(`${i}:`)) drawnDiagrams.delete(k);
  };
  const drawDiagramsOf = (i: number) => {
    if (!run.drawDiagrams) return;
    const drawer = run.drawDiagrams.callDrawer;
    for (const a of asks.get(i) ?? []) {
      const s = plan.slides[i];
      if (a.type !== "diagram" || !s) continue;
      const slot = slotOf(String(s.template ?? ""));
      const box = slotBox(base.stage, slot);
      const question = asksPupils(s);
      const stop = new AbortController();
      diagramStops.set(i, [...(diagramStops.get(i) ?? []), stop]);
      /** Cancelled (its slide reopened) or the lesson failed: nothing more is drawn or kept. */
      const cancelled = () => stop.signal.aborted || run.signal?.aborted === true;
      const callDrawer: DrawerCall = (req) =>
        cancelled() ? Promise.reject(new Error("diagram job cancelled")) : drawer(req);
      /**
       * A library model drawn by code into this slot: true when it drew, else the model's drawer
       * kind (undefined once cancelled).
       */
      const libDraw = async (
        want: { model: string; intent: string; alt?: string },
        body = false,
      ): Promise<true | string | undefined> => {
        const r = await libraryDiagram(
          {
            key: a.key,
            model: want.model,
            intent: want.intent,
            alt: want.alt,
            words: wordsOf(s),
            heading: typeof s.heading === "string" ? s.heading : "",
            caption: typeof s.lead === "string" ? s.lead : "",
            yearGroup: brief.yearGroup,
            lesson: [brief.subject, brief.topic].filter(Boolean).join(": "),
            question,
            // Its words are set and measured in the theme's label face, as the slide's are.
            font: base.theme.fonts.body,
            // The drawing is measured where the slide puts it: under the heading, above the lead.
            ...(run.libraryModelBody
              ? {
                  place: modelBodyRect(
                    typeof s.heading === "string" ? s.heading : "",
                    typeof s.lead === "string" ? s.lead : undefined,
                    base.theme,
                    base.stage as never,
                  ),
                }
              : {}),
            ...(run.libraryPanelsOff ? { panelsOff: true } : {}),
            ...(run.libraryLabelOverlap ? { labelOverlap: true } : {}),
            ...(run.libraryLabelFloor ? { labelFloor: true } : {}),
            ...(act ? {} : { logOnly: true }),
          },
          async (req) =>
            (
              await callDrawer({
                model: "gpt-6-luna",
                effort: "low",
                ...req,
                name: "diagram",
                strict: false,
                timeoutMs: DRAWER_TIMEOUT_MS,
              })
            ).out,
          (e) => log({ ...e, slide: i + 1 }),
        );
        if (cancelled()) return undefined;
        if (r.ok) {
          const { src, aspect, alt } = r.drawing;
          drawnDiagrams.set(`${i}:${a.key}`, {
            status: "diagram",
            spec: {
              drawn: {
                src,
                aspect,
                alt,
                bare: true,
                ...(run.libraryModelBody ? { body: true } : {}),
                source: r.source,
              },
            },
          });
          log({
            ev: "diagram-done",
            slide: i + 1,
            key: a.key,
            via: "library",
            ok: true,
            ...(body ? { body: true } : {}),
          });
          relay(i);
          shown(i);
          return true;
        }
        return r.ok ? true : r.fallbackKind;
      };
      const job = nonFatal(
        async () => {
          // A library model: filled and drawn by code; one that cannot be falls back to the drawer.
          if (a.kind !== "model") return a;
          const want = (a.spec ?? {}) as { model?: unknown; intent?: unknown; alt?: unknown };
          // Library models are full slides only (ADR 0035): a side-slot ask from an old or
          // replayed output is today's drawer's, for the model's base kind.
          if (slot !== "full") {
            const kind = BASE_KIND[String(want.model ?? "")] ?? FALLBACK_KIND;
            log({ ev: "lib-side-slot", slide: i + 1, model: want.model, kind });
            return { ...a, kind, labels: [], spec: undefined };
          }
          if (modelPoints(s).length)
            log({ ev: "lib-points-to-notes", slide: i + 1, model: want.model });
          const drew = await libDraw({
            model: String(want.model ?? ""),
            intent: String(want.intent ?? a.shows),
            alt: typeof want.alt === "string" ? want.alt : undefined,
          });
          if (drew === undefined || drew === true) return undefined;
          return { ...a, kind: drew, labels: [], spec: undefined };
        },
        // A throw anywhere in the library path is the drawer's job, never a rejected batch.
        (e) => {
          log({ ev: "lib-failed", slide: i + 1, key: a.key, err: String(e).slice(0, 200) });
          return a.kind === "model"
            ? { ...a, kind: FALLBACK_KIND, labels: [], spec: undefined }
            : a;
        },
      ).then((a2) => {
        if (!a2 || cancelled()) return;
        return drawWriterDiagram(
          {
            key: a2.key,
            kind: a2.kind,
            shows: a2.shows,
            labels: a2.labels,
            ...(a2.spec !== undefined ? { spec: a2.spec } : {}),
            words: wordsOf(s),
            yearGroup: brief.yearGroup,
            stage: base.stage,
            slot: {
              placement: slot === "full" ? "across the slide" : "beside text",
              w: box.w,
              h: box.h,
              name: slot,
            },
            question,
          },
          {
            callDrawer,
            drawerSystem: writerDrawerSystem,
            fitActs: act,
            theme: base.theme,
            probe: layoutSlotProbe,
            log: (e) => log({ ...e, slide: i + 1 }),
          },
        ).then(async (r) => {
          if (cancelled()) return;
          // TEACH-247 part ad: a living body is never drawn from shapes. A full slide takes the
          // lesson's library model for a body when its fill draws; otherwise the figure fails and
          // the fallback ladder places a picture of the same thing.
          if (r.body) {
            for (const model of slot === "full" ? BODY_MODELS : []) {
              if (!models.some((m) => m.id === model)) continue;
              const drew = await libDraw({ model, intent: a2.shows }, true);
              if (drew === undefined) return;
              if (drew === true) return;
            }
            log({ ev: "body-figure", slide: i + 1, key: a.key, to: "picture" });
          }
          drawnDiagrams.set(
            `${i}:${a.key}`,
            r.spec ? { status: "diagram", spec: r.spec } : { status: "failed" },
          );
          log({ ev: "diagram-done", slide: i + 1, key: a.key, via: r.via, ok: !!r.spec });
          relay(i);
          shown(i);
        });
      });
      // Awaited below (a fatal error still stops the lesson there); a stream that fails K3 first
      // must not leave the job's rejection unhandled.
      void Promise.allSettled([job]);
      diagramJobs.set(`${i}:${a.key}:${++jobSeq}`, job);
    }
  };
  /** Each slide's raw JSON as it was opened, by index. */
  const opened = new Map<number, string>();
  run.bindPictureLanded?.((i) => {
    if (editable || !opened.has(i)) return;
    relay(i);
    shown(i);
  });
  /**
   * One written slide's work: no em dash, the activity's fields, the seeded hinge, the flow's
   * look, its asks (`onAsks` starts its pictures), its layout and its diagrams. Run as each slide
   * closes in the writer's stream (C1), in slide order, and at the end for any slide the stream
   * did not open: the final parse stays the source of truth.
   */
  /**
   * Ruling 197: a table longer than its slot holds packs into 4 columns and continues on the next
   * slide; one that fits as written is left alone. Run on every slide the stage opens or rewrites
   * (`tableSplitter` keeps or drops the continuations).
   */
  const tables = tableSplitter((idx) => (sl, first, asWritten) => {
    const t = sl.figure as S;
    // The slot check the writer's spec meets when it is drawn (the slide's own part only).
    const probe = (at: "side" | "full") =>
      !layoutSlotProbe(drawable(t), at, base.stage, base.theme).length;
    // As written, `sl` is the slide itself (its own slot); a first part, its template's slot.
    if (asWritten) return probe(slotOf(String(sl.template ?? "")));
    if (first && !probe(slotOf(String(sl.template ?? "")))) return false;
    const m = materialise(sl, {
      ...base,
      index: idx,
      plan,
      visual: () => ({ status: "diagram", spec: drawable(t) }),
    });
    return tableDrawn(sl, first, m);
  });
  const tableRest = tables.rest;
  const splitTable = (idx: number, s: S): S => {
    const r = tables.split(idx, s);
    if (r.rest) {
      log({ ev: "table-continued", slide: idx + 1, slides: r.rest.length + 1 });
      debug("split", { how: "table-continued", before: s, first: r.slide, rest: r.rest }, idx);
    }
    return r.slide;
  };
  /**
   * TEACH-101 part g: a quick check past its maximum continues on more quick-check slides;
   * TEACH-230 part b: practice past its maximum continues on more practice slides, the same way.
   */
  const quickRest = new Map<number, S[]>();
  const splitQuick = (idx: number, s: S): S => {
    const fits = (sl: S) =>
      !materialise(sl, { ...base, index: idx, plan, visual: () => ({ status: "pending" }) }).over
        .length;
    const qc = continueQuickCheck(s, fits) ?? continuePractice(s, fits);
    if (!qc) {
      quickRest.delete(idx);
      return s;
    }
    quickRest.set(idx, qc.rest);
    log({
      ev: s.template === "practice" ? "practice-continued" : "quick-check-continued",
      slide: idx + 1,
      slides: qc.rest.length + 1,
    });
    debug(
      "split",
      {
        how: s.template === "practice" ? "practice-continued" : "quick-check-continued",
        before: s,
        first: qc.first,
        rest: qc.rest,
      },
      idx,
    );
    return qc.first;
  };
  const openSlide = (idx: number, arrived: S) => {
    // Slot-fill: check the slide against its variant, strip `fit`; a breach, a cut field or an
    // overflow is logged as the writer's fault and the slide is kept as written.
    let raw = arrived;
    if (slotFill) {
      const a = slotFillArrival(arrived, stageKey, schema, pilot?.caps, !!pilot);
      raw = a.slide;
      log({
        ev: "slot-fill",
        slide: idx + 1,
        template: raw.template,
        fit: a.fit ?? null,
        route: a.route,
        ...(a.breaches.length ? { breaches: a.breaches.slice(0, 6) } : {}),
        ...(a.cuts.length ? { cut: true, cuts: a.cuts } : {}),
        ...(a.over.length ? { over: a.over } : {}),
        ...(a.fields.length ? { fields: a.fields } : {}),
      });
    }
    // No em dashes on slides. The writer's answer is its first option or card (key 1).
    let s = answerFirst(slideNoEmDash(raw));
    const figOpts = {
      fromSpec: run.figureTextFromSpec ?? FIGURE_TEXT_FROM_SPEC_DEFAULT,
      specRepair: run.figureSpecRepair ?? FIGURE_SPEC_REPAIR_DEFAULT,
    };
    if (figOpts.fromSpec || figOpts.specRepair) {
      const f = figureTextFix(s, figOpts);
      let apply = act;
      for (const c of f.changes)
        apply = actOn({
          ev: "figure-text",
          slide: idx + 1,
          key: c.key,
          kind: c.kind,
          action: c.action,
        });
      if (apply) s = f.slide as S;
    }
    // An activity: the writer's fields to the template's, repaired to the stage's capacity.
    if (isWriterActivity(s.template)) {
      const a = fromWriterActivity(s, stageKey, brief);
      if (a.converted) log({ ev: "activity-dropped", slide: idx + 1, why: a.converted });
      else if (a.fixes.length) log({ ev: "activity-fixed", slide: idx + 1, fixes: a.fixes });
      s = a.slide;
    }
    s = splitTable(idx, s);
    s = splitQuick(idx, s);
    // Pack v4.5 asks for the hinge's correct option first (`correct` 1): any other value means the
    // writer ignored the order rule, so its key is suspect (build/HINGE-ANSWER.md). Logged only.
    if (
      run.pilotPack &&
      run.pilotPack !== "v4.4" &&
      s.template === "hinge" &&
      Number(s.correct) !== 1
    )
      log({ ev: "hinge-first-unmet", slide: idx + 1, correct: s.correct ?? null });
    // The hinge's correct option lands at a seeded, uniform position.
    s = shuffleHinge(s, `${brief.id}:${idx}:${String(s.stem ?? s.heading ?? "")}`);
    // The flow's look is the writer's visual decision: a slide whose look names a picture but
    // which asks for none gets the picture from look's phrase.
    const look = lookOf(plan.flow?.find((x) => x.slide === idx + 1));
    const added = withLook(s, look);
    if (added.how) {
      log({ ev: "look-added", slide: idx + 1, how: added.how });
      s = added.slide;
      // A pilot layout draws its own visual (icons, medals, side pictures): its look is met.
    } else if (look && look.kind !== "none" && !asksVisual(s) && !isPilot(s))
      log({ ev: "look-unmet", slide: idx + 1, kind: look.kind });
    const one = titleOneThing(s);
    if (one.how) {
      log({
        ev: "title-one-thing",
        slide: idx + 1,
        shows: (one.slide.picture as { shows: string }).shows,
      });
      s = one.slide;
    }
    plan.slides[idx] = s;
    asks.set(idx, visualsOf(s, idx, { ...base, plan }));
    run.onAsks?.(idx, asks.get(idx) ?? [], {
      heading: String(s.heading ?? ""),
      text: wordsOf(s as S),
      point: pointOf(s as S),
    });
    relay(idx);
    // Keyed by the slide as the writer wrote it, which the final parse compares: under slot-fill
    // `raw` has lost its `fit`, so keying by it reopened every slide (HEART1 R3: each slide's
    // diagrams redrawn and pictures asked for twice, about $0.12 extra, editable 30 s later).
    opened.set(idx, JSON.stringify(arrived));
    drawDiagramsOf(idx);
    shown(idx);
  };

  // ── the stream (C1): `design` and `flow` close first (the schema's order), then the title and
  // each slide in order; a slide opens as it closes. Anything out of that order stops the stream
  // opening slides, and the final parse opens the rest. ──
  let streaming = !run.recordedWriter;
  let designShown = false;
  /** The next index the stream may open: the title (0), then 2, 3, … */
  let nextOpen = 0;
  const stopStream = (why: string, e?: unknown) => {
    if (!streaming) return;
    streaming = false;
    log({ ev: "stream-stopped", why, ...(e ? { err: String(e).slice(0, 200) } : {}) });
  };
  const parser = new PartialJson((path, value) => {
    // Live writing (ADR 0039): each flow entry as it closes, before the flow does.
    if (streaming && path.length === 2 && path[0] === "flow" && run.onFlowItem) {
      const item = value as NonNullable<Plan["flow"]>[number];
      nonFatalSync(
        () => run.onFlowItem?.(item),
        (e) => log({ ev: "on-flow-item-failed", err: String(e).slice(0, 200) }),
      );
      return;
    }
    if (!streaming || path.length !== (path[0] === "slides" ? 2 : 1)) return;
    const [key, k] = path;
    if (key === "design") {
      plan.design = value as Plan["design"];
      designShown = true;
      run.onDesign?.(plan.design);
      return;
    }
    if (key === "flow") {
      plan.flow = value as Plan["flow"];
      // Live writing (ADR 0039): the deck's slide count is known; the caller may show them all.
      nonFatalSync(
        () => run.onFlow?.(plan.flow),
        (e) => log({ ev: "on-flow-failed", err: String(e).slice(0, 200) }),
      );
      return;
    }
    // `close` (TEACH-110 part ab) opens as the slide after the last of `slides`.
    const idx =
      key === "title"
        ? 0
        : key === "slides" && typeof k === "number"
          ? k + 2
          : key === "close" && nextOpen >= 2
            ? nextOpen
            : -1;
    if (idx < 0) return;
    if (!plan.flow || idx !== nextOpen || !value || typeof value !== "object")
      return stopStream(`slide ${idx + 1} out of order`);
    const ok = nonFatalSync(
      () => {
        openSlide(idx, value as S);
        return true;
      },
      (e) => {
        opened.delete(idx);
        stopStream(`slide ${idx + 1} failed to open`, e);
        return false;
      },
    );
    if (ok) nextOpen = idx === 0 ? 2 : idx + 1;
  });
  // Live writing P4: the open slide's drafts, peeked after each delta (never on a recorded run).
  const draftSizes = new Map<number, DraftSizes>();
  const onDraftSlide = run.onDraftSlide;
  const onDraft =
    run.onDraft || onDraftSlide
      ? (idx: number, d: SlideDraft) => {
          run.onDraft?.(idx, d);
          // The objectives slide is laid by code (never written); a slide already open is done.
          if (!onDraftSlide || idx === 1 || opened.has(idx)) return;
          const sizes = draftSizes.get(idx) ?? new Map();
          draftSizes.set(idx, sizes);
          const m = layDraft(d, { ...base, index: idx, plan }, sizes, stageKey);
          if (m) onDraftSlide(idx, { id: `s${idx + 1}`, ...m, notes: "" });
        }
      : undefined;
  let drafts = onDraft && streaming ? new SlideDrafts(onDraft, run.draft) : undefined;
  const draftStats = drafts?.stats;
  const main = run.recordedWriter
    ? { usd: 0, ms: 0, ...run.recordedWriter }
    : await run.services.writer(
        {
          model: WRITER_MODEL,
          effort: WRITER_EFFORT,
          system:
            activities && !pilot ? withActivityMenu(system, stageKey, P.activityMenu) : system,
          user: localise(user),
          schema,
          name: "lesson",
          maxTokens: writerMaxTokens(brief.slides.max),
        },
        (delta) => {
          if (!streaming) return;
          nonFatalSync(
            () => parser.push(delta),
            (e) => stopStream("parser failed", e),
          );
          if (!drafts || !streaming) return;
          nonFatalSync(
            () => drafts?.update(parser),
            (e) => {
              drafts = undefined;
              log({ ev: "drafts-stopped", err: String(e).slice(0, 200) });
            },
          );
        },
      );
  // The writer's raw output, as streamed (the debug record only; ADR 0015 keeps it out of logs).
  debug("writer-output", {
    text: main.text,
    finishReason: main.finishReason ?? null,
    usd: main.usd,
    ms: main.ms,
    ...(main.firstTokenMs !== undefined ? { firstTokenMs: main.firstTokenMs } : {}),
    ...(run.recordedWriter ? { recorded: true } : {}),
  });
  if (draftStats)
    log({
      ev: "drafts",
      n: draftStats.drafts,
      peeks: draftStats.peeks,
      ms: +draftStats.ms.toFixed(2),
    });
  // K3: an incomplete writer output fails the job; it never ships a headings-only deck.
  const incomplete = writerIncomplete({
    finishReason: main.finishReason ?? null,
    text: main.text,
    minSlides: brief.slides.min,
  });
  if (incomplete) {
    log({ ev: "main-incomplete", why: incomplete, chars: main.text.length });
    throw new WriterIncompleteError(incomplete);
  }
  const out = JSON.parse(main.text) as {
    design?: Plan["design"];
    flow?: Plan["flow"];
    title?: S;
    slides?: S[];
    close?: S | null;
  };
  // Every lesson ends with its check: `close` goes back at the end, and a lesson whose exit ticket
  // belongs on the slides and has none fails here, before anything is laid or stored.
  const closed = closedSlides(out, brief.exitTicketOnSlides);
  if (closed.missing) {
    log({ ev: "exit-ticket-missing", level: "error", slides: closed.slides.length });
    throw new WriterIncompleteError(closed.missing);
  }
  if (closed.note) log({ ev: "close-missing", level: "warn", why: closed.note });
  out.slides = closed.slides;
  // The teacher's exact count (ADR 0036): a miss ships as written, logged for measuring.
  const miss =
    brief.slides.min === brief.slides.max
      ? countMiss(out.slides?.length ?? 0, brief.slides.max)
      : undefined;
  if (miss) log({ ev: "count-miss", level: "warn", ...miss });
  plan.design = out.design;
  plan.flow = out.flow;
  if (!designShown) run.onDesign?.(plan.design);
  const written: [number, S][] = [
    ...(out.title ? ([[0, out.title]] as [number, S][]) : []),
    ...(out.slides ?? []).map((s, k): [number, S] => [k + 2, s]),
  ];
  if (opened.size) log({ ev: "stream-opened", slides: opened.size, of: written.length });
  for (const [idx, raw] of written) {
    const was = opened.get(idx);
    if (was === JSON.stringify(raw)) continue;
    if (was !== undefined) {
      // Its asks and diagrams were started from other words: cancelled, then started afresh.
      log({ ev: "stream-reopened", slide: idx + 1 });
      cancelDiagrams(idx);
      run.onReopen?.(idx);
    }
    openSlide(idx, raw);
  }
  // ── roleStamp: each written slide's role, logged only (no consumer reads it yet) ──
  if (run.roleStamp ?? ROLE_STAMP_DEFAULT)
    for (const [i, role] of slideRoles(plan.slides as (S | undefined)[]))
      log({
        ev: "slide-role",
        slide: i + 1,
        template: String(plan.slides[i]?.template ?? ""),
        role,
      });
  // ── diagrams (TEACH-247, R2): every diagram asked for, drawn before editable ──
  await Promise.all(diagramJobs.values());
  const n = plan.slides.length;
  const flags = { ...CHECKER_DEFAULTS, ...run.checker };
  const coverageRules: CoverageRules = {
    pictureTasks: flags.coverageCountsPictureTasks,
    noDiscussion: flags.coverageExcludesDiscussion,
    afterTeaching: flags.coverageExcludesPrediction,
  };
  /** Continuation slides laid after slide i (a last-resort strip's overflowing items). */
  const continued = new Map<number, Materialised[]>();
  /** Each continuation slide's own slide JSON, for its answers (a split question list). */
  const continuedFrom = new Map<number, S[]>();
  /**
   * Continuation k of slide i as shown: a split question list's part keeps its own questions'
   * answers, in order, after those of the slide and the parts before it.
   */
  const continuedSlide = (i: number, k: number, c: Materialised) => {
    const parts = continuedFrom.get(i) ?? [];
    const qs = (x: S | undefined) => (Array.isArray(x?.questions) ? x.questions.length : 0);
    const before = qs(plan.slides[i] as S) + parts.slice(0, k).reduce((t, p) => t + qs(p), 0);
    const answers = notes.get(i)?.answers;
    const q = answers ? listQuestion(parts[k], { answers: answers.slice(before) }) : undefined;
    return { ...c.slide, ...(q ? { question: q } : {}) };
  };
  const deck = (): WriterSlide[] => {
    const slides: WriterSlide[] = [];
    /** Plan slide number (1-based) to its number in the deck, once continuations sit between. */
    const at = new Map<number, number>();
    for (let i = 0; i < Math.max(n, 2); i++) {
      const own = slideAt(i);
      if (!own) continue;
      slides.push(own);
      at.set(i + 1, slides.length);
      for (const [k, c] of (continued.get(i) ?? []).entries())
        slides.push({
          id: `s${i + 1}c${k + 1}`,
          ...continuedSlide(i, k, c),
          notes: CONTINUED_NOTE,
        });
      for (const [k, q] of (quickRest.get(i) ?? []).entries()) {
        const m = materialise(q, {
          ...base,
          index: i,
          plan,
          visual: () => ({ status: "pending" }),
        });
        const tag = q.template === "practice" ? "p" : "q";
        slides.push({ id: `s${i + 1}${tag}${k + 1}`, ...m.slide, notes: "" });
      }
      for (const [k, t] of (tableRest.get(i) ?? []).entries()) {
        const m = materialise(t, {
          ...base,
          index: i,
          plan,
          visual: () => ({ status: "diagram", spec: drawable(t.figure as S) }),
        });
        slides.push({ id: `s${i + 1}t${k + 1}`, ...withBuildCounts(m.slide), notes: "" });
      }
    }
    // A continuation moves the slides after it: "slide 7" in notes or on a slide follows them.
    return renumberSlideRefs(slides, at);
  };
  if (run.beforeEditable) {
    await run.beforeEditable();
    await retryTitle();
    // The settled pictures (or their absence) replace the open slots.
    for (const [i, a] of asks) if (a.some((x) => x.type === "photo")) relay(i);
  }
  // Slide 2 with the pupil wording, before editable; any line missing keeps the teacher's.
  const pupil = await pupilJob;
  if ("fatal" in pupil) throw pupil.fatal;
  if (pupil.lines.length) {
    (plan.objectives ?? []).forEach((o, k) => {
      const line = pupil.lines[k];
      if (typeof line === "string" && line.trim()) o.pupil = line.trim();
    });
    laid.set(1, codeObjectives({ ...base, index: 1, plan }));
  }
  editable = true;
  await run.onEditable?.(deck());

  // ── notes off the tail: one call on the deck as shown now, beside the repairs ──
  // The notes need each slide's final words and placed visuals, not the repairs. So the one call
  // starts here, and a slide whose words or visuals change afterwards gets its note written again
  // once that slide settles (below). Nothing waits for the notes until the very end.
  const placedLines = (i: number) =>
    (asks.get(i) ?? []).flatMap((a) => {
      const v = visualState(i)(a.key);
      if (v?.status === "photo") return [`Picture: ${v.photo.alt || a.shows}`];
      if (v?.status === "diagram" && a.type === "diagram")
        return [`Diagram (${a.kind}): ${(a.labels ?? []).join(", ")}`];
      return [];
    });
  const asShown = (i: number) =>
    renderedLines(i + 1, (laid.get(i)?.slide.elements ?? []) as never, placedLines(i));
  const notesCall = (only?: number) => {
    const lines = Array.from({ length: n }, (_, i) => i)
      .filter((i) => i >= 2)
      .map(asShown)
      .join("\n\n");
    const call = lessonNotes({
      slides: only ?? n,
      first: only ?? 3,
      system: P.notes,
      user:
        fillTemplate(P.notesUser, brief, {
          objectives: plan.objectives,
          context: user,
          slidesAsShown: lines,
        }) + (only ? `\n\n${notesOnlyLine([only])}` : ""),
      schema: JSON.parse(P.notesSchema),
      chat,
      log,
      onUsd: () => {},
    });
    // Awaited at the end; a fatal error (a budget stop) is rethrown there, never unhandled.
    void Promise.allSettled([call]);
    return call;
  };
  /** Each slide as the deck-wide notes call saw it. */
  const seenByNotes = new Map(Array.from({ length: n }, (_, i) => [i, asShown(i)] as const));
  const deckNotes = notesCall();
  /** Notes written again for a slide that changed after the deck-wide call saw it. */
  const notesRedone = new Map<number, Promise<Map<number, SlideNotes>>>();

  // ── code checks ──
  const baseCheck = () =>
    Array.from({ length: n }, (_, i) =>
      checkSlide({
        specs: (asks.get(i) ?? []).flatMap((a) => {
          const v = visualState(i)(a.key) as { status?: string; spec?: unknown };
          return a.type === "diagram" && v?.status === "diagram" && v.spec ? [v.spec] : [];
        }),
        index: i,
        slide: laid.get(i)?.slide,
        over: laid.get(i)?.over ?? [],
        ...(laid.get(i)?.diagram ? { diagram: laid.get(i)?.diagram } : {}),
        questions: plan.slides[i] ? questionsOf(plan.slides[i] as S) : [],
        answers: notes.get(i)?.answers,
        notesChecked: notes.has(i),
        words: plan.slides[i] ? wordsOf(plan.slides[i] as S) : "",
      }),
    );
  /**
   * The deck the parallel tail judges a slide against: every other slide as it was when the phase
   * started, so one repair's verdict never depends on another repair still in flight.
   */
  let frozen: { slides: readonly unknown[]; own: number } | undefined;
  const deckSlide = (i: number) =>
    (frozen && i !== frozen.own ? frozen.slides[i] : plan.slides[i]) as S;
  const duplicates = () =>
    duplicateFaults(
      Array.from({ length: n }, (_, i) => i)
        .filter((i) => repairable(deckSlide(i), i))
        .map((i) => {
          const sl = deckSlide(i);
          return { index: i, heading: String(sl.heading ?? ""), words: wordsOf(sl) };
        }),
    );
  const check = () => {
    const res = baseCheck();
    // A slide that repeats another goes to repair to be made different or merged
    // (duplicateLogOnly: it is logged once below and never repaired).
    if (!flags.duplicateLogOnly) for (const [i, f] of duplicates()) res[i]?.faults.push(f);
    for (let i = 0; i < n; i++)
      res[i]?.faults.push(...activityFaults(plan.slides[i] as S, laid.get(i)?.slide));
    // gas8 (BAKEOFF base4f): practical data the lesson's own stated quantities cannot give.
    for (const h of gasFaults(gasTexts()))
      if (repairable(plan.slides[h.slide] as S, h.slide)) res[h.slide]?.faults.push(h.fault);
    return res;
  };
  const gasTexts = () =>
    Array.from({ length: n }, (_, i) => (deckSlide(i) ? wordsOf(deckSlide(i)) : ""));
  let checks = check();
  log({ ev: "checks", failing: checks.filter((c) => c.faults.length).length });
  // Each slide's check in the debug record: the fault lines and the measured overflows (which
  // element, by how much), failing or not.
  if (run.services.debug)
    for (const c of checks)
      debug("check", { faults: c.faults, over: laid.get(c.slide - 1)?.over ?? [] }, c.slide - 1);
  if (flags.duplicateLogOnly)
    for (const [i, f] of duplicates()) log({ ev: "duplicate-seen", slide: i + 1, fault: f });

  /** Slide i's continuation parts dropped: they belong to the version of it being replaced. */
  const dropContinued = (i: number) => {
    continued.delete(i);
    continuedFrom.delete(i);
  };
  /** Slide i's text and cards past the slide's edge, as laid now. */
  const offSlideAt = (i: number) => offSlide(laid.get(i)?.slide.elements ?? []);
  const swapSlide = (i: number, next0: S) => {
    dropContinued(i);
    states.save(i, plan.slides[i]);
    // figureSync (BAKEOFF base4f, chalkie-gap Y5-B): a figure on a rewritten slide is re-checked
    // against the new words; kept when it agrees, redrawn from the words when it can be, dropped
    // otherwise.
    const syncT0 = performance.now();
    const sync = syncFigure(plan.slides[i] as S | undefined, slideNoEmDash(next0));
    const syncMs = +(performance.now() - syncT0).toFixed(2);
    const synced =
      sync.action === "redrawn" || sync.action === "drop"
        ? actOn({ ev: "figure-sync", slide: i + 1, action: sync.action, why: sync.why })
        : true;
    // The figure fact check (code, no model) in the debug record, per slide, with what it changed.
    if (run.services.debug && sync.action !== "none")
      factCheck(i, {
        checker: "figure-sync",
        claim: "the slide's figure agrees with its words",
        verdict: sync.action,
        ...("why" in sync && sync.why ? { reason: sync.why } : {}),
        applied: synced,
        ...(synced ? {} : { dropped: "dry run (act off)" }),
        before: plan.slides[i],
        after: synced ? sync.slide : next0,
        ms: syncMs,
      });
    const next = splitTable(
      i,
      !synced
        ? slideNoEmDash(next0)
        : sync.action === "drop"
          ? asWords(sync.slide as S)
          : (sync.slide as S),
    );
    const oldAsks = asks.get(i) ?? [];
    const oldCarried = new Map(oldAsks.map((a) => [a.key, carried.get(`${i}:${a.key}`)]));
    const oldState = new Map(oldAsks.map((a) => [a.key, visualState(i)(a.key)]));
    plan.slides[i] = next;
    const newAsks = visualsOf(next, i, { ...base, plan });
    asks.set(i, newAsks);
    // Pictures carry by slot first, then one-to-one by request (layout-01).
    const pairs = carryPairs(
      oldAsks,
      newAsks,
      (b, a) =>
        sameFigure({ type: b.type, shows: b.shows }, { type: a.type, shows: a.shows }) &&
        // the same request is not the same drawing: a spec that changed is drawn again
        (b.type !== "diagram" ||
          a.type !== "diagram" ||
          specKey((b as { spec?: unknown }).spec) === specKey((a as { spec?: unknown }).spec)),
    );
    for (const a of newAsks) {
      const was = pairs.get(a.key);
      // a drawing whose numbers the new words no longer say is never carried
      const v0 = was ? oldState.get(was.key) : undefined;
      const stale0 = v0?.status === "diagram" ? figureTextMismatch(v0.spec, next as S) : undefined;
      const stale =
        stale0 && actOn({ ev: "figure-stale", slide: i + 1, key: a.key, why: stale0 })
          ? stale0
          : undefined;
      if (was && !stale) {
        if (was.key !== a.key)
          carried.set(`${i}:${a.key}`, oldCarried.get(was.key) ?? { key: was.key, ask: was });
        continue;
      }
      carried.delete(`${i}:${a.key}`);
      override.delete(`${i}:${a.key}`);
      drawnDiagrams.delete(`${i}:${a.key}`);
      // A new or changed writer spec is drawn by code at once (no drawer call after editable).
      if (a.type === "diagram" && a.spec !== undefined && run.drawDiagrams) {
        const ask = diagramAsk(a, next);
        const r = acceptWriterSpec(a.spec, ask, base.theme, layoutSlotProbe, {
          fitActs: act,
          log: (e) => log({ ...e, slide: i + 1 }),
        });
        if (r.spec)
          drawnDiagrams.set(`${i}:${a.key}`, {
            status: "diagram",
            spec: ask.question ? questionSafe(r.spec) : r.spec,
          });
        log({
          ev: r.spec ? "r2-spec-redrawn" : "r2-spec-refault",
          slide: i + 1,
          key: a.key,
          late: true,
        });
      } else if (a.type === "diagram" && stale) {
        override.set(`${i}:${a.key}`, { status: "failed" });
      }
    }
    relay(i);
  };
  // ── one bounded repair: failing slides only, one call each ──
  // Dangling and unanswerable are reported, never a repair trigger: the ask / ask_without pair is
  // the fix by construction.
  const VISUAL_DANGLING = /^(dangling|unanswerable):/;
  const failingNow = () =>
    checks
      .map((c) => ({ ...c, faults: c.faults.filter((f) => !VISUAL_DANGLING.test(f)) }))
      .filter((c) => c.faults.length > 0 && repairable(plan.slides[c.slide - 1] as S, c.slide - 1));
  let failing = failingNow();
  const kinds = (f: string[]) => new Set(f.map((x) => x.split(":")[0]));
  /** How each slide's figure ended (diagram, picture, words-…), logged for the run. */
  const path = new Map<number, string>();
  const restore = (
    i: number,
    slide: S,
    n0: { notes: string; answers: string[] } | undefined,
    oldAsks: VisualAsk[],
  ) => {
    dropContinued(i);
    plan.slides[i] = slide;
    states.put(i, slide);
    if (n0) notes.set(i, n0);
    else notes.delete(i);
    asks.set(i, oldAsks);
    relay(i);
  };
  // fallbackOnlyOnFailure: a diagram that drew but did not fit beside the slide's words is a fit
  // problem, not a drawing failure. Before any reword or fallback the slide is laid out full width
  // (big-visual; its points are read in the notes), and kept when the diagram then fits.
  // With the checks only logging, the fit fault is logged ("relayout") and the slide stays.
  if (flags.fallbackOnlyOnFailure) {
    for (const c of failing) {
      const i = c.slide - 1;
      const s0 = plan.slides[i] as S;
      if (s0.template !== "visual-text" || !c.faults.some((f) => f.startsWith("diagram:")))
        continue;
      const d = (asks.get(i) ?? []).find((a) => a.type === "diagram");
      if (!d || visualState(i)(d.key).status !== "diagram") continue;
      // Checks only logging: the relayout runs only when it is what lets the diagram show (the
      // layout could not draw it beside the words); a diagram already on the slide stays as laid.
      const shownNow = (laid.get(i)?.slide.elements ?? []).some(
        (e) => e.type === "image" && e.name === "Diagram",
      );
      if (!act && shownNow) {
        log({ ev: "relayout-skipped", slide: i + 1, faults: c.faults.slice(0, 2) });
        continue;
      }
      const n0 = notes.get(i);
      const oldAsks = asks.get(i) ?? [];
      swapSlide(i, { ...s0, template: "big-visual" });
      const left = (check()[i]?.faults ?? []).filter(
        (f) => f.startsWith("diagram:") || OVERFLOW.test(f),
      );
      if (left.length) restore(i, s0, n0, oldAsks);
      else {
        relaid.set(i, plan.slides[i]);
        path.set(i, "diagram-big");
      }
      if (!act)
        log({
          ev: left.length ? "relayout-skipped" : "relayout-kept-visual",
          slide: i + 1,
          faults: c.faults.slice(0, 2),
        });
      log({
        ev: "diagram-relaid",
        slide: i + 1,
        ok: !left.length,
        ...(act ? {} : { keptVisual: !left.length }),
        ...(left.length ? { why: left.slice(0, 2) } : {}),
      });
    }
    checks = check();
    failing = failingNow();
  }
  const diagramKinds = () =>
    baseVisuals(stageKey)
      .match(/Diagram kinds:[\s\S]*?(?=\n\s*\n|$)/)?.[0]
      .trim() ?? "";
  /** Slide i's faults, judged against the phase's frozen deck while repairs run in parallel. */
  const judged = (i: number): string[] => {
    const was = frozen;
    if (phaseSlides) frozen = { slides: phaseSlides, own: i };
    const out = check()[i]?.faults ?? [];
    frozen = was;
    return out;
  };
  /** The deck as the current parallel phase started (undefined outside one). */
  let phaseSlides: readonly unknown[] | undefined;
  const repairOne = async (
    c: CheckResult,
    mode: "fit" | "stand-alone" | "reroute" = "fit",
    ro: {
      /** A reason to reject the call's slide (the reroute's same-picture guard). */
      guard?: (after: S) => string | undefined;
      /** Words the restaged slide may lose (the figure's own and its pointing words). */
      exempt?: ReadonlySet<string>;
      /** Fit: keep a reword that cut the overflow without clearing it. */
      keepPartial?: boolean;
      /** The call's schema; absent: the bundle's repair schema for the stage. */
      schema?: Record<string, unknown>;
    } = {},
  ): Promise<boolean> => {
    const i = c.slide - 1;
    const ask = asks.get(i) ?? [];
    const found = ask
      .map((a) => visualState(i)(a.key))
      .flatMap((v) =>
        v?.status === "photo"
          ? [`The picture placed shows: ${v.photo.about ?? v.photo.alt}`]
          : v?.status === "failed"
            ? ["No picture could be found for this slide."]
            : [],
      );
    const placed = ask.flatMap((a) => {
      const v = visualState(i)(a.key);
      return v?.status === "photo" ? [`${a.key}: ${v.photo.about ?? v.photo.alt}`] : [];
    });
    const tpl = P.repairUser;
    const own = String((plan.slides[i] as S)?.template ?? "");
    // A reroute (a picture that cannot be shown) may ask for a diagram of a supported kind.
    const hasDiagram = mode === "reroute" || ask.some((a) => a.type === "diagram");
    const faultLines = c.faults.map((f) => repairTerms(f, plan.slides[i], stageKey, !!pilot));
    // A restaging call is told its room: in words on a pack run, as its fault lines are.
    if (mode !== "fit") {
      const room = roomLine(plan.slides[i], stageKey, !!pilot);
      if (room) faultLines.push(room);
    }
    const u = fillTemplate(tpl, brief, {
      context: user,
      N: i + 1,
      [String(tpl.match(/\{\{(the diagram kinds[^}]*)\}\}/)?.[1] ?? "-")]: hasDiagram
        ? diagramKinds()
        : "",
      "the arm's layouts menu for this key stage: <arm>/layouts.<stage>.txt": layoutsFor(
        layoutsMenu(stageKey),
        own,
        !!pilot,
      ),
      "the slide's JSON exactly as the main call wrote it": JSON.stringify(plan.slides[i]),
      [String(tpl.match(/\{\{(one line per placed picture[^}]*)\}\}/)?.[1] ?? "-")]: placed.length
        ? placed.join("\n")
        : "none",
      [String(tpl.match(/\{\{(one line per fault[^}]*)\}\}/)?.[1] ?? "-")]: [
        ...faultLines,
        ...found,
      ]
        .sort()
        .join("\n"),
    });
    const r = await chat({
      model: SMALL_MODEL,
      effort: "low",
      // Restaging (stand-alone, reroute) has its own prompt, never repair.txt.
      system: mode === "fit" ? P.repair : P.restage,
      user: u,
      schema: ro.schema ?? generalRepairSchema(stageKey, own),
      name: "slide",
      // Strict JSON, as base4f-p123 ran repair and restage (TEACH-110 part f).
      strict: true,
    }).catch(
      whenNonFatal((e) => {
        log({ ev: "repair-error", slide: i + 1, err: String(e).slice(0, 200) });
        return undefined;
      }),
    );
    const o2 = r?.out as { slide?: S; to_notes?: unknown; fix?: string } | undefined;
    if (!o2?.slide || typeof o2.slide !== "object") {
      log({ ev: "repair", slide: i + 1, mode, ok: false });
      debug(
        "repair",
        { mode, ok: false, why: "no slide", faults: c.faults, out: r?.out ?? null },
        i,
      );
      return false;
    }
    // A pack's schema has the slide name its fit, as the writer's does; arrival strips it there.
    if (pilot && !ro.schema) {
      const { fit: _fit, ...rest } = o2.slide;
      o2.slide = rest;
    }
    const before = plan.slides[i] as S;
    const keyed = keepAnswerKey(
      before,
      keepAsksHonest(before, ro.schema ? carryFigures(before, o2.slide) : o2.slide),
    );
    o2.slide = keyed ?? before;
    const moved = (Array.isArray(o2.to_notes) ? o2.to_notes : [o2.to_notes ?? ""]).map(String);
    // The pinned repair prompt may move one whole unit to the notes or split: it is judged by the
    // word-loss rule, not the fit-only rule.
    const verdict = judgeRepair(before, o2.slide, moved, {
      diagramFault: c.faults.some((f) => f.startsWith("diagram:")),
      // A pilot fit repair shortens words to the measured room: rewording is its job, so it is
      // judged by the fit rule (every item kept, nothing to the notes), not word loss (proof:
      // every shortening of a pilot row was refused for losing words).
      fit: Boolean(ro.schema),
      // A restaged slide may lose its figure and the words that pointed at it, never a question,
      // an item or the slide's other words.
      ...(mode !== "fit" ? { restage: true, exempt: ro.exempt ?? POINTING_WORDS } : {}),
    });
    const guarded = ro.guard?.(o2.slide);
    const why = [
      ...(verdict.ok ? [] : verdict.why),
      ...(guarded ? [guarded] : []),
      // The hinge's answer option did not survive the repair word for word: keep the slide.
      ...(keyed ? [] : ["answer option lost"]),
    ];
    if (why.length) {
      log({ ev: "repair-rejected", slide: i + 1, mode, fix: o2.fix, why });
      debug(
        "repair",
        {
          mode,
          ok: false,
          rejected: why,
          fix: o2.fix,
          faults: c.faults,
          before,
          proposed: o2.slide,
        },
        i,
      );
      return false;
    }
    // orphan6 (BAKEOFF base4f): a fit repair that moved the only words naming a pictured thing drops
    // the picture, unless the slide asks pupils to look, point, match or find (keepPic).
    let orphanDrop = false;
    if (mode === "fit") {
      const orphans = orphansAfterFit(o2.slide, moved);
      const keep = orphans.length > 0 && asksToSee(wordsOf(o2.slide));
      if (keep) log({ ev: "keep-pic", slide: i + 1, rule: "orphan6", orphans });
      if (orphans.length && !keep) {
        orphanDrop = true;
        o2.slide = { ...o2.slide, picture: null };
        log({ ev: "orphan6-drop", slide: i + 1, orphans, moved });
      }
    }
    const n0 = notes.get(i);
    const oldAsks = asks.get(i) ?? [];
    swapSlide(i, o2.slide);
    if (orphanDrop) override.set(`${i}:picture`, { status: "failed" });
    applyRepair(plan.slides, notes, i, r?.out);
    const now = judged(i).filter((f) => n0 || !f.startsWith("unanswered"));
    const was = kinds(c.faults);
    const fresh = [...kinds(now)].filter((k) => !was.has(k));
    // A pilot repair's fit is measured by the fit ladder itself (pilotOvers at the drawn size); the
    // older checks' overflow points do not read pilot paths, so only a new fault of another kind
    // undoes it (proof: every accepted pilot shortening was reverted on that comparison).
    const worse = ro.schema
      ? fresh.some((k) => k !== "overflow")
      : mode !== "fit"
        ? now.some((f) => /^(dangling|unanswerable):/.test(f))
        : ro.keepPartial
          ? fresh.length > 0 || overflowPt(now) >= overflowPt(c.faults)
          : [...kinds(now)].some((k) => was.has(k)) || now.length > c.faults.length;
    if (worse) restore(i, before, n0, oldAsks);
    else if (c.faults.some((f) => f.startsWith("diagram:"))) path.set(i, "diagram-repaired");
    log({ ev: "repair", slide: i + 1, mode, ok: true, fix: o2.fix, reverted: worse });
    debug(
      "repair",
      {
        mode,
        ok: true,
        reverted: worse,
        fix: o2.fix,
        faultsBefore: c.faults,
        faultsAfter: now,
        before,
        after: o2.slide,
        toNotes: moved,
      },
      i,
    );
    return !worse;
  };
  /** Measure and retry: an overflowing slide gets at most two rewords. */
  const fitLoop = async (c: CheckResult): Promise<boolean> => {
    if (!c.faults.some((f) => OVERFLOW.test(f))) return repairOne(c);
    const first = await repairOne(c, "fit", { keepPartial: true });
    const i = c.slide - 1;
    const left = (check()[i]?.faults ?? []).filter((f) => OVERFLOW.test(f));
    if (!left.length) return first;
    return repairOne({
      slide: c.slide,
      faults: [
        ...left,
        `still over after one reword: cut the ${pilot ? "words" : "characters"} given above`,
      ],
    });
  };
  /**
   * Slide i's list split over continuation slides so each part fits (`continueForFit`), measured
   * with `visual`. True when it split; false (nothing changed) when no split fits.
   */
  const continueSlide = (i: number, visual: (key: string) => VisualState): boolean => {
    const fits = (sl: S) => {
      const m = materialise(sl, { ...base, index: i, plan, visual });
      const f = checkSlide({
        specs: [],
        index: i,
        slide: m.slide,
        over: m.over ?? [],
        questions: [],
        answers: undefined,
        notesChecked: true,
        words: "",
      });
      return { ok: !f.faults.some((x) => OVERFLOW.test(x)), m };
    };
    const cont = continueForFit(plan.slides[i] as S, (sl) => fits(sl).ok);
    if (!cont) return false;
    swapSlide(i, cont.first);
    continued.set(
      i,
      cont.rest.map((sl) => fits(sl).m),
    );
    continuedFrom.set(i, cont.rest);
    return true;
  };
  // In parallel, bounded: each repair reads and writes only its own slide. The replay matches each
  // call by the slide it sends, so it sees the same calls in any order.
  // ── pilot layouts: validate at the drawn size and repair (TEACH-110 part s) ──
  // A pilot slide's fields past their measured cap go back to a bounded fit repair whose schema
  // keeps the layout, then a second with exact budgets; code then cuts whole sentences only, and a
  // field with none to stop at stays whole (still over, the editor's chip). This is the pilot
  // layouts' own fit, not a check: it runs when the checks only log too (TEACH-110 part s).
  const pilotSlides = plan.slides.flatMap((s0, i) =>
    isPilot(s0 as S) && repairable(s0 as S, i) ? [i] : [],
  );
  await eachBounded(pilotSlides, TAIL_CONCURRENCY, async (i) => {
    const s0 = plan.slides[i] as S;
    const pctx = { ...base, index: i, plan, visual: visualState(i) };
    const at = pilotOvers(s0, pctx);
    if (!at.overs.length && !at.tooMany && !pilotSlips(s0).length) return;
    const repair = run.services
      ? async (_s: S, faults: string[]) => {
          const ok = await repairOne({ slide: i + 1, faults }, "fit", {
            keepPartial: true,
            schema: pilotRepairSchema(repairSchemaFor(stageKey), schema, String(s0.template)),
          });
          return ok ? (plan.slides[i] as S) : undefined;
        }
      : undefined;
    const r = await fitPilot(s0, pctx, repair, !!pilot);
    log({
      ev: "pilot-fit",
      slide: i + 1,
      path: r.path,
      overs: r.overs,
      steps: r.steps,
      ...(r.cut?.length ? { cut: r.cut } : {}),
      ...(r.kept?.length ? { kept: r.kept } : {}),
      ...(r.slips?.length ? { slips: r.slips } : {}),
    });
    // Members are never dropped silently: a re-lay is logged above, members nothing holds here.
    if (r.membersOver)
      log({
        ev: "pilot-members-over",
        slide: i + 1,
        id: `${stableIdPrefix(i)}layout`,
        template: String(r.slide.template),
      });
    if (r.path === "trimmed" || r.path === "still-over" || r.path === "relaid")
      swapSlide(i, r.slide);
  });
  if (pilotSlides.length) {
    checks = check();
    failing = failingNow();
  }
  if (act) {
    phaseSlides = [...plan.slides];
    await eachBounded(failing, TAIL_CONCURRENCY, async (c) => {
      await fitLoop(c);
    });
    phaseSlides = undefined;
  } else for (const c of failing) log({ ev: "repair-skipped", slide: c.slide, faults: c.faults });
  void charsOver;
  // gas8: a slide the one repair left impossible (or never repaired) gets the text-safe version,
  // every claimed gas volume scaled under the stated reactant's maximum by one factor for the
  // whole lesson, so volumes compared across slides keep their order.
  const gasHits = gasFaults(gasTexts());
  const gasAll = gasHits.flatMap((x) => x.volumes);
  const gasClaim = (h: (typeof gasHits)[number]) => ({
    checker: "gas8",
    claim: "every claimed gas volume is possible from the lesson's stated quantities",
    verdict: "contradicted",
    reason: h.fault,
    volumes: h.volumes,
    ...(h.vmax !== undefined ? { vmax: h.vmax } : {}),
  });
  for (const h of gasHits) {
    if (!repairable(plan.slides[h.slide] as S, h.slide)) {
      factCheck(h.slide, { ...gasClaim(h), applied: false, dropped: "slide not repairable" });
      continue;
    }
    if (!actOn({ ev: "gas8", slide: h.slide + 1, fault: h.fault })) {
      factCheck(h.slide, { ...gasClaim(h), applied: false, dropped: "dry run (act off)" });
      continue;
    }
    const before = plan.slides[h.slide];
    const t0 = performance.now();
    swapSlide(h.slide, rescaleGas(plan.slides[h.slide] as S, gasAll, h.vmax));
    const left = gasFaults(gasTexts()).some((x) => x.slide === h.slide);
    log({ ev: "gas8-fallback", slide: h.slide + 1, fault: h.fault, cleared: !left });
    factCheck(h.slide, {
      ...gasClaim(h),
      correction: "every volume rescaled under the stated maximum by one factor",
      applied: true,
      cleared: !left,
      before,
      after: plan.slides[h.slide],
      ms: +(performance.now() - t0).toFixed(2),
    });
  }
  // The writer path's fact check, per lesson: how many slides it read and how many it flagged.
  if (run.services.debug)
    debug("fact-check", {
      checker: "gas8",
      summary: true,
      slidesChecked: n,
      flagged: [...new Set(gasHits.map((h) => h.slide))].length,
      model: "code",
      usd: 0,
    });
  // figureSync: after repair, every drawn figure is checked against its slide's words; one that
  // disagrees is dropped, so the fallback below restages the slide without it.
  for (let i = 0; i < n; i++)
    for (const a of asks.get(i) ?? []) {
      const v = visualState(i)(a.key);
      if (a.type !== "diagram" || v.status !== "diagram") continue;
      const why = figureTextMismatch(v.spec, plan.slides[i] as S | undefined);
      if (!why) continue;
      const actedOn = actOn({
        ev: "figure-text-mismatch",
        slide: i + 1,
        key: a.key,
        why,
        dropped: act,
      });
      factCheck(i, {
        checker: "figure-text",
        claim: "the drawn figure's numbers are the ones the words say",
        verdict: "mismatch",
        reason: why,
        correction: "figure dropped",
        applied: actedOn,
        ...(actedOn ? {} : { dropped: "dry run (act off)" }),
        figure: v.spec,
        words: wordsOf(plan.slides[i] as S),
      });
      if (!actedOn) continue;
      override.set(`${i}:${a.key}`, { status: "failed" });
      relay(i);
    }

  // ── a figure that cannot be shown (FOR-CODE item 5) ──
  // A diagram fault went to repair once above; a diagram that still cannot draw becomes a picture
  // of the same thing when it is a real thing, a table becomes words that keep its data, anything
  // else is restaged to stand alone. A vetoed or missing picture goes straight to restage. A
  // restaged figure is never sent back to repair. A slot still pending (a placeholder) is left.
  const restage = async (
    i: number,
    lost: { type: string; kind?: string; shows: string; labels?: string[]; key?: string },
    mode: "stand-alone" | "reroute",
    why?: string,
    guard?: (after: S) => string | undefined,
  ): Promise<string> => {
    const orig = plan.slides[i] as S;
    const exempt = new Set([
      ...POINTING_WORDS,
      ...wordsOfText(lost.shows),
      ...(lost.labels ?? []).flatMap((l) => wordsOfText(l)),
    ]);
    const over = () => (check()[i]?.faults ?? []).filter((f) => OVERFLOW.test(f));
    // rerouteLists (BAKEOFF base4f): the rewrite may not paste the lost picture's subject list.
    const guard2 =
      lost.type === "photo"
        ? (after: S) => pastedPictureList(orig, after, lost.shows ?? "") ?? guard?.(after)
        : guard;
    const ok = await repairOne({ slide: i + 1, faults: [lostFault(lost, why)] }, mode, {
      guard: guard2,
      exempt,
    });
    // A restaged slide is never sent back to repair (FOR-CODE item 5), not even for fit: one
    // that overflows goes to the fixed fallback below. (The lab harness ran its fit loop here.)
    if (ok) {
      if (!over().length) return mode === "reroute" ? "rerouted" : "rewrite";
      log({ ev: "restage-overflow", slide: i + 1, mode });
    }
    // The fixed fallback, from the slide as it was before the call.
    const v = lost.key ? visualState(i)(lost.key) : undefined;
    const spec = (v?.status === "diagram" ? v.spec : undefined) as S | undefined;
    const fromSpec = (spec?.nodes ?? spec?.steps ?? spec?.events) as unknown[] | undefined;
    const parts = (fromSpec ?? lost.labels ?? [])
      .map((p) =>
        typeof p === "string"
          ? p
          : [String((p as S).date ?? ""), String((p as S).text ?? (p as S).label ?? "")]
              .filter(Boolean)
              .join(": "),
      )
      .filter((p) => p.trim());
    // seqSteps (BAKEOFF base4f): a flow lost to words keeps what its arrows said; with no labelled
    // links and the slide's own points to fall back on, the figure is dropped and the points stay.
    if (lost.type === "diagram") {
      const t = linkSteps(spec);
      if (t.length >= 2) parts.splice(0, parts.length, ...t);
      else if (Array.isArray(orig.points) && orig.points.length) parts.splice(0, parts.length);
    }
    const maxSteps = Math.max(
      0,
      ...(fitTable()[stageKey]?.layouts.steps?.variants ?? [])
        .filter((x) => x.chars > 0 && !x.figure)
        .map((x) => x.counts.points ?? 0),
    );
    const n0 = notes.get(i);
    const oldAsks = asks.get(i) ?? [];
    const fb = fixedFallback(orig, lost, parts, maxSteps);
    swapSlide(i, fb.slide);
    if (!over().length) {
      log({ ev: "restage-fallback", slide: i + 1, mode, how: fb.how });
      return fb.how;
    }
    restore(i, orig, n0, oldAsks);
    swapSlide(i, fixedFallback(orig, { type: "photo" }, [], 0).slide);
    // The last resort never ships overflow: what still does not fit moves to continuation slides.
    if (over().length && continueSlide(i, () => ({ status: "failed" }))) {
      log({ ev: "restage-fallback", slide: i + 1, mode, how: "strip-continued" });
      return "strip-continued";
    }
    log({ ev: "restage-fallback", slide: i + 1, mode, how: "strip" });
    return "strip";
  };
  /**
   * Tile diagrams (TEACH-75 part d): each was drawn with the same drawer and retries as any
   * diagram. A tile that still could not be shown (failed, or drawn but too big for its tile)
   * becomes a picture of the same thing; when those pictures do not all land, the slide takes its
   * words-only form (text cards, numbered steps). Never an empty tile. True when it decided.
   */
  const tileFallback = async (i: number, fo: { noPicture?: boolean }): Promise<boolean> => {
    const s = plan.slides[i] as S;
    const tiles = tileDiagramKeys(s);
    if (!tiles.length) return false;
    const st = tiles.map((k) => visualState(i)(k).status);
    if (st.includes("pending")) return true;
    const laidLost = new Set(laid.get(i)?.lost ?? []);
    const lost = tiles.filter((k, n) => st[n] === "failed" || laidLost.has(k));
    if (!lost.length) {
      path.set(i, "diagram");
      return true;
    }
    const pic = fo.noPicture ? undefined : tilesAsPictures(s, lost);
    if (pic) {
      const n0 = notes.get(i);
      const oldAsks = asks.get(i) ?? [];
      swapSlide(i, pic);
      const now = plan.slides[i] as S;
      await run.placeMore?.(
        i,
        (asks.get(i) ?? []).filter((a) => a.type === "photo" && lost.includes(a.key)),
        { heading: String(now.heading ?? ""), text: wordsOf(now), point: pointOf(now) },
      );
      if (lost.every((k) => visualState(i)(k).status === "photo")) {
        relay(i);
        log({ ev: "tile-pictures", slide: i + 1, keys: lost });
        path.set(i, "picture");
        return true;
      }
      restore(i, s, n0, oldAsks);
    }
    // The lost tiles are failed: materialise lays the cards as text, the stages as steps.
    for (const k of lost) override.set(`${i}:${k}`, { status: "failed" });
    relay(i);
    log({ ev: "tile-unshown", slide: i + 1, keys: lost });
    path.set(i, "unshown");
    unpoint(i);
    return true;
  };
  const fallback = async (i: number, fo: { noPicture?: boolean } = {}) => {
    if (!path.has(i) && (await tileFallback(i, fo))) return;
    const dAsk = (asks.get(i) ?? []).find((a) => a.type === "diagram") as
      | Extract<VisualAsk, { type: "diagram" }>
      | undefined;
    if (!dAsk || path.has(i)) return;
    const st = visualState(i)(dAsk.key).status;
    if (st === "pending") return;
    // A diagram the layout could not place did not draw: it falls back whatever the checks do.
    if (!laid.get(i)?.diagram?.length && st === "diagram") {
      path.set(i, "diagram");
      return;
    }
    const s = plan.slides[i] as S;
    // A picture of the same thing: any kind that shows a thing or process, never data.
    const pic = !fo.noPicture && pictureFallbackOk(dAsk.kind) ? asPicture(s) : undefined;
    if (pic) {
      const n0 = notes.get(i);
      const oldAsks = asks.get(i) ?? [];
      swapSlide(i, pic);
      // The picture is placed now, after editable (as the evidence ran; base4 never placed it).
      const now = plan.slides[i] as S;
      await run.placeMore?.(
        i,
        (asks.get(i) ?? []).filter((a) => a.type === "photo"),
        { heading: String(now.heading ?? ""), text: wordsOf(now), point: pointOf(now) },
      );
      if ((asks.get(i) ?? []).some((a) => visualState(i)(a.key).status === "photo")) {
        relay(i);
        path.set(i, "picture");
        return;
      }
      restore(i, s, n0, oldAsks);
    }
    // Greg (10 Oct 2026): a planned visual is never lost. A drawing that draws in no room cleanly
    // but does draw with warnings ships the least-bad layout, its warnings logged on visual-path.
    if (st === "diagram") {
      relay(i, true);
      if (laid.get(i)?.diagramWarnings?.length && !laid.get(i)?.diagram?.length) {
        warned.add(i);
        path.set(i, "diagram");
        return;
      }
      relay(i);
    }
    // A table is words already: one that cannot draw keeps its data, as text lines on the slide
    // (flag off) or, by default, in the speaker notes beside the writer's own slide.
    const t = tableRows(visualState(i)(dAsk.key), dAsk);
    if (dAsk.kind === "table" && t.rows.length && !flags.noTableText) {
      swapSlide(
        i,
        asTableText(
          s,
          t,
          pilot
            ? {
                stage: stageKey,
                holds: (x) => {
                  const o = pilotOvers(x, { ...base, index: i, plan, visual: visualState(i) });
                  return !o.tooMany && !o.overs.length;
                },
              }
            : undefined,
        ),
      );
      path.set(i, "table-text");
      return;
    }
    // Otherwise the slide stays as the writer wrote it: its lines are laid in their ask_without
    // form and the figure's slot closes (materialise). SIMPLIFY S3: the stand-alone rewrite into
    // words and the fixed figure-dropped slide were the same or worse than this on every replay
    // firing, and the rewrite cost a model call.
    path.set(i, "unshown");
    unpoint(i);
    if (dAsk.kind === "table" && t.rows.length)
      tableNotes.set(i, {
        slide: plan.slides[i],
        lines: [...(t.header?.length ? [t.header] : []), ...t.rows].map((r) => r.join(" | ")),
      });
  };
  /**
   * An unshown visual never leaves its slide pointing at it, whatever ask_without said (null, or
   * still "look at…"): each sentence that points goes; if the slide still points, its figure
   * fields go and code strips the remaining pointing sentences (fixedFallback). Kept only when no
   * dangling fault is left.
   */
  const dangles = (i: number) => {
    if ((check()[i]?.faults ?? []).some((f) => /^dangling:/.test(f))) return true;
    const els = laid.get(i)?.slide.elements ?? [];
    if (els.some((e) => e.type === "image")) return false;
    const shown = asShown(i);
    return !!(pointTaskFault(shown) ?? referentFault(shown, false));
  };
  const unpoint = (i: number) => {
    if (!dangles(i)) return;
    if (!actOn({ ev: "unpoint", slide: i + 1 })) return;
    const s0 = plan.slides[i] as S;
    const n0 = notes.get(i);
    const oldAsks = asks.get(i) ?? [];
    const { slide: stripped, removed } = stripPointTasks(s0, ANY_POINTING);
    if (removed.length) {
      swapSlide(i, stripped);
      if (!dangles(i))
        return void log({ ev: "unshown-strip", slide: i + 1, removed, how: "sentences" });
    }
    swapSlide(i, fixedFallback(plan.slides[i] as S, { type: "photo" }, [], 0).slide);
    if (!dangles(i)) return void log({ ev: "unshown-strip", slide: i + 1, removed, how: "bare" });
    restore(i, s0, n0, oldAsks);
    log({ ev: "unshown-strip", slide: i + 1, removed, how: "left" });
  };
  type PhotoAsk = Extract<VisualAsk, { type: "photo" }>;
  /** A slide's failed photo asks that lostPic may fill (sets, fixed shapes and cards have their own paths). */
  const lostAsks = (i: number) =>
    (asks.get(i) ?? []).filter(
      (a): a is PhotoAsk =>
        a.type === "photo" &&
        !a.set &&
        !a.fixedShape &&
        // a card's picture has its own retry and plain-question fallback (ruling 195): a pair
        // slide is never split or redrawn
        !/^card\.\d+$/.test(a.key) &&
        visualState(i)(a.key).status === "failed",
    );
  /**
   * lostPic's attempt for one lost picture: swap in `next` (a library drawing or a split), place or
   * draw its new visuals, and keep it only when they land; otherwise the slide is restored.
   */
  const attemptLost =
    (i: number, s0: S, n0: ReturnType<typeof notes.get>, lost: PhotoAsk) =>
    async (next: S, kind: "split" | "library"): Promise<boolean> => {
      const oldAsks = asks.get(i) ?? [];
      swapSlide(i, next);
      const all = asks.get(i) ?? [];
      const now = plan.slides[i] as S;
      if (kind === "split")
        await run.placeMore?.(
          i,
          all.filter((a) => a.type === "photo"),
          { heading: String(now.heading ?? ""), text: wordsOf(now), point: pointOf(now) },
        );
      if (kind === "library" && run.drawDiagrams)
        for (const a of all)
          if (a.type === "diagram" && !drawnDiagrams.has(`${i}:${a.key}`)) {
            const r = await drawWriterDiagram(diagramAsk(a, now), {
              callDrawer: run.drawDiagrams.callDrawer,
              drawerSystem: writerDrawerSystem,
              fitActs: act,
              theme: base.theme,
              probe: layoutSlotProbe,
              log: (e) => log({ ...e, slide: i + 1 }),
            });
            if (r.spec) drawnDiagrams.set(`${i}:${a.key}`, { status: "diagram", spec: r.spec });
          }
      const got = all.every((a) => {
        const st = visualState(i)(a.key).status;
        return kind === "library" ? st === "diagram" || a.type !== "diagram" : st === "photo";
      });
      // splitOk (D48b, p123-2 y1 s6: 5 of 8 tiles landed and the slide lost every picture): a
      // split is kept when 2 or more of its pictures and at least half land; the rest drop out.
      // the same photo placed twice (one bank image for two tiles) counts, and ships, once
      const srcs = new Set<string>();
      const landed = all.filter((a) => {
        const v = visualState(i)(a.key);
        if (a.type !== "photo" || v.status !== "photo") return false;
        const src = (v as { photo?: { src?: string } }).photo?.src ?? a.key;
        if (srcs.has(src)) return false;
        srcs.add(src);
        return true;
      });
      const ok =
        kind === "split"
          ? all.length > 0 && splitLanded(landed.length, all.length)
          : got && all.length > 0;
      log({
        ev: "lost-picture",
        slide: i + 1,
        try: kind,
        ok,
        ...(kind === "split" ? { landed: landed.length, asked: all.length } : {}),
      });
      if (kind === "split")
        debug(
          "split",
          {
            how: "lost-picture",
            ok,
            before: s0,
            after: now,
            landed: landed.length,
            asked: all.length,
          },
          i,
        );
      if (ok && landed.length < all.length) {
        const shows = new Set(landed.map((a) => a.shows));
        swapSlide(i, keepLanded(now, lost.key, (x) => shows.has(x)) as S);
      }
      if (ok) {
        relay(i);
        return true;
      }
      restore(i, s0, n0, oldAsks);
      return false;
    };
  /** The library drawing the director chose for a lost picture, where it was the slide's one visual. */
  const drawLost = async (i: number, lost: PhotoAsk, kind: string): Promise<boolean> => {
    const s0 = plan.slides[i] as S;
    const others = (asks.get(i) ?? [])
      .filter((a) => a.key !== lost.key)
      .map((a) => visualState(i)(a.key).status);
    if (!heldPhotoFills(s0, others)) return false;
    const how = await lostPictureFallback(
      s0,
      lost.key,
      lost.shows,
      attemptLost(i, s0, notes.get(i), lost),
      { kind, labels: lost.mustSee },
    );
    if (how) path.set(i, `picture-${how}`);
    return how !== undefined;
  };
  /**
   * Greg, 10 Oct ("a visual should never be lost"): before any rewrite, every failed photo ask the
   * picture path can still fill is tried once more. A drawing the director chose is drawn by the
   * drawer (only where it was the slide's one visual); if it cannot be, or for a placement that ran
   * out of time or failed, the ask is placed again, which keeps the picture route (stock, then
   * generation). One `placeMore` round for the slide, each ask at most once.
   */
  const retryLost = async (i: number) => {
    if (i < 2) return;
    const again: PhotoAsk[] = [];
    for (const lost of lostAsks(i)) {
      const kind = run.drawAs?.(i, lost.key);
      if (!kind && !run.retryable?.(i, lost.key)) continue;
      if (kind && run.drawDiagrams && !path.has(i) && (await drawLost(i, lost, kind))) continue;
      again.push(lost);
    }
    if (!again.length || !run.placeMore) return;
    const now = plan.slides[i] as S;
    await run.placeMore(i, again, {
      heading: String(now.heading ?? ""),
      text: wordsOf(now),
      point: pointOf(now),
    });
    const landed = again.filter((a) => visualState(i)(a.key).status === "photo").length;
    log({
      ev: "lost-picture",
      slide: i + 1,
      try: "picture",
      ok: landed > 0,
      landed,
      asked: again.length,
    });
    if (!landed) return;
    relay(i);
    if (!path.has(i) && !lostAsks(i).length) path.set(i, "picture-placed");
  };
  const pictureLost = async (i: number) => {
    if (path.has(i) || i < 2) return;
    const lost = lostAsks(i)[0];
    if (!lost) return;
    // lostPic (BAKEOFF base4f): a library diagram of the same thing, then one picture per subject,
    // before any rewrite; the slide is restored unless every new visual lands (a split: unless
    // splitOk holds, and then only its landed pictures ship).
    const s0 = plan.slides[i] as S;
    const n0 = notes.get(i);
    // Only a slide whose lost picture was its one visual (keepPic's rule): never over a figure,
    // tiles or a table that did land.
    const others = (asks.get(i) ?? [])
      .filter((a) => a.key !== lost.key)
      .map((a) => visualState(i)(a.key).status);
    const how0 = !heldPhotoFills(s0, others)
      ? undefined
      : await lostPictureFallback(s0, lost.key, lost.shows, attemptLost(i, s0, n0, lost));
    if (how0) {
      path.set(i, `picture-${how0}`);
      return;
    }
    // A reroute that asks for the picture that could not be shown again is rejected.
    const same = (after: S) =>
      visualsOf(after, i, { ...base, plan }).some(
        (a) =>
          a.type === "photo" &&
          (sameFigure({ type: "photo", shows: a.shows }, { type: "photo", shows: lost.shows }) ||
            plainWords(a.shows) === plainWords(lost.shows)),
      )
        ? "re-asks the picture that could not be shown"
        : undefined;
    let how = await restage(
      i,
      { type: "photo", shows: lost.shows, key: lost.key },
      "reroute",
      run.vetoed?.(i, lost.key),
      same,
    );
    // A diagram the reroute asked for goes through the diagram path (never back to a picture).
    if (how === "rerouted" && (asks.get(i) ?? []).some((a) => a.type === "diagram")) {
      await fallback(i, { noPicture: true });
      how = `to-${path.get(i) ?? "diagram"}`;
    }
    path.set(i, `picture-${how}`);
  };
  // ── each slide's tail, in parallel (bounded): fallback, lost picture, keepPic, pointGuard ──
  // Every step reads and writes only its own slide, so a slide settles as soon as its own work is
  // done; it never waits behind another slide's restage or picture round.
  // keepPic (BAKEOFF base4f, fill-only): a photo match6 dropped from an ask slide fills the slide
  // only when it ended with no visual at all (no landed picture or diagram, no table); it never
  // replaces one a fallback made, and never overflows.
  const keepPic = (i: number, beforeLost: S | undefined, asksBeforeLost: VisualAsk[]) => {
    for (const a of asksBeforeLost) {
      const h = a.type === "photo" ? run.held?.(i, a.key) : undefined;
      if (h?.status !== "photo") continue;
      const now = plan.slides[i] as S;
      const statuses = (asks.get(i) ?? []).map((x) => visualState(i)(x.key).status);
      if (!heldPhotoFills(now, statuses)) {
        log({ ev: "keep-pic-unused", slide: i + 1, key: a.key, path: path.get(i) });
        continue;
      }
      const nn = notes.get(i);
      const oldAsks = asks.get(i) ?? [];
      swapSlide(i, beforeLost as S);
      override.set(`${i}:${a.key}`, h);
      relay(i);
      if ((check()[i]?.faults ?? []).some((f) => OVERFLOW.test(f))) {
        override.delete(`${i}:${a.key}`);
        restore(i, now, nn, oldAsks);
        log({ ev: "keep-pic-unused", slide: i + 1, key: a.key, why: "overflow" });
        continue;
      }
      path.set(i, "picture-kept");
      log({ ev: "keep-pic", slide: i + 1, key: a.key, rule: "match6" });
    }
  };
  // pointGuard (BAKEOFF base4f, D47): the code backstop. A slide that still points at nothing
  // (its picture lost, its rewrite still dangling) loses each pointing sentence and every question
  // about a lettered or left/right shape; "Answer from memory." where a task is left. The title
  // slide too. A strip that leaves the slide dangling is undone. (The lab ran its stand-alone
  // rewrite first; this stage has no stand-alone pass, so the strip is the only step.)
  const DANGLING = /^dangling:/;
  const pointGuard = (i: number) => {
    const s = plan.slides[i] as S | undefined;
    if (!s || (i > 0 && !repairable(s, i))) return;
    if (!check()[i]?.faults.some((f) => DANGLING.test(f))) return;
    const { slide: stripped, removed } = stripPointTasks(s);
    if (!removed.length) return;
    // Intended under D48: the slide ships with its pointing line, which may dangle; logged so a
    // run counts every one.
    if (flags.pointGuardLogOnly || !act)
      return void log({
        ev: "point-guard",
        slide: i + 1,
        removed,
        how: "log-only",
        ships: "dangling pointer (D48)",
      });
    const n0 = notes.get(i);
    const oldAsks = asks.get(i) ?? [];
    swapSlide(i, stripped);
    const left = check()[i]?.faults.some((f) => DANGLING.test(f));
    if (left) restore(i, s, n0, oldAsks);
    log({ ev: "point-guard", slide: i + 1, removed, how: left ? "left" : "point-strip" });
  };
  // Ruling 195: a matching task's card pictures that failed are asked once more before the slide
  // settles; any still missing turn the task into a plain question (materialise). A cards grid's
  // icons (ruling 203) get the same one retry; any still missing show the theme's glyph.
  const cardRetry = async (i: number) => {
    const s = plan.slides[i] as S | undefined;
    const icons = s?.template === "cards-grid";
    const failed = (asks.get(i) ?? []).filter(
      (a) =>
        a.type === "photo" &&
        (icons ? /^icon\.\d+$/ : /^card\.\d+$/).test(a.key) &&
        visualState(i)(a.key).status === "failed",
    );
    if (!failed.length || !s || !(s.template === "pair" || icons) || !run.placeMore) return;
    await run.placeMore(i, failed, {
      heading: String(s.heading ?? ""),
      text: wordsOf(s),
      point: pointOf(s),
    });
    const still = failed.filter((a) => visualState(i)(a.key).status === "failed").length;
    log({ ev: "card-retry", slide: i + 1, asked: failed.length, still });
    relay(i);
  };
  const settleSlide = async (i: number) => {
    await cardRetry(i);
    await fallback(i);
    await retryLost(i);
    const beforeLost = plan.slides[i] as S | undefined;
    const asksBeforeLost = asks.get(i) ?? [];
    await pictureLost(i);
    keepPic(i, beforeLost, asksBeforeLost);
    pointGuard(i);
    // The slide is final: its note is written again only when what the notes call saw changed.
    if (i >= 2 && asShown(i) !== seenByNotes.get(i)) {
      log({ ev: "notes-redo", slide: i + 1 });
      notesRedone.set(i, notesCall(i + 1));
    }
  };
  // One slide's tail that throws (a bug, a malformed ask) never fails the lesson: that slide is
  // kept exactly as it was at editable. A stop (cancel, budget) still ends the run.
  const settleOrKeep = async (i: number) => {
    const s0 = plan.slides[i] as S | undefined;
    const n0 = notes.get(i);
    const asks0 = asks.get(i) ?? [];
    const path0 = path.get(i);
    await nonFatal(
      () => settleSlide(i),
      (error) => {
        if (run.signal?.aborted) throw error;
        log({ ev: "slide-tail-failed", slide: i + 1, where: safeErrorWhere(error) });
        if (s0) restore(i, s0, n0, asks0);
        if (path0) path.set(i, path0);
        else path.delete(i);
        notesRedone.delete(i);
      },
    );
  };
  phaseSlides = [...plan.slides];
  await eachBounded(
    Array.from({ length: n }, (_, i) => i),
    TAIL_CONCURRENCY,
    settleOrKeep,
  );
  phaseSlides = undefined;
  // Greg 70 B (20 Oct): a slide whose text or a card still runs off the slide (after the rewords,
  // or with none when checks only log) splits into continuation slides, as the restage's last
  // resort does. This one check acts when the others only log. Only off-slide overflow (71 A): a
  // block a little past its room but on the slide stays as it is. It runs last, once every slide
  // is final (gas8, figure checks, restage and the tails), so no later swap of slide i leaves
  // parts of an older version behind. What cannot split is reported at the end (`overflow` on the
  // output). Root cause (the writer overfilling the layout) is open.
  for (let i = 0; i < n; i++) {
    if (!offSlideAt(i).length || continued.has(i)) continue;
    if (!repairable(plan.slides[i] as S, i)) continue;
    const ok = continueSlide(i, visualState(i));
    log({ ev: ok ? "fit-continued" : "fit-continue-failed", slide: i + 1 });
  }
  for (const [i, p] of path) {
    const warnings = laid.get(i)?.diagramWarnings;
    log({ ev: "visual-path", slide: i + 1, path: p, ...(warnings?.length ? { warnings } : {}) });
  }

  // ── notes: the deck-wide call, with each changed slide's own note in its place ──
  const got = await deckNotes;
  for (const [i, redo] of notesRedone) {
    const one = (await redo).get(i + 1);
    // A redo that failed comes back blank: the deck-wide note is kept, never replaced by nothing.
    const real =
      one &&
      [one.answers, one.misconceptions, one.background, one.run].some((v) =>
        Array.isArray(v) ? v.length > 0 : typeof v === "string" && v.trim() !== "",
      );
    if (one && real) got.set(i + 1, one);
    else log({ ev: "notes-redo-miss", slide: i + 1, kept: "deck" });
  }
  for (const [k, s0] of got) {
    if (k < 3 || k > n) continue;
    // A multiple-choice answer starts with the correct letter as shown.
    const a0 = s0.answers;
    const lettered = Array.isArray(a0)
      ? a0.map((x, j) => (j === 0 ? (withCorrectLetter(x, plan.slides[k - 1]) ?? x) : x))
      : withCorrectLetter(a0, plan.slides[k - 1]);
    const s = { ...s0, answers: lettered };
    const answers = Array.isArray(s.answers)
      ? s.answers.map(String)
      : s.answers
        ? Array<string>(12).fill(String(s.answers))
        : [];
    notes.set(k - 1, { notes: notesText(s), answers });
  }
  checks = check();
  const textOnlyTeach = Array.from({ length: n }, (_, i) => i).filter(
    (i) =>
      i > 1 &&
      teaching(plan.slides[i] as S) &&
      !(laid.get(i)?.slide.elements ?? []).some((e) => e.type === "image"),
  ).length;
  const dangling = checks.flatMap((c) =>
    c.faults.filter((f) => VISUAL_DANGLING.test(f)).map((f) => ({ slide: c.slide, fault: f })),
  );
  // An objective the coverage rule reads as untaught or unchecked is logged here, never repaired
  // by a model call (SIMPLIFY S3: on the replay every gap was a picture or matching task the rule
  // does not count). Coverage by the written slides' templates and the checker's rules (the summary
  // used to classify by `does` alone and read 0 while an objective was unchecked).
  const unmet = plan.flow
    ? coverage(plan.flow, run.objectives.length, (k) => plan.slides[k - 1]?.template as string, {
        ...coverageRules,
        slideOf: (k) => plan.slides[k - 1] as S | undefined,
      }).missing
    : [];
  if (unmet.length) log({ ev: "coverage-unmet", level: "warn", missing: unmet });
  const overflow = Array.from({ length: n }, (_, i) => i).flatMap((i) => {
    const faults = offSlideAt(i);
    const id = slideAt(i)?.id;
    return faults.length && id ? [{ slide: i + 1, id, faults }] : [];
  });
  for (const o of overflow) log({ ev: "overflow-shipped", level: "warn", ...o });
  log({ ev: "summary", textOnlyTeach, dangling: dangling.length, coverage: unmet.length });
  return {
    overflow,
    slides: deck(),
    plan,
    checks,
    title: String((plan.slides[0] as S | undefined)?.heading ?? brief.topic),
    writer: { usd: main.usd, ms: main.ms, finishReason: main.finishReason ?? null },
    summary: { textOnlyTeach, dangling },
  };
}

/**
 * A question list's answers (question set, practice, exit ticket) as slide question data, from the
 * notes stage's one answer per question, so present hides them until the reveal (TEACH-101 part b).
 */
/** A relaid slide's points as lines for the notes. */
function relaidPoints(s: S | undefined): string[] {
  const p = Array.isArray(s?.points) ? (s.points as unknown[]) : [];
  return p.map((x) =>
    typeof x === "string"
      ? x
      : [String((x as S)?.label ?? ""), String((x as S)?.text ?? "")].filter(Boolean).join(": "),
  );
}

function listQuestion(
  s: S | undefined,
  n: { answers: string[] } | undefined,
): Slide["question"] | undefined {
  if (!s || !["question-set", "practice", "exit-ticket"].includes(String(s.template))) return;
  const qs = Array.isArray(s.questions) ? s.questions.map(String) : [];
  return listAnswers(qs, n?.answers);
}
