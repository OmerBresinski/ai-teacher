import type { Slide, Theme } from "@tj/domain/documents";
import { slotBox, slotOf, withBuilds } from "@tj/slides/diagrams";
import { getTheme } from "@tj/slides/themes";
import { BASE_KIND, catalogue, FALLBACK_KIND, libSchema, libSystem } from "../library/catalogue";
import { libraryDiagram } from "../library/fill";
import { pointOf, type SlideForPicture } from "../stages/picture-director";
import { type WriterBundleId, writerBundle } from "./bundle";
import { type CheckResult, checkSlide, duplicateFaults, slideNoEmDash } from "./checks";
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
  coverage,
  lessonNotes,
  notesText,
  objectiveRepairSchema,
  renderedLines,
  repairObjectives,
} from "./notes";
import { asksToSee, heldPhotoFills, orphansAfterFit, pastedPictureList } from "./picture-checks";
import { stripPointTasks } from "./point-guard";
import { writerSchema } from "./schema";
import {
  isFatal,
  nonFatal,
  SMALL_MODEL,
  WRITER_EFFORT,
  WRITER_MODEL,
  type WriterServices,
  whenNonFatal,
  writerMaxTokens,
} from "./services";

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
   * lostPic (BAKEOFF base4f): place more photo asks after editable (a lost compound picture asked
   * again one subject each) and wait for them; absent, the asks read `visual` as they are.
   */
  placeMore?: (index: number, asks: VisualAsk[], slide: SlideForPicture) => Promise<void>;
  /** keepPic: a photo match6 dropped from an ask slide, for a slide that ends with no visual. */
  held?: (index: number, key: string) => VisualState | undefined;
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
};
export type WriterSlide = Pick<Slide, "kind" | "elements" | "background"> & {
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

/** The writer's system text for the brief's stage, exactly as pinned (nothing appended). */
export function writerSystem(brief: Brief, P = writerBundle()): string {
  const k = promptStage(brief.keyStage);
  return k === "KS1" ? P.systemKS1 : k === "KS2" ? P.systemKS2 : P.systemKS3_5;
}

export async function runWriter(run: WriterRun): Promise<WriterOutput> {
  const { brief } = run;
  const P = writerBundle(run.bundle);
  const repairSchemaFor = (k: string) =>
    JSON.parse(
      k === "KS1" ? P.repairSchemaKS1 : k === "KS2" ? P.repairSchemaKS2 : P.repairSchemaKS3_5,
    );
  const layoutsMenu = (k: string) =>
    k === "KS1" ? P.layoutsKS1 : k === "KS2" ? P.layoutsKS2 : P.layoutsKS3_5;
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
  const notes = new Map<number, { notes: string; answers: string[] }>();
  /** A repaired slide keeps the visual of a figure it still asks for, under its new key. */
  const carried = new Map<string, { key: string; ask: VisualAsk }>();
  /** Diagrams drawn in this run, by `<slide>:<key>` (TEACH-247). */
  const drawnDiagrams = new Map<string, VisualState>();
  /** States code decided after the fact (match6 kept photo, orphan6, a stale drawing), by key. */
  const override = new Map<string, VisualState>();
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
  const schema = libSchema(
    writerSchema(stageKey, brief.slides, P),
    models.map((m) => m.id),
  );
  const main = run.recordedWriter
    ? { usd: 0, ms: 0, ...run.recordedWriter }
    : await run.services.writer(
        {
          model: WRITER_MODEL,
          effort: WRITER_EFFORT,
          system: libSystem(writerSystem(brief, P), models),
          user: localise(user),
          schema,
          name: "lesson",
          maxTokens: writerMaxTokens(brief.slides.max),
        },
        () => {},
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
  plan.design = out.design;
  plan.flow = out.flow;
  const written: [number, S][] = [
    ...(out.title ? ([[0, out.title]] as [number, S][]) : []),
    ...(out.slides ?? []).map((s, k): [number, S] => [k + 2, s]),
  ];
  for (const [idx, raw] of written) {
    // No em dashes on slides.
    let s = slideNoEmDash(raw);
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
  }
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
  // ── diagrams (TEACH-247, R2): every diagram asked for, drawn before editable ──
  if (run.drawDiagrams) {
    const { callDrawer } = run.drawDiagrams;
    const jobs: Promise<void>[] = [];
    for (const [i, list] of asks)
      for (const a of list) {
        const s = plan.slides[i];
        if (a.type !== "diagram" || !s) continue;
        const slot = slotOf(String(s.template ?? ""));
        const box = slotBox(base.stage, slot);
        const question = QUESTION_TEMPLATES.has(String(s.template ?? ""));
        jobs.push(
          nonFatal(
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
              if (r.ok) {
                const { src, aspect, alt } = r.drawing;
                drawnDiagrams.set(`${i}:${a.key}`, {
                  status: "diagram",
                  spec: { drawn: { src, aspect, alt, bare: true } },
                });
                log({ ev: "diagram-done", slide: i + 1, key: a.key, via: "library", ok: true });
                relay(i);
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
            if (!a2) return;
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
              drawnDiagrams.set(
                `${i}:${a.key}`,
                r.spec ? { status: "diagram", spec: r.spec } : { status: "failed" },
              );
              log({ ev: "diagram-done", slide: i + 1, key: a.key, via: r.via, ok: !!r.spec });
              relay(i);
            });
          }),
        );
      }
    await Promise.all(jobs);
  }
  const n = plan.slides.length;
  /** Continuation slides laid after slide i (a last-resort strip's overflowing items). */
  const continued = new Map<number, Materialised[]>();
  const deck = (): WriterSlide[] => {
    const slides: WriterSlide[] = [];
    for (let i = 0; i < Math.max(n, 2); i++) {
      const m = laid.get(i) ?? (i === 0 ? title : undefined);
      if (!m) continue;
      const own = notes.get(i)?.notes ?? "";
      const moved = modelPoints(plan.slides[i] as S | undefined).filter(
        (p) => p && !own.includes(p),
      );
      const said = moved.length ? `On the slide: ${moved.join(" ")}` : "";
      slides.push({ id: `s${i + 1}`, ...m.slide, notes: [own, said].filter(Boolean).join("\n\n") });
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
  await run.onEditable?.(deck());

  // ── pupil wording: one small call after editable fills slide 2; any line missing keeps the
  // teacher's wording, so slide 2 is never short ──
  if (run.pupilWording !== false) {
    const objectives = plan.objectives ?? [];
    const r = await chat({
      model: SMALL_MODEL,
      effort: "low",
      system: P.pupilObjectives,
      user: fillTemplate(P.pupilObjectivesUser, brief, {
        objectives,
        maxWords: pupilWordLimit(brief.keyStage, objectives.length),
      }),
      schema: JSON.parse(P.pupilObjectivesSchema),
      name: "pupil_objectives",
      maxTokens: 1500,
    }).catch(
      whenNonFatal((e) => {
        log({ ev: "pupil-objectives-error", err: String(e).slice(0, 200) });
        return undefined;
      }),
    );
    const lines = (r?.out as { pupil?: unknown[] } | undefined)?.pupil ?? [];
    objectives.forEach((o, k) => {
      const line = lines[k];
      if (typeof line === "string" && line.trim()) o.pupil = line.trim();
    });
    laid.set(1, codeObjectives({ ...base, index: 1, plan }));
  }

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
  const check = () => {
    const res = baseCheck();
    // A slide that repeats another goes to repair to be made different or merged.
    const dup = duplicateFaults(
      Array.from({ length: n }, (_, i) => i)
        .filter((i) => repairable(plan.slides[i] as S, i))
        .map((i) => {
          const sl = plan.slides[i] as S;
          return { index: i, heading: String(sl.heading ?? ""), words: wordsOf(sl) };
        }),
    );
    for (const [i, f] of dup) res[i]?.faults.push(f);
    // gas8 (BAKEOFF base4f): practical data the lesson's own stated quantities cannot give.
    for (const h of gasFaults(gasTexts()))
      if (repairable(plan.slides[h.slide] as S, h.slide)) res[h.slide]?.faults.push(h.fault);
    return res;
  };
  const gasTexts = () =>
    Array.from({ length: n }, (_, i) => (plan.slides[i] ? wordsOf(plan.slides[i] as S) : ""));
  let checks = check();
  log({ ev: "checks", failing: checks.filter((c) => c.faults.length).length });

  // ── objective coverage: one targeted repair when an objective has no teaching or checking slide ──
  const swapSlide = (i: number, next0: S) => {
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
          ev: r.spec ? "r2-spec-drawn" : "r2-spec-fault",
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
  const failing = checks
    .map((c) => ({ ...c, faults: c.faults.filter((f) => !VISUAL_DANGLING.test(f)) }))
    .filter((c) => c.faults.length > 0 && repairable(plan.slides[c.slide - 1] as S, c.slide - 1));
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
    if (n0) notes.set(i, n0);
    else notes.delete(i);
    asks.set(i, oldAsks);
    relay(i);
  };
  const diagramKinds = () =>
    baseVisuals(stageKey)
      .match(/Diagram kinds:[\s\S]*?(?=\n\s*\n|$)/)?.[0]
      .trim() ?? "";
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
    if (mode === "fit") {
      const orphans = orphansAfterFit(o2.slide, moved);
      const keep = orphans.length > 0 && asksToSee(wordsOf(o2.slide));
      if (keep) log({ ev: "keep-pic", slide: i + 1, rule: "orphan6", orphans });
      if (orphans.length && !keep) {
        o2.slide = { ...o2.slide, picture: null };
        override.set(`${i}:picture`, { status: "failed" });
        log({ ev: "orphan6-drop", slide: i + 1, orphans, moved });
      }
    }
    const n0 = notes.get(i);
    const oldAsks = asks.get(i) ?? [];
    swapSlide(i, o2.slide);
    applyRepair(plan.slides, notes, i, r?.out);
    const now = (check()[i]?.faults ?? []).filter((f) => n0 || !f.startsWith("unanswered"));
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
  // One at a time, in slide order: the replay and the live run see the same order.
  for (const c of failing) await fitLoop(c);
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
      if ((asks.get(i) ?? []).some((a) => visualState(i)(a.key).status === "photo")) {
        path.set(i, "picture");
        return;
      }
      restore(i, s, n0, oldAsks);
    }
    // A table is words already: one that cannot draw keeps its data as text lines.
    const t = tableRows(visualState(i)(dAsk.key), dAsk);
    if (dAsk.kind === "table" && t.rows.length) {
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
    const how0 = await lostPictureFallback(s0, lost.key, lost.shows, async (next, kind) => {
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
  for (let i = 0; i < n; i++) await fallback(i);
  const beforeLost = new Map(Array.from({ length: n }, (_, i) => [i, plan.slides[i]] as const));
  const asksBeforeLost = new Map(
    Array.from({ length: n }, (_, i) => [i, asks.get(i) ?? []] as const),
  );
  for (let i = 0; i < n; i++) await pictureLost(i);
  // keepPic (BAKEOFF base4f, fill-only): a photo match6 dropped from an ask slide fills the slide
  // only when it ended with no visual at all (no landed picture or diagram, no table); it never
  // replaces one a fallback made, and never overflows.
  for (let i = 0; i < n; i++)
    for (const a of asksBeforeLost.get(i) ?? []) {
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
      swapSlide(i, beforeLost.get(i) as S);
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
  // pointGuard (BAKEOFF base4f, D47): the code backstop. A slide that still points at nothing
  // (its picture lost, its rewrite still dangling) loses each pointing sentence and every question
  // about a lettered or left/right shape; "Answer from memory." where a task is left. The title
  // slide too. A strip that leaves the slide dangling is undone. (The lab ran its stand-alone
  // rewrite first; this stage has no stand-alone pass, so the strip is the only step.)
  const DANGLING = /^dangling:/;
  for (let i = 0; i < n; i++) {
    const s = plan.slides[i] as S | undefined;
    if (!s || (i > 0 && !repairable(s, i))) continue;
    if (!check()[i]?.faults.some((f) => DANGLING.test(f))) continue;
    const { slide: stripped, removed } = stripPointTasks(s);
    if (!removed.length) continue;
    const n0 = notes.get(i);
    const oldAsks = asks.get(i) ?? [];
    swapSlide(i, stripped);
    const left = check()[i]?.faults.some((f) => DANGLING.test(f));
    if (left) restore(i, s, n0, oldAsks);
    log({ ev: "point-guard", slide: i + 1, removed, how: left ? "left" : "point-strip" });
  }
  for (const [i, p] of path) log({ ev: "visual-path", slide: i + 1, path: p });

  // ── notes: one call on the final slides as shown, only placed visuals listed ──
  const placedLines = (i: number) =>
    (asks.get(i) ?? []).flatMap((a) => {
      const v = visualState(i)(a.key);
      if (v?.status === "photo") return [`Picture: ${v.photo.alt || a.shows}`];
      if (v?.status === "diagram" && a.type === "diagram")
        return [`Diagram (${a.kind}): ${(a.labels ?? []).join(", ")}`];
      return [];
    });
  const lines = Array.from({ length: n }, (_, i) => i)
    .filter((i) => i >= 2)
    .map((i) => renderedLines(i + 1, (laid.get(i)?.slide.elements ?? []) as never, placedLines(i)))
    .join("\n\n");
  const got = await lessonNotes({
    slides: n,
    first: 3,
    system: P.notes,
    user: fillTemplate(P.notesUser, brief, {
      objectives: plan.objectives,
      context: user,
      slidesAsShown: lines,
    }),
    schema: JSON.parse(P.notesSchema),
    chat,
    log,
    onUsd: () => {},
  });
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
  log({
    ev: "summary",
    textOnlyTeach,
    dangling: dangling.length,
    coverage: plan.flow
      ? coverage(plan.flow, run.objectives.length, () => undefined).missing.length
      : 0,
  });
  return {
    slides: deck(),
    plan,
    checks,
    title: String((plan.slides[0] as S | undefined)?.heading ?? brief.topic),
    writer: { usd: main.usd, ms: main.ms, finishReason: main.finishReason ?? null },
    summary: { textOnlyTeach, dangling },
  };
}
