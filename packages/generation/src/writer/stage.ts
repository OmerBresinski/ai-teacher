import type { Slide, Theme } from "@tj/domain/documents";
import { slotBox, slotOf, withBuilds } from "@tj/slides/diagrams";
import { listAnswers } from "@tj/slides/templates";
import { getTheme } from "@tj/slides/themes";
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
import { type WriterBundleId, writerBundle } from "./bundle";
import { CHECKER_DEFAULTS, type CheckerFlags } from "./checker-flags";
import { type CheckResult, checkSlide, duplicateFaults, slideNoEmDash } from "./checks";
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
import {
  asPicture,
  asTableText,
  asWords,
  continueForFit,
  pictureFallbackOk,
  tableRows,
} from "./fallbacks";
import { figureTextMismatch, specKey, syncFigure } from "./figure-sync";
import { FIGURE_TEXT_DEFAULT, figureTextFix } from "./figure-text";
import {
  applyRepair,
  asksVisual,
  type Brief,
  charsOver,
  contextBlock,
  fillTemplate,
  fitTable,
  fixedFallback,
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
  withCorrectLetter,
  withLook,
  writerIncomplete,
} from "./fixes";
import { gasFaults, rescaleGas } from "./gas";
import {
  judgeRepair,
  POINTING_WORDS,
  repairable,
  sameFigure,
  teaching,
  words as wordsOfText,
} from "./guards";
import { localise } from "./locale";
import { lostPictureFallback } from "./lost-picture";
import {
  codeObjectives,
  codeTitle,
  type Materialised,
  materialise,
  modelPoints,
  type Plan,
  questionsOf,
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
  objectiveRepairSchema,
  renderedLines,
  repairObjectives,
  type SlideNotes,
} from "./notes";
import { PartialJson } from "./partial";
import { asksToSee, heldPhotoFills, orphansAfterFit, pastedPictureList } from "./picture-checks";
import { stripPointTasks } from "./point-guard";
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
import { slideStates } from "./slide-states";

/*
 * The lesson writer stage (TEACH-110 part b), ported from the pinned writer's run: one streamed
 * writer call with the teacher's approved objectives as givens, K3 on its output, the seeded
 * hinge shuffle, the flow's `look_at` honoured, code checks on each laid-out slide, the objective
 * coverage repair, one bounded fit repair (measure and retry), and one notes call on the final
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
   * The activity layouts (TEACH-101 part c): the menu in the system text and the five families in
   * the schema. Absent: `ACTIVITIES_DEFAULT` (off).
   */
  activities?: boolean;
  /** A diagram's alt and shows rewritten from its spec when they disagree (figure-text.ts). */
  figureText?: boolean;
  /**
   * lostPic (BAKEOFF base4f): place more photo asks after editable (a lost compound picture asked
   * again one subject each) and wait for them; absent, the asks read `visual` as they are.
   */
  placeMore?: (index: number, asks: VisualAsk[], slide: SlideForPicture) => Promise<void>;
  /** keepPic: a photo match6 dropped from an ask slide, for a slide that ends with no visual. */
  held?: (index: number, key: string) => VisualState | undefined;
  /**
   * A slide as soon as it is laid out while the deck is still being made (TEACH-110 part h, C2):
   * each slide the writer's stream closes, and again when its diagram is drawn. Read-only: the
   * editable deck (`onEditable`) supersedes every one of them.
   */
  onSlide?: (index: number, slide: WriterSlide) => void;
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
};

/**
 * The writer's system text for the brief's stage: the pinned text with the contract lines that
 * come from the drawer's schema and the exact slide count (contract.ts), nothing appended.
 */
export function writerSystem(brief: Brief, P = writerBundle()): string {
  const k = promptStage(brief.keyStage);
  return contractSystem(k === "KS1" ? P.systemKS1 : k === "KS2" ? P.systemKS2 : P.systemKS3_5);
}

/** The pupil-wording call's deadline: it runs beside the writer, so it is never the wait. */
export const PUPIL_WORDING_DEADLINE_MS = 8_000;

export async function runWriter(run: WriterRun): Promise<WriterOutput> {
  const { brief } = run;
  const P = writerBundle(run.bundle);
  const repairSchemaFor = (k: string) =>
    JSON.parse(
      k === "KS1" ? P.repairSchemaKS1 : k === "KS2" ? P.repairSchemaKS2 : P.repairSchemaKS3_5,
    );
  // The repair's layouts menu: the one the lab's repair calls sent (BAKEOFF prompts/T, heading
  // room in characters), not the arm's menu the system text was built from (TEACH-110 part f).
  const layoutsMenu = (k: string) =>
    k === "KS1" ? P.repairLayoutsKS1 : k === "KS2" ? P.repairLayoutsKS2 : P.repairLayoutsKS3_5;
  const baseVisuals = (k: string) =>
    k === "KS1" ? P.baseVisualsKS1 : k === "KS2" ? P.baseVisualsKS2 : P.baseVisualsKS3_5;

  const log = (e: object) => run.services.log(e);
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
  const relay = (i: number) => {
    const s = plan.slides[i];
    if (!s) return;
    const lay = () => materialise(s, { ...base, index: i, plan, visual: visualState(i) });
    // A drawn diagram carries its builds (Present shows its parts one per Next).
    if (!run.drawDiagrams) return void laid.set(i, lay());
    const m = withBuilds(lay);
    laid.set(i, { ...m, slide: withBuildCounts(m.slide) });
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
  const user = contextBlock(
    brief,
    run.objectives.map((t) => ({ teacher: t, pupil: "" })),
    P.user,
  );
  const stageKey = promptStage(brief.keyStage);
  // The library's catalogue goes after base4's diagram kinds, in the system text and the schema.
  // A library that fails to load is no library: the writer runs with base4's kinds only.
  const models =
    run.library && run.drawDiagrams
      ? await nonFatal(
          () => catalogue(stageKey),
          (e) => {
            log({ ev: "lib-catalogue-failed", err: String(e).slice(0, 200) });
            return [];
          },
        )
      : [];
  const activities = run.activities ?? ACTIVITIES_DEFAULT;
  const libbed = libSchema(
    writerSchema(stageKey, brief.slides, P, { objectives: run.objectives.length }),
    models.map((m) => m.id),
  );
  const schema = activities ? withActivities(libbed, stageKey) : libbed;
  const system = libSystem(writerSystem(brief, P), models);
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
      question: QUESTION_TEMPLATES.has(String(s.template ?? "")),
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
    const said = [
      moved.length ? `On the slide: ${moved.join(" ")}` : "",
      fitted.length ? `Moved off the slide to fit the diagram: ${fitted.join(" ")}` : "",
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
      const question = QUESTION_TEMPLATES.has(String(s.template ?? ""));
      const stop = new AbortController();
      diagramStops.set(i, [...(diagramStops.get(i) ?? []), stop]);
      /** Cancelled (its slide reopened) or the lesson failed: nothing more is drawn or kept. */
      const cancelled = () => stop.signal.aborted || run.signal?.aborted === true;
      const callDrawer: DrawerCall = (req) =>
        cancelled() ? Promise.reject(new Error("diagram job cancelled")) : drawer(req);
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
          const r = await libraryDiagram(
            {
              key: a.key,
              model: String(want.model ?? ""),
              intent: String(want.intent ?? a.shows),
              alt: typeof want.alt === "string" ? want.alt : undefined,
              words: wordsOf(s),
              heading: typeof s.heading === "string" ? s.heading : "",
              caption: typeof s.lead === "string" ? s.lead : "",
              yearGroup: brief.yearGroup,
              lesson: [brief.subject, brief.topic].filter(Boolean).join(": "),
              question,
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
              spec: { drawn: { src, aspect, alt, bare: true } },
            });
            log({ ev: "diagram-done", slide: i + 1, key: a.key, via: "library", ok: true });
            relay(i);
            shown(i);
            return undefined;
          }
          return { ...a, kind: r.fallbackKind, labels: [], spec: undefined };
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
            theme: base.theme,
            probe: layoutSlotProbe,
            log: (e) => log({ ...e, slide: i + 1 }),
          },
        ).then((r) => {
          if (cancelled()) return;
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
  /**
   * One written slide's work: no em dash, the activity's fields, the seeded hinge, the flow's
   * look, its asks (`onAsks` starts its pictures), its layout and its diagrams. Run as each slide
   * closes in the writer's stream (C1), in slide order, and at the end for any slide the stream
   * did not open: the final parse stays the source of truth.
   */
  const openSlide = (idx: number, raw: S) => {
    // No em dashes on slides.
    let s = slideNoEmDash(raw);
    if (run.figureText ?? FIGURE_TEXT_DEFAULT) {
      const f = figureTextFix(s);
      for (const c of f.changes)
        log({ ev: "figure-text", slide: idx + 1, key: c.key, kind: c.kind, action: c.action });
      s = f.slide as S;
    }
    // An activity: the writer's fields to the template's, repaired to the stage's capacity.
    if (isWriterActivity(s.template)) {
      const a = fromWriterActivity(s, stageKey, brief.subject);
      if (a.converted) log({ ev: "activity-dropped", slide: idx + 1, why: a.converted });
      else if (a.fixes.length) log({ ev: "activity-fixed", slide: idx + 1, fixes: a.fixes });
      s = a.slide;
    }
    // The hinge's correct option lands at a seeded, uniform position.
    s = shuffleHinge(s, `${brief.id}:${idx}:${String(s.stem ?? "")}`);
    // The flow's look is the writer's visual decision: a slide whose look names a picture but
    // which asks for none gets the picture from look's phrase.
    const look = lookOf(plan.flow?.find((x) => x.slide === idx + 1));
    const added = withLook(s, look);
    if (added.how) {
      log({ ev: "look-added", slide: idx + 1, how: added.how });
      s = added.slide;
    } else if (look && look.kind !== "none" && !asksVisual(s))
      log({ ev: "look-unmet", slide: idx + 1, kind: look.kind });
    plan.slides[idx] = s;
    asks.set(idx, visualsOf(s, idx, { ...base, plan }));
    run.onAsks?.(idx, asks.get(idx) ?? [], {
      heading: String(s.heading ?? ""),
      text: wordsOf(s as S),
      point: pointOf(s as S),
    });
    relay(idx);
    opened.set(idx, JSON.stringify(raw));
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
      return;
    }
    const idx = key === "title" ? 0 : key === "slides" && typeof k === "number" ? k + 2 : -1;
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
  const main = run.recordedWriter
    ? { usd: 0, ms: 0, ...run.recordedWriter }
    : await run.services.writer(
        {
          model: WRITER_MODEL,
          effort: WRITER_EFFORT,
          system: activities ? withActivityMenu(system, stageKey) : system,
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
        },
      );
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
  };
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
  const deck = (): WriterSlide[] => {
    const slides: WriterSlide[] = [];
    for (let i = 0; i < Math.max(n, 2); i++) {
      const own = slideAt(i);
      if (!own) continue;
      slides.push(own);
      for (const [k, c] of (continued.get(i) ?? []).entries())
        slides.push({ id: `s${i + 1}c${k + 1}`, ...c.slide, notes: "" });
    }
    return slides;
  };
  if (run.beforeEditable) {
    await run.beforeEditable();
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
  if (flags.duplicateLogOnly)
    for (const [i, f] of duplicates()) log({ ev: "duplicate-seen", slide: i + 1, fault: f });

  // ── objective coverage: one targeted repair when an objective has no teaching or checking slide ──
  const swapSlide = (i: number, next0: S) => {
    states.save(i, plan.slides[i]);
    // figureSync (BAKEOFF base4f, chalkie-gap Y5-B): a figure on a rewritten slide is re-checked
    // against the new words; kept when it agrees, redrawn from the words when it can be, dropped
    // otherwise.
    const sync = syncFigure(plan.slides[i] as S | undefined, slideNoEmDash(next0));
    if (sync.action === "redrawn" || sync.action === "drop")
      log({ ev: "figure-sync", slide: i + 1, action: sync.action, why: sync.why });
    const next = sync.action === "drop" ? asWords(sync.slide as S) : (sync.slide as S);
    const oldAsks = asks.get(i) ?? [];
    const oldCarried = new Map(oldAsks.map((a) => [a.key, carried.get(`${i}:${a.key}`)]));
    const oldState = new Map(oldAsks.map((a) => [a.key, visualState(i)(a.key)]));
    plan.slides[i] = next;
    const newAsks = visualsOf(next, i, { ...base, plan });
    asks.set(i, newAsks);
    for (const a of newAsks) {
      const was = oldAsks.find(
        (b) =>
          sameFigure({ type: b.type, shows: b.shows }, { type: a.type, shows: a.shows }) &&
          // the same request is not the same drawing: a spec that changed is drawn again
          (b.type !== "diagram" ||
            a.type !== "diagram" ||
            specKey((b as { spec?: unknown }).spec) === specKey(a.spec)),
      );
      // a drawing whose numbers the new words no longer say is never carried
      const v0 = was ? oldState.get(was.key) : undefined;
      const stale = v0?.status === "diagram" ? figureTextMismatch(v0.spec, next as S) : undefined;
      if (stale) log({ ev: "figure-stale", slide: i + 1, key: a.key, why: stale });
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
        const r = acceptWriterSpec(a.spec, ask, base.theme, layoutSlotProbe);
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
  if (plan.flow?.some((f) => Array.isArray(f.teaches)) && run.objectives.length > 0) {
    const res = await repairObjectives({
      plan: { flow: plan.flow, slides: plan.slides as S[] },
      objectives: run.objectives,
      context: user,
      system: P.objectiveRepair,
      schema: objectiveRepairSchema(repairSchemaFor(stageKey)),
      chat,
      log,
      onUsd: () => {},
      rules: coverageRules,
    });
    if (res.repaired) {
      plan.flow = res.plan.flow as Plan["flow"];
      for (let i = 2; i < n; i++)
        if (res.plan.slides[i] !== plan.slides[i]) swapSlide(i, res.plan.slides[i] as S);
      checks = check();
    }
  }

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
  if (flags.fallbackOnlyOnFailure) {
    for (const c of failing) {
      const i = c.slide - 1;
      const s0 = plan.slides[i] as S;
      if (s0.template !== "visual-text" || !c.faults.some((f) => f.startsWith("diagram:")))
        continue;
      const d = (asks.get(i) ?? []).find((a) => a.type === "diagram");
      if (!d || visualState(i)(d.key).status !== "diagram") continue;
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
      log({
        ev: "diagram-relaid",
        slide: i + 1,
        ok: !left.length,
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
    const faultLines = c.faults.map((f) => repairTerms(f, plan.slides[i], stageKey));
    // A restaging call is told its room in characters.
    if (mode !== "fit") {
      const room = roomLine(plan.slides[i], stageKey);
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
      schema: repairSchemaFor(stageKey),
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
      log({ ev: "repair", slide: i + 1, ok: false });
      return false;
    }
    const before = plan.slides[i] as S;
    o2.slide = keepAsksHonest(before, o2.slide);
    const moved = (Array.isArray(o2.to_notes) ? o2.to_notes : [o2.to_notes ?? ""]).map(String);
    // The pinned repair prompt may move one whole unit to the notes or split: it is judged by the
    // word-loss rule, not the fit-only rule.
    const verdict = judgeRepair(before, o2.slide, moved, {
      diagramFault: c.faults.some((f) => f.startsWith("diagram:")),
      fit: false,
      // A restaged slide may lose its figure and the words that pointed at it, never a question,
      // an item or the slide's other words.
      ...(mode !== "fit" ? { restage: true, exempt: ro.exempt ?? POINTING_WORDS } : {}),
    });
    const guarded = ro.guard?.(o2.slide);
    const why = [...(verdict.ok ? [] : verdict.why), ...(guarded ? [guarded] : [])];
    if (why.length) {
      log({ ev: "repair-rejected", slide: i + 1, mode, fix: o2.fix, why });
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
    const worse =
      mode !== "fit"
        ? now.some((f) => /^(dangling|unanswerable):/.test(f))
        : ro.keepPartial
          ? fresh.length > 0 || overflowPt(now) >= overflowPt(c.faults)
          : [...kinds(now)].some((k) => was.has(k)) || now.length > c.faults.length;
    if (worse) restore(i, before, n0, oldAsks);
    else if (c.faults.some((f) => f.startsWith("diagram:"))) path.set(i, "diagram-repaired");
    log({ ev: "repair", slide: i + 1, mode, ok: true, fix: o2.fix, reverted: worse });
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
      faults: [...left, "still over after one reword: cut the characters given above"],
    });
  };
  // In parallel, bounded: each repair reads and writes only its own slide. The replay matches each
  // call by the slide it sends, so it sees the same calls in any order.
  phaseSlides = [...plan.slides];
  await eachBounded(failing, TAIL_CONCURRENCY, async (c) => {
    await fitLoop(c);
  });
  phaseSlides = undefined;
  void charsOver;
  // gas8: a slide the one repair left impossible (or never repaired) gets the text-safe version,
  // every claimed gas volume scaled under the stated reactant's maximum by one factor for the
  // whole lesson, so volumes compared across slides keep their order.
  const gasHits = gasFaults(gasTexts());
  const gasAll = gasHits.flatMap((x) => x.volumes);
  for (const h of gasHits) {
    if (!repairable(plan.slides[h.slide] as S, h.slide)) continue;
    swapSlide(h.slide, rescaleGas(plan.slides[h.slide] as S, gasAll, h.vmax));
    const left = gasFaults(gasTexts()).some((x) => x.slide === h.slide);
    log({ ev: "gas8-fallback", slide: h.slide + 1, fault: h.fault, cleared: !left });
  }
  // figureSync: after repair, every drawn figure is checked against its slide's words; one that
  // disagrees is dropped, so the fallback below restages the slide without it.
  for (let i = 0; i < n; i++)
    for (const a of asks.get(i) ?? []) {
      const v = visualState(i)(a.key);
      if (a.type !== "diagram" || v.status !== "diagram") continue;
      const why = figureTextMismatch(v.spec, plan.slides[i] as S | undefined);
      if (!why) continue;
      log({ ev: "figure-text-mismatch", slide: i + 1, key: a.key, why, dropped: true });
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
    if (over().length) {
      const fits = (sl: S) => {
        const m = materialise(sl, {
          ...base,
          index: i,
          plan,
          visual: () => ({ status: "failed" }),
        });
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
      if (cont) {
        swapSlide(i, cont.first);
        continued.set(
          i,
          cont.rest.map((sl) => fits(sl).m),
        );
        log({ ev: "restage-fallback", slide: i + 1, mode, how: "strip-continued" });
        return "strip-continued";
      }
    }
    log({ ev: "restage-fallback", slide: i + 1, mode, how: "strip" });
    return "strip";
  };
  const fallback = async (i: number, fo: { noPicture?: boolean } = {}) => {
    const dAsk = (asks.get(i) ?? []).find((a) => a.type === "diagram") as
      | Extract<VisualAsk, { type: "diagram" }>
      | undefined;
    if (!dAsk || path.has(i)) return;
    const st = visualState(i)(dAsk.key).status;
    if (st === "pending") return;
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
    // A table is words already: one that cannot draw keeps its data as text lines.
    const t = tableRows(visualState(i)(dAsk.key), dAsk);
    if (dAsk.kind === "table" && t.rows.length && !flags.fixTableToText) {
      swapSlide(i, asTableText(s, t));
      path.set(i, "table-text");
      return;
    }
    const words = asWords(s);
    if (JSON.stringify(words) !== JSON.stringify(s)) swapSlide(i, words);
    path.set(i, `words-${await restage(i, dAsk, "stand-alone")}`);
  };
  const pictureLost = async (i: number) => {
    if (path.has(i) || i < 2) return;
    const lost = (asks.get(i) ?? []).find(
      (a): a is Extract<VisualAsk, { type: "photo" }> =>
        a.type === "photo" && !a.set && !a.fixedShape && visualState(i)(a.key).status === "failed",
    );
    if (!lost) return;
    // lostPic (BAKEOFF base4f): a library diagram of the same thing, then one picture per subject,
    // before any rewrite; the slide is restored unless every new visual lands (splitOk is not
    // ported: a partial split never ships).
    const s0 = plan.slides[i] as S;
    const n0 = notes.get(i);
    // Only a slide whose lost picture was its one visual (keepPic's rule): never over a figure,
    // tiles or a table that did land.
    const others = (asks.get(i) ?? [])
      .filter((a) => a.key !== lost.key)
      .map((a) => visualState(i)(a.key).status);
    const how0 = !heldPhotoFills(s0, others)
      ? undefined
      : await lostPictureFallback(s0, lost.key, lost.shows, async (next, kind) => {
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
          const ok = got && all.length > 0;
          log({ ev: "lost-picture", slide: i + 1, try: kind, ok });
          if (ok) {
            relay(i);
            return true;
          }
          restore(i, s0, n0, oldAsks);
          return false;
        });
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
    if (flags.pointGuardLogOnly)
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
  const settleSlide = async (i: number) => {
    await fallback(i);
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
  phaseSlides = [...plan.slides];
  await eachBounded(
    Array.from({ length: n }, (_, i) => i),
    TAIL_CONCURRENCY,
    settleSlide,
  );
  phaseSlides = undefined;
  for (const [i, p] of path) log({ ev: "visual-path", slide: i + 1, path: p });

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
  // Coverage by the written slides' templates, as the objective repair judges it (the summary
  // used to classify by `does` alone and read 0 while an objective was unchecked).
  const unmet = plan.flow
    ? coverage(plan.flow, run.objectives.length, (k) => plan.slides[k - 1]?.template as string, {
        ...coverageRules,
        slideOf: (k) => plan.slides[k - 1] as S | undefined,
      }).missing
    : [];
  if (unmet.length) log({ ev: "coverage-unmet", level: "warn", missing: unmet });
  log({ ev: "summary", textOnlyTeach, dangling: dangling.length, coverage: unmet.length });
  return {
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
