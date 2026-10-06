// BAKEOFF shared harness: one streamed planning call, slides materialised as they complete, pictures
// and diagrams in parallel, notes per slide, code checks, one bounded repair, timings and cost.
// The layout step is an `ArmPlugin` (arm T: templates; K: blocks + recipes; R: reference slides).
// See BAKEOFF/HARNESS.md.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Slide, Theme } from "@tj/domain/documents";
import { renderDiagram } from "../../packages/slides/src/diagrams/index";
import { FIT_VERSION, getTheme, withKeyStage } from "../../packages/slides/src/themes";
import { type CheckResult, checkSlide } from "./checks";
import { PartialJson, type Path } from "./partial";
import { concrete, judgeRepair, repairable, sameFigure, teaching } from "./repair";
import {
  aspectOf,
  BAKEOFF,
  chat,
  chatStream,
  type DiagramAsk,
  diagramSpec,
  guarded,
  Ledger,
  type PhotoAsk,
  type PhotoResult,
  pictureService,
  replayStream,
  STEP_EST,
  writeJson,
} from "./services";

/* ------------------------------------------------------------------ */
/* Types: brief, plugin                                                */
/* ------------------------------------------------------------------ */

export type Stage = "ks1" | "ks2" | "ks3" | "ks4" | "ks5";
export type Brief = {
  id: string;
  topic: string;
  subject: string;
  yearGroup: string;
  year: number;
  keyStage: Stage;
  theme: "splash" | "studio";
  readingLevel: string;
  language: string;
  durationMin: number;
  exitTicketOnSlides: boolean;
  tier: "standard";
  slides: { min: number; max: number };
  /** A theme the teacher chose: it wins over the design call's `design.theme`. */
  teacherTheme?: string;
};

/** A visual a slide asks for, as the plugin reads it off the slide JSON. */
export type VisualAsk =
  | {
      key: string;
      type: "photo";
      shows: string;
      mustSee: string[];
      named: boolean;
      /** The slot's width / height, so search prefers that shape and generation renders at it. */
      aspect?: number;
      /** The slot crops to its own box (compare cards, sequences): the flow's early job (no aspect) does not take it. */
      fixedShape?: boolean;
      /** Pictures meant to be compared on one slide (a sequence, compare cards) share an id: made together. */
      set?: string;
      /** The set shows one subject at stages (false: different things compared). */
      sameSubject?: boolean;
    }
  | { key: string; type: "diagram"; kind: string; shows: string; labels: string[] };

/** What the harness knows about one visual when it materialises a slide. */
export type VisualState =
  | { status: "pending" }
  | { status: "failed" }
  | { status: "photo"; photo: PhotoResult }
  | { status: "diagram"; spec: unknown };

export type MaterialiseCtx = {
  brief: Brief;
  theme: Theme;
  stage: Stage;
  index: number;
  /** The whole streamed output so far (objectives, flow, slides done). */
  plan: Plan;
  /** Visual states by key (keys as the plugin's `visuals` returned them for this slide). */
  visual: (key: string) => VisualState;
};
export type Materialised = {
  slide: Pick<Slide, "kind" | "elements" | "background">;
  /** Over-capacity marks from the layout (text over its zone, a diagram that would not draw). */
  over: string[];
  /** Round 2: why a diagram on the slide could not draw (the slide was laid out words only). */
  diagram?: string[];
};

export type Design = { theme?: string; picture_style?: "photo" | "illustration" };
export type FlowEntry = {
  slide: number;
  does: string;
  look_at?: { kind: string; shows: string | null };
};
export type Plan = {
  design?: Design;
  objectives?: { teacher: string; pupil: string }[];
  flow?: { slide: number; does: string; look_at?: { kind: string; shows: string | null } }[];
  slides: (Record<string, unknown> | undefined)[];
};

export interface ArmPlugin {
  id: string;
  /** System prompt, strict JSON schema, model and effort for the one planning call. */
  prompt(brief: Brief): {
    system: string;
    schema: object;
    model: string;
    effort?: "minimal" | "low" | "medium" | "high";
  };
  /** The visuals one finished slide asks for (keys unique within the slide, e.g. "picture", "seq.2"). */
  visuals(
    slide: Record<string, unknown>,
    index: number,
    ctx: Omit<MaterialiseCtx, "index" | "visual">,
  ): VisualAsk[];
  /** Lay one slide out from its JSON and the visuals' current states. Called again whenever a visual lands. */
  materialise(slide: Record<string, unknown>, ctx: MaterialiseCtx): Materialised;
  /** The questions on a slide (for the answerable check and the notes' answers). */
  questions(slide: Record<string, unknown>): string[];
  /** The slide's own words (for checks, the picture director and the diagram spec call). */
  words(slide: Record<string, unknown>): string;
  /** Round 2: the slide with its failed diagram turned into a picture request of the same thing (or undefined). */
  asPicture?(slide: Record<string, unknown>): Record<string, unknown> | undefined;
  /** Optional: a provisional slide from its flow entry alone (Greg 6 Oct, decision a), replaced when its content arrives. */
  placeholder?(flow: FlowEntry, ctx: Omit<MaterialiseCtx, "visual">): Materialised;
  /** Optional: the objectives slide from approved objectives (two-phase runs), before the design call answers. */
  codeObjectives?(ctx: Omit<MaterialiseCtx, "visual">): Materialised;
  /** Optional: the prompt files' stage key (T: KS1 | KS2 | KS3-5; R: KS1 | KS2 | KS3-4 | KS5). */
  promptStage?(brief: Brief): string;
  /** Optional: the title slide made in code from the brief before the call returns anything. */
  codeTitle?(brief: Brief, ctx: Omit<MaterialiseCtx, "index" | "plan" | "visual">): Materialised;
}

/* ------------------------------------------------------------------ */
/* Context block (the main call's user turn)                           */
/* ------------------------------------------------------------------ */

/** lesson-objectives.ts `objectiveCount`, at the middle of the brief's slide range. */
export function objectiveCount(b: Brief): string {
  const n = Math.round((b.slides.min + b.slides.max) / 2);
  return n <= 7 ? "one or two" : n <= 11 ? "two or three" : "three or four";
}

export type FillExtras = {
  objectives?: { teacher: string; pupil: string }[];
  context?: string;
  [k: string]: unknown;
};
/**
 * Fills one of the prompt agent's user-turn templates (prompts/shared/*.txt, prompts/<arm>/*): brief
 * fields ({{topic}}, {{slides.min}}), {{flag ? "a" : "b"}}, the objective count, the approved
 * objectives as numbered lines, {{context block…}}, and any extra named block ({{objectives}} as JSON).
 */
export function fillTemplate(text: string, b: Brief, x: FillExtras = {}): string {
  const get = (path: string): unknown =>
    path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], b);
  return text.trim().replace(/\{\{([^}]+)\}\}/g, (_, raw: string) => {
    const expr = raw.trim();
    const t = expr.match(/^([\w.]+)\s*\?\s*"([^"]*)"\s*:\s*"([^"]*)"$/);
    if (t) return get(t[1] as string) ? (t[2] as string) : (t[3] as string);
    if (expr.startsWith("count:") && expr.includes("objectiveCount")) return objectiveCount(b);
    if (expr.startsWith("for each objective"))
      return (x.objectives ?? [])
        .map((o, k) => `${k + 1}. Teacher: ${o.teacher} | Pupils: ${o.pupil}`)
        .join("\n");
    if (expr.startsWith("context block")) return x.context ?? "";
    if (expr === "objectives") return JSON.stringify({ objectives: x.objectives ?? [] }, null, 1);
    if (expr in x) return String(x[expr]);
    const v = get(expr);
    if (v === undefined) throw new Error(`template: no value for {{${expr}}}`);
    return String(v);
  });
}

/** The main call's user turn: prompts/shared/user.txt filled (with the approved objectives in two-phase runs), else a plain field list. */
export function contextBlock(b: Brief, objectives?: { teacher: string; pupil: string }[]): string {
  const f = `${BAKEOFF}/prompts/shared/user.txt`;
  if (existsSync(f)) return fillTemplate(readFileSync(f, "utf8"), b, { objectives });
  return [
    `Topic: ${b.topic}`,
    `Subject: ${b.subject}`,
    `Year group: ${b.yearGroup} (${b.keyStage})`,
    `Reading level: ${b.readingLevel}`,
    `Language: ${b.language}`,
    `Lesson length: ${b.durationMin} minutes`,
    `Slides: ${b.slides.min} to ${b.slides.max}`,
    `Exit ticket: ${b.exitTicketOnSlides ? "on the last slide" : "on the worksheet, not the slides"}`,
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* Run                                                                 */
/* ------------------------------------------------------------------ */

export type RunOpts = {
  arm: ArmPlugin;
  brief: Brief;
  outDir: string;
  capUsd: number;
  pgPort: number;
  /** Play a recorded main output back instead of calling the model (no spend on the main call). */
  replay?: string;
  /** Round 2: answer the repair from a recorded repair.jsonl (slide -> out) instead of calling it. */
  replayRepair?: string;
  /** Skip pictures and diagrams (layout-only dry run). */
  noVisuals?: boolean;
  /** Reuse the pictures of an earlier run dir of the same replayed stream (offline re-layout; no spend). */
  reuseVisuals?: string;
  /** With reuseVisuals: these slides (1-based) fetch their pictures afresh; the rest reuse. */
  freshSlides?: number[];
  /** `generate`: every generic picture made in the house photo look (side-by-side B). */
  generic?: "stock-first" | "generate";
  /** Skip the notes calls. */
  noNotes?: boolean;
  /** Skip the repair pass. */
  noRepair?: boolean;
  /** Let `design.theme` restyle the lesson. Off in the bake-off: every arm renders on the brief's fixed theme and the choice is only recorded. */
  modelTheme?: boolean;
  /** The run's picture-generation cap (bank), default $0.06. */
  bankCapUsd?: number;
};

export type RunResult = {
  lessonFile: string;
  timings: Record<string, number>;
  cost: Record<string, number>;
  checks: CheckResult[];
};

export async function runLesson(o: RunOpts): Promise<RunResult> {
  const { arm, brief } = o;
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  const timings: Record<string, number> = {};
  const mark = (k: string) => {
    if (timings[k] === undefined) timings[k] = ms();
  };
  const logFile = `${o.outDir}/log.jsonl`;
  writeJson(`${o.outDir}/brief.json`, brief);
  const log = (e: object) => appendFileSync(logFile, `${JSON.stringify({ ms: ms(), ...e })}\n`);
  const ledger = new Ledger(o.capUsd);
  let themeId: string = brief.teacherTheme ?? brief.theme;
  const base = {
    brief,
    theme: withKeyStage(brief.keyStage, () => getTheme(themeId, brief.keyStage)),
    stage: brief.keyStage,
  };
  const plan: Plan = { slides: [] };
  const lessonId = `bakeoff-${arm.id}-${brief.id}`;
  const lessonFile = `${o.outDir}/lesson.json`;

  // ── state ──
  const visuals = new Map<string, VisualState>();
  const asks = new Map<number, VisualAsk[]>();
  const laid = new Map<number, Materialised>();
  const notes = new Map<number, { notes: string; answers: string[] }>();
  let title: Materialised | undefined;
  let flowSeen = 0;

  const save = (why: string) => {
    const slides: Slide[] = [];
    const n = Math.max(plan.slides.length, plan.flow?.length ?? 0, flowSeen, 1);
    for (let i = 0; i < n; i++) {
      const m = laid.get(i) ?? (i === 0 ? title : undefined);
      if (!m) continue;
      slides.push({ id: `s${i + 1}`, ...m.slide, notes: notes.get(i)?.notes ?? "" } as Slide);
    }
    stampPictureSources(slides, visuals);
    writeJson(lessonFile, {
      version: 1,
      id: lessonId,
      title: (plan.slides[0]?.heading as string) ?? brief.topic,
      themeId,
      // The web view re-fits (shrinks) text in any lesson without the current fit version (arm K's find).
      fitVersion: FIT_VERSION,
      subject: brief.subject,
      ageBand: brief.keyStage,
      yearGroup: brief.yearGroup,
      language: brief.language,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      slides,
      bakeoff: { arm: arm.id, brief: brief.id, objectives: plan.objectives ?? [] },
    });
    log({ ev: "save", why, slides: slides.length });
  };

  const relay = (i: number, why: string) => {
    const s = plan.slides[i];
    if (!s) return;
    const visual = (key: string) =>
      visuals.get(`${i}:${key}`) ?? ({ status: o.noVisuals ? "failed" : "pending" } as VisualState);
    const m = withKeyStage(brief.keyStage, () =>
      arm.materialise(s, { ...base, index: i, plan, visual }),
    );
    laid.set(i, m);
    save(`${why} s${i + 1}`);
  };

  // ── a. title in code ──
  if (arm.codeTitle) {
    title = withKeyStage(brief.keyStage, () => arm.codeTitle?.(brief, base));
    save("code title");
    mark("title");
  }

  // ── visuals ──
  const reused = o.reuseVisuals ? reusedPhotos(o.reuseVisuals) : undefined;
  const reusedDia = o.reuseVisuals ? reusedDiagrams(o.reuseVisuals) : undefined;
  const specsFile = `${o.outDir}/diagram-specs.json`;
  const reusedSpecs =
    o.reuseVisuals && existsSync(specsFile)
      ? (JSON.parse(readFileSync(specsFile, "utf8")) as Record<string, unknown>)
      : undefined;
  const pics =
    o.noVisuals || (reused && !o.freshSlides?.length)
      ? undefined
      : pictureService({
          runDir: o.outDir,
          pgPort: o.pgPort,
          ledger,
          bankCapUsd: o.bankCapUsd ?? 0.06,
          ...(o.generic ? { generic: o.generic } : {}),
          styleOf: () => ({
            style: plan.design?.picture_style,
            palette: [
              base.theme.colors.accent,
              base.theme.colors.accent2,
              base.theme.colors.background,
              base.theme.colors.ink,
            ],
          }),
        });
  if (pics) ledger.outside = pics.aiSpend;
  const jobs: Promise<void>[] = [];
  const lessonInfo = {
    id: lessonId,
    title: brief.topic,
    yearGroup: brief.yearGroup,
    subject: brief.subject,
    base: {} as Record<string, unknown>,
  };
  /** Early picture jobs from the flow, keyed by slide index; a slide's single picture takes it over. */
  const early = new Map<number, Promise<PhotoResult | undefined>>();
  const startPhoto = (
    i: number,
    a: Extract<VisualAsk, { type: "photo" }>,
    words: { heading: string; text: string },
  ) => {
    const k = `${i}:${a.key}`;
    const fresh = o.freshSlides?.includes(i + 1);
    if (reused && !fresh) {
      // The flow's early job stands for the slide's first picture (it takes the job over).
      const first = [...reused.keys()].find(
        (x) => x.startsWith(`${i}:`) && !x.includes("seq.") && !x.includes("col."),
      );
      return Promise.resolve(reused.get(a.key === "early" && first ? first : k));
    }
    if (!pics) return;
    visuals.set(k, { status: "pending" });
    const ask: PhotoAsk = {
      key: k,
      shows: a.shows,
      mustSee: a.mustSee,
      named: a.named,
      ...(a.aspect ? { aspect: a.aspect } : {}),
      ...(a.fixedShape ? { fixedShape: true } : {}),
      ...(plan.design?.picture_style ? { style: plan.design.picture_style } : {}),
      slide: { heading: words.heading, text: words.text, point: "" },
      index: i,
    };
    log({ ev: "picture-start", key: k, shows: a.shows, aspect: a.aspect });
    return pics.find(ask, lessonInfo);
  };
  const startSet = (
    i: number,
    group: Extract<VisualAsk, { type: "photo" }>[],
    words: { heading: string; text: string },
  ) => {
    if (reused && !o.freshSlides?.includes(i + 1))
      return Promise.resolve(group.map((a) => reused.get(`${i}:${a.key}`)));
    if (!pics) return;
    const asks: PhotoAsk[] = group.map((a) => {
      const k = `${i}:${a.key}`;
      visuals.set(k, { status: "pending" });
      log({ ev: "picture-start", key: k, shows: a.shows, aspect: a.aspect, set: a.set });
      return {
        key: k,
        shows: a.shows,
        mustSee: a.mustSee,
        named: a.named,
        ...(a.aspect ? { aspect: a.aspect } : {}),
        ...(a.fixedShape ? { fixedShape: true } : {}),
        ...(a.sameSubject === false ? { sameSubject: false } : {}),
        ...(plan.design?.picture_style ? { style: plan.design.picture_style } : {}),
        slide: { heading: words.heading, text: words.text, point: "" },
        index: i,
      };
    });
    return pics.findSet(asks, lessonInfo);
  };
  const landPhoto = (i: number, key: string, p: Promise<PhotoResult | undefined>) =>
    jobs.push(
      // A picture job never throws into the run (round 2): a failure is a failed picture.
      p
        .catch((e) => {
          log({ ev: "picture-error", key: `${i}:${key}`, err: String(e).slice(0, 200) });
          return undefined;
        })
        .then((r) => {
          visuals.set(`${i}:${key}`, r ? { status: "photo", photo: r } : { status: "failed" });
          // One picture at most once per lesson unless the same request asks for it (K's y1 smoke:
          // the title photo came back on another slide). The later slide loses it and falls back.
          for (const k of repeatedPictures(visuals)) {
            visuals.set(k, { status: "failed" });
            log({ ev: "picture-duplicate", key: k });
            relay(Number(k.split(":")[0]), "picture");
          }
          log({
            ev: "picture-done",
            key: `${i}:${key}`,
            ok: !!r,
            src: r?.src,
            provider: r?.provider,
            ...(r ? { id: pictureId(r), style: r.style ?? "photo" } : {}),
            ...(r?.period ? { period: r.period } : {}),
          });
          mark("lastPicture");
          timings.lastPicture = ms();
          relay(i, "picture");
        }),
    );
  const startDiagram = (
    i: number,
    a: Extract<VisualAsk, { type: "diagram" }>,
    words: string,
    heading = "",
  ) => {
    const k = `${i}:${a.key}`;
    if (reusedDia) {
      // Offline re-layout: the drawing the earlier run placed on this slide (no spec call).
      // Round 1: a recorded spec (`<outDir>/diagram-specs.json`, slide index -> spec) is drawn
      // again through drawDiagram instead of reusing the old SVG, so the offline re-layout
      // exercises the live diagram path (a spec that cannot draw readably falls back to words).
      const spec = reusedSpecs?.[String(i)];
      const d = reusedDia.get(i);
      visuals.set(
        k,
        spec
          ? { status: "diagram", spec }
          : d
            ? { status: "diagram", spec: { drawn: d } }
            : { status: "failed" },
      );
      log({ ev: "diagram-done", key: k, ok: !!d, reused: true });
      relay(i, "diagram");
      return;
    }
    visuals.set(k, { status: "pending" });
    const ask: DiagramAsk = {
      key: k,
      kind: a.kind,
      shows: a.shows,
      labels: a.labels,
      words,
      yearGroup: brief.yearGroup,
    };
    log({ ev: "diagram-start", key: k, kind: a.kind });
    jobs.push(
      diagramSpec(ask, ledger, log)
        .catch((e) => {
          log({ ev: "diagram-error", key: k, err: String(e).slice(0, 200) });
          return undefined;
        })
        .then((raw) => {
          const spec = raw && dropEchoTitle(raw, heading);
          visuals.set(k, spec ? { status: "diagram", spec } : { status: "failed" });
          log({ ev: "diagram-done", key: k, ok: !!spec });
          timings.lastDiagram = ms();
          relay(i, "diagram");
        }),
    );
  };

  // ── b. the streamed planning call ──
  const onValue = (path: Path, v: unknown) => {
    const [top, idx] = path;
    if (top === "design" && path.length === 1) {
      plan.design = v as Design;
      applyDesign();
    }
    if (top === "objectives" && path.length === 1 && !twoPhase) {
      plan.objectives = v as Plan["objectives"];
      // The picture stock path judges photos against the lesson's objectives (illustrate.ts).
      lessonInfo.base = {
        facts: {
          objectives: (plan.objectives ?? []).map((x, k) => ({ id: `o${k + 1}`, text: x.teacher })),
          outline: [],
        },
      };
      log({ ev: "objectives", n: plan.objectives?.length });
      mark("objectives");
    }
    // Each flow entry starts its slide's picture the moment it closes (smoke 2: the whole flow took
    // 22 s to stream, so waiting for it delayed the first pictures by up to that much).
    if (top === "flow" && path.length === 2) {
      const f = v as NonNullable<Plan["flow"]>[number];
      const i = f.slide - 1;
      flowSeen = Math.max(flowSeen, i + 1);
      // Decision a: the slide appears from its flow entry at once, provisional until its content arrives.
      if (arm.placeholder && i >= 2 && !laid.has(i)) {
        laid.set(
          i,
          withKeyStage(
            brief.keyStage,
            () => arm.placeholder?.(f, { ...base, index: i, plan }) as Materialised,
          ),
        );
        save(`placeholder s${i + 1}`);
        mark("firstPlaceholder");
      }
      if (f.look_at?.kind === "picture" && f.look_at.shows && i > 0 && !early.has(i)) {
        const p = startPhoto(
          i,
          { key: "early", type: "photo", shows: f.look_at.shows, mustSee: [], named: false },
          { heading: f.does, text: "" },
        );
        if (p) early.set(i, p);
      }
    }
    if (top === "flow" && path.length === 1) {
      plan.flow = v as Plan["flow"];
      mark("flow");
      log({ ev: "flow", n: plan.flow?.length });
    }
    if (top === "slides" && path.length === 2 && typeof idx === "number") {
      const s = v as Record<string, unknown>;
      plan.slides[idx] = s;
      const as = withKeyStage(brief.keyStage, () => arm.visuals(s, idx, { ...base, plan }));
      asks.set(idx, as);
      const words = arm.words(s);
      const heading = String(s.heading ?? "");
      const photos = as.filter(
        (a): a is Extract<VisualAsk, { type: "photo" }> => a.type === "photo",
      );
      const e = early.get(idx);
      // Same-subject sets are made together (one strip, one subject); the rest one by one.
      const sets = new Map<string, Extract<VisualAsk, { type: "photo" }>[]>();
      for (const a of photos) if (a.set) sets.set(a.set, [...(sets.get(a.set) ?? []), a]);
      for (const group of sets.values()) {
        if (group.length < 2) continue;
        const all = startSet(idx, group, { heading, text: words });
        if (all)
          for (const [n, a] of group.entries())
            landPhoto(
              idx,
              a.key,
              all.then((r) => r[n]),
            );
      }
      photos.forEach((a, n) => {
        if (a.set && (sets.get(a.set)?.length ?? 0) >= 2 && (pics || reused)) return;
        // The slide's first picture takes over the flow's early job (already running).
        if (n === 0 && e && !a.fixedShape) {
          visuals.set(`${idx}:${a.key}`, { status: "pending" });
          landPhoto(idx, a.key, e);
          return;
        }
        const p = startPhoto(idx, a, { heading, text: words });
        if (p) landPhoto(idx, a.key, p);
      });
      if (!o.noVisuals)
        for (const a of as)
          if (a.type === "diagram") startDiagram(idx, a, `${heading}\n${words}`, heading);
      relay(idx, "slide");
      if (idx === 1) mark("objectivesSlide");
      if (idx >= 2) mark("firstTeachingSlide");
    }
  };
  function applyDesign() {
    const d = plan.design ?? {};
    const chosen = brief.teacherTheme ? brief.teacherTheme : o.modelTheme ? d.theme : undefined;
    let ok = false;
    if (chosen && chosen !== themeId) {
      try {
        base.theme = withKeyStage(brief.keyStage, () => getTheme(chosen, brief.keyStage));
        ok = base.theme.id === chosen;
      } catch {
        ok = false;
      }
      if (ok) themeId = chosen;
    }
    timings.design = ms();
    log({
      ev: "design",
      theme: themeId,
      modelTheme: d.theme ?? null,
      teacherTheme: brief.teacherTheme ?? null,
      unknownTheme: !!chosen && !ok && chosen !== themeId,
      pictureStyle: d.picture_style ?? null,
    });
    // The title (and anything already laid) takes the chosen theme.
    if (arm.codeTitle) title = withKeyStage(brief.keyStage, () => arm.codeTitle?.(brief, base));
    for (const i of laid.keys()) if (plan.slides[i]) relay(i, "theme");
    save("design");
  }

  // ── b0. two phases (Greg 6 Oct, decision b): an objectives call, the teacher signs off (auto here),
  // then the design call takes the approved objectives. Only when the prompt agent's files exist.
  const shared0 = `${BAKEOFF}/prompts/shared`;
  const twoPhase =
    !o.replay &&
    existsSync(`${shared0}/objectives.txt`) &&
    existsSync(`${shared0}/objectives-schema.json`);
  let signOffMs = 0;
  // A replay (pictures-only re-run) takes the recorded run's approved objectives, so the objectives
  // slide and the picture judge's lesson facts match the original run (both round-1 branches added this).
  const recordedObj = o.replay && !plan.objectives ? `${dirname(o.replay)}/objectives.json` : "";
  if (recordedObj && existsSync(recordedObj)) {
    const rec = JSON.parse(readFileSync(recordedObj, "utf8")) as {
      objectives?: { teacher: string; pupil: string }[];
    };
    if (rec.objectives?.length) {
      plan.objectives = rec.objectives;
      lessonInfo.base = {
        facts: {
          objectives: rec.objectives.map((x, k) => ({ id: `o${k + 1}`, text: x.teacher })),
          outline: [],
        },
      };
    }
  }
  let user = contextBlock(brief, plan.objectives);
  if (twoPhase) {
    const cfgFile = `${shared0}/objectives.json`;
    const cfg = (existsSync(cfgFile) ? JSON.parse(readFileSync(cfgFile, "utf8")) : {}) as {
      model?: string;
      effort?: "minimal" | "low" | "medium" | "high";
    };
    const objectives: { teacher: string; pupil: string }[] = [];
    const op = new PartialJson((path, v) => {
      if (path[0] === "objectives" && path.length === 2) {
        objectives.push(v as { teacher: string; pupil: string });
        mark("objectiveFirst");
      }
    });
    const heldObj = ledger.guard("objectives call", STEP_EST.objectives);
    const oc = await chatStream(
      {
        model: cfg.model ?? "gpt-6.1-sol",
        effort: cfg.effort ?? "low",
        system: readFileSync(`${shared0}/objectives.txt`, "utf8"),
        user: existsSync(`${shared0}/objectives-user.txt`)
          ? fillTemplate(readFileSync(`${shared0}/objectives-user.txt`, "utf8"), brief)
          : user,
        schema: JSON.parse(readFileSync(`${shared0}/objectives-schema.json`, "utf8")),
        name: "objectives",
        maxTokens: 3000,
      },
      (d) => op.push(d),
    );
    ledger.add("objectives", oc.usd);
    heldObj();
    mark("objectivesAll");
    plan.objectives = objectives;
    lessonInfo.base = {
      facts: {
        objectives: objectives.map((x, k) => ({ id: `o${k + 1}`, text: x.teacher })),
        outline: [],
      },
    };
    writeJson(`${o.outDir}/objectives.json`, {
      objectives,
      usage: oc.usage,
      usd: oc.usd,
      ms: oc.ms,
      firstTokenMs: oc.firstTokenMs,
    });
    log({
      ev: "objectives",
      n: objectives.length,
      phase: "objectives call",
      gate10s: (timings.objectivesAll ?? 0) <= 10_000,
    });
    // The teacher signs off: auto-approved at once in the bake-off.
    signOffMs = ms();
    timings.signOff = signOffMs;
    log({ ev: "sign-off", auto: true, objectives: objectives.length });
    if (arm.codeObjectives) {
      laid.set(
        1,
        withKeyStage(
          brief.keyStage,
          () => arm.codeObjectives?.({ ...base, index: 1, plan }) as Materialised,
        ),
      );
      save("objectives slide (approved)");
      mark("objectivesSlide");
    }
    // The design call's user turn: shared/user.txt with the approved objectives filled in.
    user = contextBlock(brief, objectives);
  }
  const parser = new PartialJson(onValue);
  const p = arm.prompt(brief);
  writeJson(`${o.outDir}/request.json`, {
    model: p.model,
    effort: p.effort,
    user,
    systemChars: p.system.length,
  });
  const heldMain = ledger.guard("main call", o.replay ? 0 : STEP_EST.main);
  const main = o.replay
    ? await replayStream(o.replay, (d) => parser.push(d))
    : await chatStream(
        {
          model: p.model,
          effort: p.effort,
          system: p.system,
          user,
          schema: p.schema,
          name: "lesson",
          maxTokens: 9000,
        },
        (d) => {
          appendFileSync(`${o.outDir}/stream.txt`, d);
          parser.push(d);
        },
      ).catch((e) => {
        // No usage on a failed stream: book an estimate (input + what arrived, 4 chars a token).
        const est = ((p.system.length + user.length) / 4) * 2e-6 + (parser.text.length / 4) * 10e-6;
        ledger.add("mainFailedEstimate", est);
        heldMain();
        log({
          ev: "main-error",
          err: String(e).slice(0, 300),
          chars: parser.text.length,
          estUsd: est,
        });
        writeJson(`${o.outDir}/cost.json`, {
          ...ledger.parts,
          note: "main call failed; estimate only",
        });
        throw e;
      });
  ledger.add("main", main.usd);
  heldMain();
  writeJson(`${o.outDir}/main.json`, {
    text: main.text,
    usage: main.usage,
    usd: main.usd,
    ms: main.ms,
    firstTokenMs: main.firstTokenMs,
  });
  mark("streamDone");
  const n = plan.slides.length;
  // Early jobs for slides that turned out to have no picture still land (cost is spent) but are not placed.
  for (const [i, e] of early)
    if (!asks.get(i)?.some((a) => a.type === "photo")) jobs.push(e.then(() => undefined));
  mark("editable");
  save("all slides");

  // ── c. notes: a second small call per slide, all in parallel (unless the main schema carries notes) ──
  const notesJobs: Promise<void>[] = [];
  const shared = `${BAKEOFF}/prompts/shared`;
  const hasNotesPrompt =
    existsSync(`${shared}/notes.txt`) && existsSync(`${shared}/notes-schema.json`);
  for (let i = 0; i < n; i++) {
    const s = plan.slides[i];
    if (!s) continue;
    if (typeof s.notes === "string") {
      notes.set(i, { notes: s.notes, answers: (s.answers as string[]) ?? [] });
      continue;
    }
    if (o.noNotes || !hasNotesPrompt) continue;
    const system = readFileSync(`${shared}/notes.txt`, "utf8");
    const schema = JSON.parse(readFileSync(`${shared}/notes-schema.json`, "utf8"));
    const u = `${user}\n\nLesson:\n${main.text}\n\nSlide: ${i + 1}`;
    notesJobs.push(
      (async () => {
        const held = ledger.guard(`notes s${i + 1}`, STEP_EST.notes);
        const r = await chat({
          model: "gpt-6-luna",
          effort: "low",
          system,
          user: u,
          schema,
          name: "notes",
        });
        ledger.add("notes", r.usd);
        held();
        const out = r.out as { notes: string; answers: string[] } | undefined;
        if (out) notes.set(i, out);
        log({ ev: "notes", slide: i + 1, ms: r.ms, usd: r.usd });
      })().catch((e) => log({ ev: "notes-error", slide: i + 1, err: String(e).slice(0, 200) })),
    );
  }
  await Promise.all(notesJobs);
  if (notesJobs.length) mark("notes");
  // Visual jobs may add more jobs as they land: wait until none are left.
  for (let k = 0; k < jobs.length; k = jobs.length) await Promise.all(jobs.slice(k));
  for (let i = 0; i < n; i++) relay(i, "final");
  mark("visualsDone");

  // ── d. code checks ──
  const check = () =>
    Array.from({ length: n }, (_, i) =>
      checkSlide({
        index: i,
        slide: laid.get(i)?.slide,
        over: laid.get(i)?.over ?? [],
        ...(laid.get(i)?.diagram ? { diagram: laid.get(i)?.diagram } : {}),
        questions: plan.slides[i] ? arm.questions(plan.slides[i] as Record<string, unknown>) : [],
        answers: notes.get(i)?.answers,
        notesChecked: notes.has(i),
        words: plan.slides[i] ? arm.words(plan.slides[i] as Record<string, unknown>) : "",
      }),
    );
  let checks = check();
  const count = {
    slides: n,
    min: brief.slides.min,
    max: brief.slides.max,
    inRange: n >= brief.slides.min && n <= brief.slides.max,
  };
  log({
    ev: "checks",
    failing: checks
      .filter((c) => c.faults.length)
      .map((c) => `s${c.slide}: ${c.faults.join("; ")}`),
    count,
  });

  // ── e. one bounded repair: failing slides only, one call each, one round ──
  const repairSys = `${shared}/repair.txt`;
  // The arm's per-stage repair schema and layouts menu (prompts/<arm>/repair-schema.<stage>.json, layouts.<stage>.txt).
  const stageKey =
    arm.promptStage?.(brief) ??
    (brief.keyStage === "ks1" ? "KS1" : brief.keyStage === "ks2" ? "KS2" : "KS3-5");
  const armDir = `${BAKEOFF}/prompts/${arm.id}`;
  const repairSchema = existsSync(`${armDir}/repair-schema.${stageKey}.json`)
    ? `${armDir}/repair-schema.${stageKey}.json`
    : `${armDir}/repair-schema.json`;
  const repairUser = `${shared}/repair-user.txt`;
  // Round 2 guards (repair.ts): never the title or objectives slide; a repaired slide that drops a
  // figure, leaves a slot empty, splits a sentence across cards or loses words is rejected and the
  // original kept with its flag; a new figure the repaired slide asks for is fetched like any other.
  const failing = checks.filter((c) => {
    const i = c.slide - 1;
    const ok = c.faults.length > 0 && repairable(plan.slides[i] as Record<string, unknown>, i);
    if (c.faults.length && !ok) log({ ev: "repair-not-allowed", slide: c.slide, faults: c.faults });
    return ok;
  });
  const recorded = new Map<number, unknown>();
  if (o.replayRepair && existsSync(o.replayRepair))
    for (const l of readFileSync(o.replayRepair, "utf8").split("\n").filter(Boolean)) {
      const r = JSON.parse(l) as { slide: number; out?: unknown };
      if (r.out) recorded.set(r.slide, r.out);
    }
  /** Wait for every visual job, including any a landed job started. */
  const settle = async () => {
    for (let k = 0; k < jobs.length; k = jobs.length) await Promise.all(jobs.slice(k));
  };
  /** Swap slide i to `next`, carry visuals its figures keep, fetch the new ones, re-lay it. */
  const swapSlide = async (i: number, next: Record<string, unknown>) => {
    const oldAsks = asks.get(i) ?? [];
    const newAsks = withKeyStage(brief.keyStage, () => arm.visuals(next, i, { ...base, plan }));
    const state = new Map(oldAsks.map((a) => [a.key, visuals.get(`${i}:${a.key}`)]));
    plan.slides[i] = next;
    asks.set(i, newAsks);
    const words = arm.words(next);
    const heading = String(next.heading ?? "");
    for (const a of newAsks) {
      const k = `${i}:${a.key}`;
      const was = oldAsks.find((b) =>
        sameFigure({ type: b.type, shows: b.shows }, { type: a.type, shows: a.shows }),
      );
      const v = was ? state.get(was.key) : undefined;
      if (v && v.status !== "pending") {
        visuals.set(k, v);
        continue;
      }
      // A figure the repaired slide newly asks for: fetched the same way, never left as a slot.
      if (a.type === "photo") {
        const p = startPhoto(i, a, { heading, text: words });
        if (p) landPhoto(i, a.key, p);
        else visuals.set(k, { status: "failed" });
      } else if (!o.noVisuals) startDiagram(i, a, `${heading}\n${words}`, heading);
      else visuals.set(k, { status: "failed" });
    }
    await settle();
    relay(i, "repair");
    return { oldAsks, state };
  };
  const restore = (
    i: number,
    slide: Record<string, unknown> | undefined,
    n0: { notes: string; answers: string[] } | undefined,
    saved: { oldAsks: VisualAsk[]; state: Map<string, VisualState | undefined> },
  ) => {
    plan.slides[i] = slide;
    if (n0) notes.set(i, n0);
    else notes.delete(i);
    asks.set(i, saved.oldAsks);
    for (const [k, v] of saved.state) if (v) visuals.set(`${i}:${k}`, v);
    relay(i, "repair-reverted");
  };
  /** The "Diagram kinds:" block of shared/base-visuals.<stage>.txt (the repair's menu of kinds). */
  const diagramKinds = () => {
    for (const f of [`${shared}/base-visuals.${stageKey}.txt`, `${shared}/base-visuals.txt`])
      if (existsSync(f)) {
        const m = readFileSync(f, "utf8").match(/Diagram kinds:[\s\S]*?(?=\n\s*\n|$)/);
        if (m) return m[0].trim();
      }
    return "";
  };
  const kinds = (f: string[]) => new Set(f.map((x) => x.split(":")[0]));
  const path = new Map<number, string>();
  if (!o.noRepair && failing.length) {
    if (!existsSync(repairSys) || !existsSync(repairSchema))
      log({ ev: "repair-skipped", why: "no repair prompt yet", failing: failing.length });
    else {
      const system = readFileSync(repairSys, "utf8");
      await Promise.all(
        failing.map(async (c) => {
          const i = c.slide - 1;
          const ask = asks.get(i) ?? [];
          const found = ask
            .map((a) => visuals.get(`${i}:${a.key}`))
            .flatMap((v) =>
              v?.status === "photo"
                ? [`The picture placed shows: ${v.photo.about ?? v.photo.alt}`]
                : v?.status === "failed"
                  ? ["No picture could be found for this slide."]
                  : [],
            );
          const placed = ask.flatMap((a) => {
            const v = visuals.get(`${i}:${a.key}`);
            return v?.status === "photo" ? [`${a.key}: ${v.photo.about ?? v.photo.alt}`] : [];
          });
          const tpl = existsSync(repairUser) ? readFileSync(repairUser, "utf8") : "";
          const u = tpl
            ? fillTemplate(tpl, brief, {
                context: user,
                N: i + 1,
                [String(tpl.match(/\{\{(the diagram kinds[^}]*)\}\}/)?.[1] ?? "-")]: diagramKinds(),
                "the arm's layouts menu for this key stage: <arm>/layouts.<stage>.txt": existsSync(
                  `${armDir}/layouts.${stageKey}.txt`,
                )
                  ? readFileSync(`${armDir}/layouts.${stageKey}.txt`, "utf8").trim()
                  : "",
                "the slide's JSON exactly as the main call wrote it": JSON.stringify(
                  plan.slides[i],
                ),
                [String(tpl.match(/\{\{(one line per placed picture[^}]*)\}\}/)?.[1] ?? "-")]:
                  placed.length ? placed.join("\n") : "none",
                [String(tpl.match(/\{\{(one line per fault[^}]*)\}\}/)?.[1] ?? "-")]: [
                  ...c.faults,
                  ...found,
                ]
                  .sort()
                  .join("\n"),
              })
            : `${user}\n\nSlide ${i + 1}:\n${JSON.stringify(plan.slides[i])}\n\nWhat the check found:\n${[...c.faults, ...found].map((f) => `- ${f}`).join("\n")}`;
          let out: unknown;
          let usd = 0;
          if (o.replayRepair) out = recorded.get(i + 1);
          else {
            const r = await guarded(
              ledger,
              `repair s${i + 1}`,
              STEP_EST.repair,
              () =>
                chat({
                  model: "gpt-6-luna",
                  effort: "low",
                  system,
                  user: u,
                  schema: JSON.parse(readFileSync(repairSchema, "utf8")),
                  name: "slide",
                }),
              log,
            );
            if (r) ledger.add("repair", r.usd);
            out = r?.out;
            usd = r?.usd ?? 0;
          }
          appendFileSync(
            `${o.outDir}/repair.jsonl`,
            `${JSON.stringify({ slide: i + 1, faults: c.faults, input: plan.slides[i], out })}\n`,
          );
          const o2 = out as { slide?: Record<string, unknown>; to_notes?: unknown; fix?: string };
          if (!o2?.slide || typeof o2.slide !== "object") {
            log({ ev: "repair", slide: i + 1, usd, ok: false });
            return;
          }
          const before = plan.slides[i] as Record<string, unknown>;
          const moved = (Array.isArray(o2.to_notes) ? o2.to_notes : [o2.to_notes ?? ""]).map(
            String,
          );
          const verdict = judgeRepair(before, o2.slide, moved);
          if (!verdict.ok) {
            log({
              ev: "repair-rejected",
              slide: i + 1,
              fix: o2.fix,
              why: verdict.why,
              faults: c.faults,
            });
            return;
          }
          const n0 = notes.get(i);
          const saved = await swapSlide(i, o2.slide);
          applyRepair(plan.slides, notes, i, out);
          // The same fault kind still there, or a new one: keep the original slide (and its flag).
          // A slide the notes call never reached has no answers to check (offline replays, a failed
          // notes call): to_notes alone must not raise an "unanswered" fault and revert the repair.
          const now = (check()[i]?.faults ?? []).filter((f) => n0 || !f.startsWith("unanswered"));
          const was = kinds(c.faults);
          const worse = [...kinds(now)].some((k) => was.has(k)) || now.length > c.faults.length;
          if (worse) restore(i, before, n0, saved);
          else if (c.faults.some((f) => f.startsWith("diagram:"))) path.set(i, "diagram-repaired");
          log({ ev: "repair", slide: i + 1, usd, ok: true, fix: o2.fix, reverted: worse, now });
        }),
      );
      mark("repaired");
    }
  }
  // A diagram that still cannot draw: a picture of the same thing when it is a real, concrete
  // thing (the picture director, the diagram's `shows` as the request); else words only.
  for (let i = 0; i < n; i++) {
    const dAsk = (asks.get(i) ?? []).find((a) => a.type === "diagram") as
      | Extract<VisualAsk, { type: "diagram" }>
      | undefined;
    if (!dAsk || path.has(i)) continue;
    if (!laid.get(i)?.diagram?.length && visuals.get(`${i}:${dAsk.key}`)?.status === "diagram") {
      path.set(i, "diagram");
      continue;
    }
    const s = plan.slides[i] as Record<string, unknown>;
    const pic = concrete(dAsk.kind, dAsk.shows) ? arm.asPicture?.(s) : undefined;
    if (pic) {
      const n0 = notes.get(i);
      const saved = await swapSlide(i, pic);
      const got = (asks.get(i) ?? []).some((a) => visuals.get(`${i}:${a.key}`)?.status === "photo");
      if (got) {
        path.set(i, "picture");
        continue;
      }
      restore(i, s, n0, saved);
    }
    path.set(i, "words");
  }
  for (const [i, p] of path) log({ ev: "visual-path", slide: i + 1, path: p });
  checks = check();
  // Teaching slides left with no picture or diagram (round 2 summary).
  const textOnlyTeach = Array.from({ length: n }, (_, i) => i).filter(
    (i) =>
      i > 1 &&
      teaching(plan.slides[i] as Record<string, unknown>) &&
      !(laid.get(i)?.slide.elements ?? []).some((e) => e.type === "image"),
  );
  const summary = {
    textOnlyTeach: textOnlyTeach.length,
    textOnlySlides: textOnlyTeach.map((i) => i + 1),
    visualPaths: Object.fromEntries([...path].map(([i, p]) => [i + 1, p])),
    capRefused: ledger.refused,
  };
  log({ ev: "summary", ...summary });
  save("done");
  mark("done");
  const cost = { ...ledger.parts, picturesDirector: pics?.aiSpend() ?? 0 };
  const total = Object.values(cost).reduce((a, b) => a + b, 0);
  const keys = [
    "title",
    "objectiveFirst",
    "objectivesAll",
    "signOff",
    "design",
    "firstPlaceholder",
    "objectivesSlide",
    "firstTeachingSlide",
    "editable",
    "lastPicture",
    "lastDiagram",
    "notes",
    "done",
  ];
  const lastVisual = Math.max(timings.lastPicture ?? 0, timings.lastDiagram ?? 0) || undefined;
  writeJson(`${o.outDir}/timings.json`, {
    // From the request (the objectives phase and single-phase runs).
    ms: { ...Object.fromEntries(keys.map((k) => [k, timings[k]])), lastVisual },
    // Two-phase runs: the design phase measured from the teacher's sign-off (decision b).
    ...(twoPhase
      ? {
          fromSignOff: Object.fromEntries(
            [
              "design",
              "firstPlaceholder",
              "firstTeachingSlide",
              "editable",
              "lastPicture",
              "lastDiagram",
              "notes",
              "done",
            ]
              .filter((k) => timings[k] !== undefined)
              .map((k) => [k, (timings[k] as number) - signOffMs]),
          ),
          objectivesGate10s: (timings.objectivesAll ?? Infinity) <= 10_000,
        }
      : {}),
    theme: {
      used: themeId,
      model: plan.design?.theme ?? null,
      teacher: brief.teacherTheme ?? null,
    },
    pictureStyle: plan.design?.picture_style ?? null,
    all: timings,
    mainCall: { ms: main.ms, firstTokenMs: main.firstTokenMs },
  });
  writeJson(`${o.outDir}/cost.json`, {
    ...cost,
    total: Number(total.toFixed(5)),
    main: (cost as Record<string, number>).main ?? 0,
  });
  writeJson(`${o.outDir}/checks.json`, { count, summary, slides: checks });
  return { lessonFile, timings, cost: { ...cost, total }, checks };
}

/** Render helper for plugins: a diagram spec's SVG at a size, at the stage's type scale. */
export const drawDiagram = (
  spec: unknown,
  theme: Theme,
  stage: Stage,
  size: { w: number; h: number },
) => withKeyStage(stage, () => renderDiagram(spec, theme, size));

/** A repair answer is {fix, slide, to_notes}: the slide replaces the old one, to_notes is added to its notes. */
export function applyRepair(
  slides: (Record<string, unknown> | undefined)[],
  notes: Map<number, { notes: string; answers: string[] }>,
  i: number,
  out: unknown,
) {
  // The repair schema's to_notes is an array of strings (every run's repair crashed on `.trim()`
  // of an array, so no repair was ever applied); a plain string is accepted too.
  const o = out as { slide?: Record<string, unknown>; to_notes?: string | string[] };
  if (!o.slide || typeof o.slide !== "object") return;
  slides[i] = o.slide;
  const moved = Array.isArray(o.to_notes) ? o.to_notes : [o.to_notes ?? ""];
  const extra = moved
    .map((x) => String(x).trim())
    .filter((x) => x && !/^none\.?$/i.test(x))
    .join("\n");
  if (extra) {
    const n = notes.get(i) ?? { notes: "", answers: [] };
    notes.set(i, { ...n, notes: n.notes ? `${n.notes}\n\n${extra}` : extra });
  }
}

/** The diagram drawings an earlier run placed, by slide index (offline re-layout). */
export function reusedDiagrams(
  runDir: string,
): Map<number, { src: string; aspect: number; alt: string }> {
  const out = new Map<number, { src: string; aspect: number; alt: string }>();
  const lesson = JSON.parse(readFileSync(`${runDir}/lesson.json`, "utf8")) as
    | Slide[]
    | { slides: Slide[] };
  (Array.isArray(lesson) ? lesson : lesson.slides).forEach((sl, i) => {
    for (const e of sl.elements as unknown as Record<string, unknown>[])
      if (e.type === "image" && e.name === "Diagram" && typeof e.src === "string")
        out.set(i, { src: e.src, aspect: Number(e.w) / Number(e.h), alt: String(e.alt ?? "") });
  });
  return out;
}

/** Keys of photos that repeat a picture an earlier slide already shows for a different request. */
export function repeatedPictures(visuals: Map<string, VisualState>): string[] {
  const first = new Map<string, { slide: number; request?: string }>();
  const shown = [...visuals]
    .filter(([, v]) => v.status === "photo")
    .map(([k, v]) => ({
      k,
      slide: Number(k.split(":")[0]),
      photo: (v as { photo: PhotoResult }).photo,
    }))
    .sort((a, b) => a.slide - b.slide || a.k.localeCompare(b.k));
  const drop: string[] = [];
  for (const p of shown) {
    const f = first.get(p.photo.src);
    if (!f) first.set(p.photo.src, { slide: p.slide, request: p.photo.request });
    else if (f.request !== p.photo.request) drop.push(p.k);
  }
  return drop;
}

/** A diagram's own title is dropped when it only repeats the slide heading. */
export function dropEchoTitle<T>(spec: T, heading: string): T {
  const t = (spec as { title?: unknown }).title;
  const norm = (x: string) =>
    x
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  if (typeof t !== "string" || !heading || norm(t) !== norm(heading)) return spec;
  const { title: _, ...rest } = spec as Record<string, unknown>;
  return rest as T;
}

/** The photos an earlier run placed, by visual key, with the request, subjects and alt its slides carried. */
export function reusedPhotos(runDir: string): Map<string, PhotoResult> {
  const byKey = new Map<string, PhotoResult>();
  const els = new Map<string, Record<string, unknown>>();
  const lesson = JSON.parse(readFileSync(`${runDir}/lesson.json`, "utf8")) as
    | Slide[]
    | { slides: Slide[] };
  for (const sl of Array.isArray(lesson) ? lesson : lesson.slides)
    for (const e of sl.elements as unknown as Record<string, unknown>[])
      if (e.type === "image" && typeof e.src === "string") els.set(e.src, e);
  for (const line of readFileSync(`${runDir}/log.jsonl`, "utf8").split("\n")) {
    if (!line.includes('"picture-done"')) continue;
    const r = JSON.parse(line) as { key: string; ok: boolean; src?: string; provider?: string };
    if (!r.ok || !r.src) continue;
    const e = els.get(r.src) ?? {};
    byKey.set(r.key, {
      src: r.src,
      alt: String(e.alt ?? ""),
      request: String(e.request ?? ""),
      provider: r.provider,
      ...(e.subjects ? { subjects: e.subjects as PhotoResult["subjects"] } : {}),
      aspect: aspectOf(r.src),
    } as PhotoResult);
  }
  return byKey;
}

/** The bank's id for a placed picture (its source id), else its storage file name. */
export function pictureId(p: PhotoResult): string {
  const id = (p.source as { id?: string } | undefined)?.id;
  return id || (p.src.split("/").pop() ?? p.src).replace(/\.[a-z0-9]+$/i, "");
}

/**
 * Ruling 163 gate (eval `gates.py ruling163`): every placed picture's image element carries its
 * `source` (PhotoSource: `provider` commons, pexels or generated, and `id`), plus `style` (photo,
 * illustration or drawn) and `period` (the request's period, when it has one) on the element.
 * Matched by src against the landed pictures; diagrams and open slots are left alone.
 */
export function stampPictureSources(slides: Slide[], visuals: Map<string, VisualState>) {
  const bySrc = new Map<string, PhotoResult>();
  for (const v of visuals.values()) if (v.status === "photo") bySrc.set(v.photo.src, v.photo);
  for (const s of slides)
    for (const e of (s as { elements?: Record<string, unknown>[] }).elements ?? []) {
      if (e.type !== "image") continue;
      const p = bySrc.get(String(e.src));
      if (!p) continue;
      const src = (p.source ?? {}) as Record<string, unknown>;
      e.source = {
        ...src,
        provider: (src.provider as string) ?? p.provider ?? "generated",
        id: (src.id as string) ?? pictureId(p),
      };
      e.style = p.style ?? "photo";
      if (p.period) e.period = p.period;
      else delete e.period;
    }
}
