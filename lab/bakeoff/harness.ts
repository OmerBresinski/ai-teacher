// BAKEOFF shared harness: one streamed planning call, slides materialised as they complete, pictures
// and diagrams in parallel, notes per slide, code checks, one bounded repair, timings and cost.
// The layout step is an `ArmPlugin` (arm T: templates; K: blocks + recipes; R: reference slides).
// See BAKEOFF/HARNESS.md.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Slide, Theme } from "@tj/domain/documents";
import { renderDiagram } from "../../packages/slides/src/diagrams/index";
import { FIT_VERSION, getTheme, withKeyStage } from "../../packages/slides/src/themes";
import { type CheckResult, checkSlide, duplicateFaults, slideNoEmDash } from "./checks";
import { OBJECTIVES_CONFIG, objectivesCall, pupilCall, pupilSchema } from "./objectives";
import { PartialJson, type Path } from "./partial";
import { judgeRepair, repairable, sameFigure, teaching } from "./repair";
import {
  coverage,
  lessonNotes,
  notesText,
  objectiveRepairSchema,
  renderedLines,
  repairObjectives,
} from "./round4";
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
  shareBudget,
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
  /** Round 4 (Greg): task demand, separate from reading level; default core. */
  challenge?: "support" | "core" | "stretch";
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
  flow?: {
    slide: number;
    does: string;
    look_at?: { kind: string; shows: string | null };
    /** Round 4: the objective numbers this slide teaches or checks. */
    teaches?: number[];
  }[];
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
  /** Round 7: the slide with its schematic pictures (`which` picks them) asked for as diagrams. */
  asDiagram?(
    slide: Record<string, unknown>,
    which: (shows: string) => boolean,
  ): Record<string, unknown> | undefined;
  /** Round 5: the slide as words only, with any sentence pointing at its missing visual removed. */
  asWords?(
    slide: Record<string, unknown>,
    opts?: { keepPointing?: boolean },
  ): Record<string, unknown> | undefined;
  /**
   * Round 4: a table that cannot draw, as words that keep its data. Round 6: as cards or labelled
   * points (a row's first cell names it), never cells joined by separators.
   */
  asTableText?(
    slide: Record<string, unknown>,
    table: TableData,
  ): Record<string, unknown> | undefined;
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

/** A placed picture as the notes call sees it: its alt (what it is), plus the subjects seen in it. */
export function placedPictureText(
  photo: { alt?: string; subjects?: { name: string }[] } | undefined,
  request: string,
): string {
  const alt = photo?.alt?.trim();
  const seen = (photo?.subjects ?? []).map((x) => x.name).filter(Boolean);
  return `${alt || request}${seen.length ? ` (visible: ${seen.join(", ")})` : ""}`;
}

/** "B: ..." for a multiple-choice slide whose `correct` (1-based option) is set, unless already lettered. */
export function withCorrectLetter(
  answers: string | null,
  slide: Record<string, unknown> | undefined,
) {
  const c = Number(slide?.correct);
  if (!answers || !Number.isInteger(c) || c < 1 || c > 6) return answers;
  const letter = String.fromCharCode(64 + c);
  return new RegExp(`^\\s*${letter}\\b`).test(answers) ? answers : `${letter}: ${answers}`;
}

/** Diagram kinds that are data: a picture cannot stand in for them (round 5 fallback order). */
export const DATA_KINDS = new Set([
  "table",
  "line-graph",
  "bar-chart",
  "bar-model",
  "number-line",
  "pie",
  "venn",
  "carroll",
  "hydrograph",
]);
/** Round 6: a labelled drawing of lab apparatus (a photo's job, never drawn). */
export const isApparatus = (kind: string | undefined, shows: string) =>
  kind === "labelled-diagram" &&
  /\b(apparatus|equipment|set-?up|flask|beaker|burette|pipette|test tubes?|bunsen|syringe|clamp|delivery tube|thermometer|measuring cylinder|filter funnel|tripod|gauze|water bath|balance)\b/i.test(
    shows,
  );
/**
 * Round 7: a request whose subject is a schematic (a model of particles, panels, plain shapes cut
 * into parts) is a diagram's job. A made picture of it is decoration (r6 y7 s9's red balls, y2
 * s4's rectangles), never the thing.
 */
export const SCHEMATIC =
  /\b(particles?|molecules?|atoms?)\b|^(an?|one|two|three|four|the)?\s*(\w+\s)?(rectangles?|squares?|circles?|triangles?|shapes?|panels?|bars?|grids?|(\w+ )?models?|diagrams?)(\s+(with|containing|split|divided|cut|showing|in|and|side)\b|[,.;]|$)/i;
/**
 * Round 7 (r6 y8: AI portraits of a "fictional father"): a made picture of a particular,
 * real-seeming person (a family member, a named or fictional person) is not shown.
 */
export const PORTRAIT =
  /\b(fictional|portraits?|called [A-Z]\w+|named [A-Z]\w+|(grand)?(father|mother|parents?)|brothers?|sisters?|famil(y|ies)|aunts?|uncles?|cousins?|husband|wife|son|daughter|step\w+)\b/i;
/** Round 7: why a placed picture is not shown, or undefined when it may be. */
export function pictureVeto(r: {
  request?: string;
  provider?: string;
  style?: string;
}): string | undefined {
  const made = r.provider === "generated" || r.style === "drawn";
  const req = r.request ?? "";
  if (made && SCHEMATIC.test(req.trim())) return "a made picture of a schematic (a diagram's job)";
  if (r.provider === "generated" && r.style !== "drawn" && PORTRAIT.test(req))
    return "an AI portrait of a real-seeming person";
  return undefined;
}

/**
 * Round 7 (r7 y12 s8: the repair redrew a graph as a table and kept "Compare the curves"): an
 * `ask` written for one visual is not shown with another. A repaired figure whose kind changed
 * while its ask stayed the same shows its `ask_without` line instead.
 */
export function keepAsksHonest(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...after };
  for (const k of ["picture", "diagram", "figure"]) {
    const b = before[k] as Record<string, unknown> | undefined;
    const a = out[k] as Record<string, unknown> | undefined;
    if (!a || typeof a !== "object" || typeof a.ask !== "string") continue;
    const kindOf = (f?: Record<string, unknown>) =>
      f && typeof f === "object" ? (f.kind ?? "picture") : undefined;
    if (!b || kindOf(b) !== kindOf(a))
      if (!b || b.ask === a.ask) out[k] = { ...a, ask: a.ask_without ?? null };
  }
  return out;
}

/** A failed diagram may become a picture of the same thing unless it is data or a schematic. */
export const pictureFallbackOk = (kind: string | undefined, shows: string) =>
  !!kind &&
  !DATA_KINDS.has(kind) &&
  !/\b(graph|chart|table|axis|axes|equation|ratio)\b/i.test(shows) &&
  !SCHEMATIC.test(shows.trim());

/** A table's data as header and rows. */
export type TableData = { header?: string[]; rows: string[][] };

/**
 * A table's header and rows from its drawn-or-not spec, else from the ask's labels when they divide
 * into whole rows of the header's length (header first).
 */
export function tableRows(v: VisualState | undefined, ask: { labels?: string[] }): TableData {
  const spec = (v as { spec?: { header?: string[]; rows?: string[][] } } | undefined)?.spec;
  let header = spec?.header;
  let rows = spec?.rows;
  if (!rows?.length) {
    const l = ask.labels ?? [];
    const cols = l.findIndex((x) => /^[\d.,−-]+$/.test(x.trim()));
    if (cols > 0 && (l.length - cols) % cols === 0) {
      header = l.slice(0, cols);
      rows = [];
      for (let k = cols; k < l.length; k += cols) rows.push(l.slice(k, k + cols));
    }
  }
  return { ...(header?.length ? { header } : {}), rows: rows ?? [] };
}

/** A step the run can't go on without: waits for other holds to release, then throws past the cap. */
async function mustHold(ledger: Ledger, what: string, est: number) {
  // Round 5: a step the run cannot go on without waits up to 5 minutes for peers' holds.
  const held = await ledger.holdWhenFree(what, est, 300_000);
  if (!held) throw new Error(`cap $${ledger.capUsd} would be passed by ${what} (held $${est})`);
  return held;
}

/**
 * The pupil line's word limit (round 4 fix, y1 "Compare size, body covering: cat, kitten, hen,
 * chick."): the objectives slide's measured room for this many objectives at this key stage
 * (`catalogue/T.json` objectives variant, maxCharsPerItem ÷ 6, prompts CHANGELOG 41). The fixed
 * 8/10/12 words it replaces gave KS1 two objectives 8 words where the slide holds about 20.
 */
export function pupilWordLimit(stage: Stage, n: number, catalogue = `${BAKEOFF}/catalogue/T.json`) {
  const key = stage === "ks1" ? "KS1" : stage === "ks2" ? "KS2" : "KS3-5";
  try {
    const c = JSON.parse(readFileSync(catalogue, "utf8")) as {
      templates: {
        id: string;
        capacity?: Record<string, { variants: { label: string; maxCharsPerItem: number }[] }>;
      }[];
    };
    const o = c.templates.find((t) => t.id === "objectives");
    const v = o?.capacity?.[key]?.variants.find((x) => x.label === `${n} objectives`);
    if (v?.maxCharsPerItem) return Math.max(6, Math.floor(v.maxCharsPerItem / 6));
  } catch {}
  return OBJECTIVES_CONFIG.pupilMaxWords[stage];
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
    const d = expr.match(/^([\w.]+)\s*\?\?\s*"([^"]*)"$/);
    if (d) return String(get(d[1] as string) ?? d[2]);
    if (expr.startsWith("count:") && expr.includes("objectiveCount")) return objectiveCount(b);
    if (expr.startsWith("for each objective") && expr.includes("teacher wording only"))
      return (x.objectives ?? []).map((o, k) => `${k + 1}. ${o.teacher}`).join("\n");
    if (expr.startsWith("for each objective"))
      return (x.objectives ?? [])
        .map((o, k) => `${k + 1}. Teacher: ${o.teacher}${o.pupil ? ` | Pupils: ${o.pupil}` : ""}`)
        .join("\n");
    if (expr.startsWith("context block")) return x.context ?? "";
    if (expr.startsWith("for each final slide")) return String(x.slidesAsShown ?? "");
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
  /** No picture-library lookups. */
  noLibrary?: boolean;
  /** A directory shared by runs launched together: the cap holds across all of them. */
  budgetDir?: string;
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
  // One hard cap shared by runs launched side by side (--budget-dir): each counts the others.
  if (o.budgetDir) shareBudget(ledger, o.budgetDir, `${arm.id}-${brief.id}-${process.pid}`);
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
  // Round 7: each slide as streamed, for the ask_without report (the fallbacks swap the slide).
  const firstSlides = new Map<number, Record<string, unknown>>();
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
  const reusedJsonl = new Map<string, unknown>();
  if (o.reuseVisuals && existsSync(`${o.reuseVisuals}/diagrams.jsonl`))
    for (const l of readFileSync(`${o.reuseVisuals}/diagrams.jsonl`, "utf8").split("\n"))
      if (l.trim()) {
        const r = JSON.parse(l) as { key: string; spec?: unknown };
        if (r.spec) reusedJsonl.set(r.key, r.spec);
      }
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
          // Room for every picture plus its one regeneration, with parallel reservations (y1 run4: at
          // $0.02-0.035 the guard refused 5 slots before any judge saw them).
          bankCapUsd: o.bankCapUsd ?? 0.15,
          ...(o.generic ? { generic: o.generic } : {}),
          ...(o.noLibrary ? { noLibrary: true } : {}),
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
  /** Aborts an early flow job a slide doesn't take over (compare cards, sequences): no spend for nothing. */
  const earlyAbort = new Map<number, AbortController>();
  const startPhoto = (
    i: number,
    a: Extract<VisualAsk, { type: "photo" }>,
    words: { heading: string; text: string },
    signal?: AbortSignal,
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
      ...(signal ? { signal } : {}),
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
        .then((r0) => {
          const veto = r0 ? pictureVeto(r0) : undefined;
          if (veto)
            log({ ev: "picture-veto", key: `${i}:${key}`, why: veto, request: r0?.request });
          const r = veto ? undefined : r0;
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
      // Round 6: the spec the earlier run's diagram call returned (diagrams.jsonl), so a diagram
      // that failed its layout then is laid out again by today's code.
      const spec = reusedSpecs?.[String(i)] ?? reusedJsonl.get(k);
      const d = reusedDia.get(i);
      visuals.set(
        k,
        spec
          ? { status: "diagram", spec }
          : d
            ? { status: "diagram", spec: { drawn: d } }
            : { status: "failed" },
      );
      log({ ev: "diagram-done", key: k, ok: !!(spec ?? d), reused: true });
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
          // Round 5: specs are saved so a later run can replay them as a pre-launch smoke gate.
          if (spec)
            appendFileSync(
              `${o.outDir}/diagrams.jsonl`,
              `${JSON.stringify({ key: k, kind: a.kind, spec })}\n`,
            );
          timings.lastDiagram = ms();
          relay(i, "diagram");
        }),
    );
  };

  // ── b. the streamed planning call ──
  const slideIndexOf = slideIndexer();
  const onValue = (path: Path, v: unknown) => {
    const [top] = path;
    const idx = slideIndexOf(path, v);
    if (top === "design" && path.length === 1) {
      plan.design = v as Design;
      applyDesign();
    }
    if (top === "objectives" && path.length === 1 && Array.isArray(v) && !twoPhase) {
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
      if (
        f.look_at?.kind === "picture" &&
        f.look_at.shows &&
        i > 0 &&
        !early.has(i) &&
        !SCHEMATIC.test(f.look_at.shows.trim())
      ) {
        const ac = new AbortController();
        const p = startPhoto(
          i,
          { key: "early", type: "photo", shows: f.look_at.shows, mustSee: [], named: false },
          { heading: f.does, text: "" },
          ac.signal,
        );
        if (p) {
          early.set(i, p);
          earlyAbort.set(i, ac);
        }
      }
    }
    if (top === "flow" && path.length === 1) {
      plan.flow = v as Plan["flow"];
      mark("flow");
      log({ ev: "flow", n: plan.flow?.length });
      // Round 4: coverage as planned, before any slide is written (logged; repaired after the stream).
      if (plan.flow?.some((f) => Array.isArray(f.teaches)))
        log({
          ev: "coverage-flow",
          ...coverage(plan.flow, plan.objectives?.length ?? 0, () => undefined),
        });
    }
    // Slide 2 belongs to code in the two-phase flow (pupil wording call); a streamed one is ignored.
    if (idx === 1 && twoPhase && arm.codeObjectives) return;
    if (idx !== undefined) {
      let s = v as Record<string, unknown>;
      // Round 6 (r5 y11 s6 drew garbled apparatus): apparatus is a photo, as in round 3. A drawn
      // apparatus is never placed; a slide whose photo cannot be found stands alone in words.
      const first = withKeyStage(brief.keyStage, () => arm.visuals(s, idx, { ...base, plan }));
      // Round 7 (r6 y2 s4: two rectangles "with equal and unequal divisions" made as a picture):
      // a schematic asked for as a picture is drawn as a diagram from the slide's own words.
      if (first.some((a) => a.type === "photo" && SCHEMATIC.test(a.shows.trim()))) {
        const dia = arm.asDiagram?.(s, (shows) => SCHEMATIC.test(shows.trim()));
        if (dia) {
          log({ ev: "schematic-diagram", slide: idx + 1 });
          s = dia;
        }
      }
      if (first.some((a) => a.type === "diagram" && isApparatus(a.kind, a.shows))) {
        const pic = arm.asPicture?.(s);
        if (pic) {
          log({ ev: "apparatus-photo", slide: idx + 1 });
          s = pic;
        }
      }
      // Round 6: no em dashes on slides (Greg 1 Oct; r5 y8).
      s = slideNoEmDash(s);
      plan.slides[idx] = s;
      firstSlides.set(idx, s);
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
      // Round 5: an early job this slide will not take over is stopped (y1 r4: "a cow with a calf
      // and a hen with a chick" was generated and judged twice for a compare slide that never used it).
      const takes = !!e && !!photos[0] && !photos[0].fixedShape && !photos[0].set;
      if (e && !takes) {
        earlyAbort.get(idx)?.abort();
        log({
          ev: "early-dropped",
          slide: idx + 1,
          why: photos.length ? "slide uses its own slots" : "no picture on the slide",
        });
      }
      photos.forEach((a, n) => {
        if (a.set && (sets.get(a.set)?.length ?? 0) >= 2 && (pics || reused)) return;
        // The slide's first picture takes over the flow's early job (already running).
        if (n === 0 && e && takes) {
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
  /** Slide 2 from code, with the pupil lines that have arrived (the model never writes slide 2). */
  const laySlide2 = (why: string) => {
    if (!arm.codeObjectives) return;
    const shown = { ...plan, objectives: (plan.objectives ?? []).filter((x) => x.pupil.trim()) };
    laid.set(
      1,
      withKeyStage(
        brief.keyStage,
        () => arm.codeObjectives?.({ ...base, index: 1, plan: shown }) as Materialised,
      ),
    );
    save(why);
  };
  let pupilJob: Promise<void> = Promise.resolve();
  if (twoPhase) {
    // (1) Teacher objectives: Sol, Luna when no first objective has streamed by 8 s (code defaults).
    const heldObj = await mustHold(ledger, "objectives call", STEP_EST.objectives * 2);
    const run = await objectivesCall(
      {
        system: readFileSync(`${shared0}/objectives.txt`, "utf8"),
        user: existsSync(`${shared0}/objectives-user.txt`)
          ? fillTemplate(readFileSync(`${shared0}/objectives-user.txt`, "utf8"), brief)
          : user,
        schema: JSON.parse(readFileSync(`${shared0}/objectives-schema.json`, "utf8")),
        name: "objectives",
        maxTokens: 3000,
      },
      chatStream,
      () => mark("objectiveFirst"),
    );
    // An abandoned primary call's usage never arrives: its reserve is booked as spent.
    ledger.add("objectives", run.result.usd + (run.abandoned ? STEP_EST.objectives : 0));
    heldObj();
    mark("objectivesAll");
    const objectives = run.teacher.map((teacher) => ({ teacher, pupil: "" }));
    plan.objectives = objectives;
    lessonInfo.base = {
      facts: {
        objectives: objectives.map((x, k) => ({ id: `o${k + 1}`, text: x.teacher })),
        outline: [],
      },
    };
    log({
      ev: "objectives",
      n: objectives.length,
      phase: "objectives call",
      ran: run.ran,
      model: run.model,
      ...(run.abandoned ? { abandoned: run.abandoned } : {}),
      gate10s: (timings.objectivesAll ?? 0) <= 10_000,
    });
    writeJson(`${o.outDir}/objectives.json`, {
      objectives,
      ran: run.ran,
      model: run.model,
      ...(run.abandoned ? { abandoned: run.abandoned } : {}),
      usage: run.result.usage,
      usd: run.result.usd,
      ms: run.result.ms,
      firstTokenMs: run.result.firstTokenMs,
    });
    // The teacher signs off: auto-approved at once in the bake-off.
    signOffMs = ms();
    timings.signOff = signOffMs;
    log({ ev: "sign-off", auto: true, objectives: objectives.length });
    // (2) At sign-off, the pupil wording runs beside the design call and fills slide 2 directly.
    const pupilSys = `${shared0}/pupil-objectives.txt`;
    if (existsSync(pupilSys)) {
      const schemaFile = `${shared0}/pupil-objectives-schema.json`;
      const userFile = `${shared0}/pupil-objectives-user.txt`;
      const teacherLines = objectives.map((x, k) => `${k + 1}. ${x.teacher}`).join("\n");
      const held = ledger.tryHold("pupil objectives", STEP_EST.objectives);
      const pupilUser = () =>
        existsSync(userFile)
          ? fillTemplate(readFileSync(userFile, "utf8"), brief, {
              objectives,
              maxWords: pupilWordLimit(brief.keyStage, objectives.length),
            })
          : `${brief.yearGroup} ${brief.subject}: ${brief.topic}\n\nTeacher objectives:\n${teacherLines}`;
      // Built inside the promise chain: a template fault falls back to teacher wording, never kills the run.
      pupilJob = (
        held
          ? Promise.resolve()
              .then(() =>
                pupilCall(
                  {
                    system: readFileSync(pupilSys, "utf8"),
                    user: pupilUser(),
                    schema: existsSync(schemaFile)
                      ? JSON.parse(readFileSync(schemaFile, "utf8"))
                      : pupilSchema(objectives.length),
                    name: "pupil_objectives",
                    maxTokens: 1500,
                  },
                  chatStream,
                  (line, k) => {
                    const x = objectives[k];
                    if (!x) return;
                    x.pupil = line;
                    if (k === 0) mark("slide2First");
                    laySlide2(`pupil objective ${k + 1}`);
                  },
                ),
              )
              .then((r) => {
                ledger.add("objectives", r.result.usd);
                log({
                  ev: "pupil-objectives",
                  n: r.pupil.length,
                  model: OBJECTIVES_CONFIG.pupil.model,
                  usd: r.result.usd,
                });
              })
          : Promise.reject(new Error("cap refused the pupil call"))
      )
        .catch((e) => log({ ev: "pupil-objectives-error", err: String(e).slice(0, 200) }))
        .finally(() => {
          held?.();
          // Any line still missing shows the teacher wording, so slide 2 is never short.
          for (const x of objectives) if (!x.pupil.trim()) x.pupil = x.teacher;
          laySlide2("objectives slide (pupil wording)");
          mark("slide2");
          mark("objectivesSlide");
        });
    } else {
      log({ ev: "pupil-objectives-skipped", why: "no shared/pupil-objectives.txt yet" });
      for (const x of objectives) x.pupil = x.teacher;
      laySlide2("objectives slide (teacher wording)");
      mark("slide2");
      mark("objectivesSlide");
    }
    // The design call's user turn: shared/user.txt with the approved teacher objectives.
    user = contextBlock(
      brief,
      objectives.map((x) => ({ teacher: x.teacher, pupil: "" })),
    );
  }
  const parser = new PartialJson(onValue);
  const p = arm.prompt(brief);
  writeJson(`${o.outDir}/request.json`, {
    model: p.model,
    effort: p.effort,
    user,
    systemChars: p.system.length,
  });
  const heldMain = await mustHold(ledger, "main call", o.replay ? 0 : STEP_EST.main);
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
  // Round 4: a notes schema with a top-level `slides` array is one call per lesson, after repair.
  const lessonNotesCall =
    hasNotesPrompt &&
    "slides" in
      ((JSON.parse(readFileSync(`${shared}/notes-schema.json`, "utf8")) as { properties?: object })
        .properties ?? {});
  for (let i = 0; i < n; i++) {
    const s = plan.slides[i];
    if (!s) continue;
    if (typeof s.notes === "string") {
      notes.set(i, { notes: s.notes, answers: (s.answers as string[]) ?? [] });
      continue;
    }
    if (o.noNotes || !hasNotesPrompt || lessonNotesCall) continue;
    const system = readFileSync(`${shared}/notes.txt`, "utf8");
    const schema = JSON.parse(readFileSync(`${shared}/notes-schema.json`, "utf8"));
    const u = `${user}\n\nLesson:\n${main.text}\n\nSlide: ${i + 1}`;
    notesJobs.push(
      (async () => {
        const held = await mustHold(ledger, `notes s${i + 1}`, STEP_EST.notes);
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
  await pupilJob;
  await Promise.all(notesJobs);
  if (notesJobs.length) mark("notes");
  // Visual jobs may add more jobs as they land: wait until none are left.
  for (let k = 0; k < jobs.length; k = jobs.length) await Promise.all(jobs.slice(k));
  for (let i = 0; i < n; i++) relay(i, "final");
  mark("visualsDone");

  // ── d. code checks ──
  const check = () => {
    const out = baseCheck();
    // Round 6: a slide that repeats another goes to repair to be made different or merged.
    const dup = duplicateFaults(
      Array.from({ length: n }, (_, i) => i)
        .filter((i) => repairable(plan.slides[i] as Record<string, unknown>, i))
        .map((i) => {
          const sl = plan.slides[i] as Record<string, unknown>;
          return { index: i, heading: String(sl.heading ?? ""), words: arm.words(sl) };
        }),
    );
    for (const [i, f] of dup) out[i]?.faults.push(f);
    return out;
  };
  const baseCheck = () =>
    Array.from({ length: n }, (_, i) =>
      checkSlide({
        specs: (asks.get(i) ?? []).flatMap((a) => {
          const v = visuals.get(`${i}:${a.key}`) as { status?: string; spec?: unknown } | undefined;
          return a.type === "diagram" && v?.status === "diagram" && v.spec ? [v.spec] : [];
        }),
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
  // Round 7 (prompts "round 7 draft"): visual requests carry ask / ask_without, and the arm shows
  // the right one by construction, so a visual-dangling fault only reports.
  const hasAsks = (x: unknown): boolean =>
    !!x &&
    typeof x === "object" &&
    ("ask_without" in x ||
      Object.values(x as object).some((v) => (Array.isArray(v) ? v.some(hasAsks) : hasAsks(v))));
  const asksPrompt = plan.slides.some(hasAsks);
  const VISUAL_DANGLING = /^(dangling: .* no picture|unanswerable:)/;
  const pickFailing = () =>
    checks
      .map((c) =>
        asksPrompt ? { ...c, faults: c.faults.filter((f) => !VISUAL_DANGLING.test(f)) } : c,
      )
      .filter((c) => {
        const i = c.slide - 1;
        const ok = c.faults.length > 0 && repairable(plan.slides[i] as Record<string, unknown>, i);
        if (c.faults.length && !ok)
          log({ ev: "repair-not-allowed", slide: c.slide, faults: c.faults });
        return ok;
      });
  let failing = pickFailing();
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
  const swapSlide = async (i: number, next0: Record<string, unknown>) => {
    const next = slideNoEmDash(next0);
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
  // ── e0. round 4 objective coverage: one targeted repair when an objective has no teaching or
  // checking slide (y11 round 3 dropped catalysts), before the fit repair so new slides get checks.
  const objRepairSys = `${shared}/objective-repair.txt`;
  if (
    plan.flow?.some((f) => Array.isArray(f.teaches)) &&
    existsSync(objRepairSys) &&
    existsSync(repairSchema) &&
    (plan.objectives?.length ?? 0) > 0
  ) {
    const flow = plan.flow;
    const slides = plan.slides as Record<string, unknown>[];
    const held = await ledger.holdWhenFree("objective repair", STEP_EST.objectiveRepair);
    if (held) {
      const out = await repairObjectives({
        plan: { flow, slides },
        objectives: (plan.objectives ?? []).map((x) => x.teacher),
        context: user,
        system: readFileSync(objRepairSys, "utf8"),
        schema: objectiveRepairSchema(JSON.parse(readFileSync(repairSchema, "utf8"))),
        chat,
        log,
        onUsd: (v) => ledger.add("repair", v),
      }).finally(held);
      if (out.repaired) {
        plan.flow = out.plan.flow as Plan["flow"];
        for (let i = 2; i < n; i++)
          if (out.plan.slides[i] !== slides[i])
            await swapSlide(i, out.plan.slides[i] as Record<string, unknown>);
        checks = check();
        failing = pickFailing();
        save("objective repair");
      }
    } else log({ ev: "objective-repair-refused" });
  }
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
  const repairOne = async (
    c: CheckResult,
    mode: "fit" | "stand-alone" = "fit",
  ): Promise<boolean> => {
    if (!existsSync(repairSys) || !existsSync(repairSchema)) return false;
    const system = readFileSync(repairSys, "utf8");
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
          "the slide's JSON exactly as the main call wrote it": JSON.stringify(plan.slides[i]),
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
    if (o.replayRepair || (mode === "stand-alone" && o.replay)) {
      out = mode === "fit" ? recorded.get(i + 1) : undefined;
      if (!out) return false;
    } else {
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
      `${JSON.stringify({ slide: i + 1, mode, faults: c.faults, input: plan.slides[i], out })}\n`,
    );
    const o2 = out as { slide?: Record<string, unknown>; to_notes?: unknown; fix?: string };
    if (!o2?.slide || typeof o2.slide !== "object") {
      log({ ev: "repair", slide: i + 1, usd, ok: false });
      return false;
    }
    const before = plan.slides[i] as Record<string, unknown>;
    o2.slide = keepAsksHonest(before, o2.slide);
    const moved = (Array.isArray(o2.to_notes) ? o2.to_notes : [o2.to_notes ?? ""]).map(String);
    const verdict = judgeRepair(before, o2.slide, moved, {
      diagramFault: c.faults.some((f) => f.startsWith("diagram:")),
    });
    // A stand-alone rewrite drops the visual that is not there: losing it is the point.
    const why = verdict.ok
      ? []
      : // Round 6 run (y4 s3/s10 rejected for losing "look, closely"): a stand-alone rewrite loses
        // the pointing words by design, so neither the figure nor those words count against it.
        verdict.why.filter((w) => mode !== "stand-alone" || !/^lost (the|\d+ of)/.test(w));
    if (why.length) {
      log({
        ev: "repair-rejected",
        slide: i + 1,
        mode,
        fix: o2.fix,
        why,
        faults: c.faults,
      });
      return false;
    }
    const n0 = notes.get(i);
    const saved = await swapSlide(i, o2.slide);
    applyRepair(plan.slides, notes, i, out);
    // The same fault kind still there, or a new one: keep the original slide (and its flag).
    // A slide the notes call never reached has no answers to check (offline replays, a failed
    // notes call): to_notes alone must not raise an "unanswered" fault and revert the repair.
    const now = (check()[i]?.faults ?? []).filter((f) => n0 || !f.startsWith("unanswered"));
    const was = kinds(c.faults);
    const worse =
      mode === "stand-alone"
        ? now.some((f) => /^(dangling|unanswerable):/.test(f))
        : [...kinds(now)].some((k) => was.has(k)) || now.length > c.faults.length;
    if (worse) restore(i, before, n0, saved);
    else if (c.faults.some((f) => f.startsWith("diagram:"))) path.set(i, "diagram-repaired");
    log({ ev: "repair", slide: i + 1, mode, usd, ok: true, fix: o2.fix, reverted: worse, now });
    return !worse;
  };
  if (!o.noRepair && failing.length) {
    if (!existsSync(repairSys) || !existsSync(repairSchema))
      log({ ev: "repair-skipped", why: "no repair prompt yet", failing: failing.length });
    else {
      await Promise.all(failing.map((c) => repairOne(c)));
      mark("repaired");
    }
  }
  // A diagram that still cannot draw: a picture of the same thing when it is a real, concrete
  // thing (the picture director, the diagram's `shows` as the request); else words only.
  // Round 3 profile (R2 y11: checks at 51 s, done at 100 s): the slides' fallbacks ran one after
  // another; they run side by side now.
  const fallback = async (i: number) => {
    const dAsk = (asks.get(i) ?? []).find((a) => a.type === "diagram") as
      | Extract<VisualAsk, { type: "diagram" }>
      | undefined;
    if (!dAsk || path.has(i)) return;
    if (!laid.get(i)?.diagram?.length && visuals.get(`${i}:${dAsk.key}`)?.status === "diagram") {
      path.set(i, "diagram");
      return;
    }
    const s = plan.slides[i] as Record<string, unknown>;
    // Round 5 (visual or fallback): a diagram whose spec never came back (an API error, y7 r4) is
    // asked once more before anything else.
    const k = `${i}:${dAsk.key}`;
    if (visuals.get(k)?.status === "failed" && !o.noVisuals && !o.replay) {
      const sl = plan.slides[i] as Record<string, unknown>;
      startDiagram(
        i,
        dAsk,
        `${String(sl.heading ?? "")}\n${arm.words(sl)}`,
        String(sl.heading ?? ""),
      );
      await settle();
      relay(i, "diagram retry");
      if (!laid.get(i)?.diagram?.length && visuals.get(k)?.status === "diagram") {
        path.set(i, "diagram-retry");
        return;
      }
    }
    // Then a picture of the same thing: any kind that shows a thing or process (particles, flow,
    // cycle, layers...), not only concrete ones; data kinds (graphs, tables) cannot be pictures.
    const pic = pictureFallbackOk(dAsk.kind, dAsk.shows) ? arm.asPicture?.(s) : undefined;
    if (pic) {
      const n0 = notes.get(i);
      const saved = await swapSlide(i, pic);
      const got = (asks.get(i) ?? []).some((a) => visuals.get(`${i}:${a.key}`)?.status === "photo");
      if (got) {
        path.set(i, "picture");
        return;
      }
      restore(i, s, n0, saved);
    }
    // Round 4 (y11 s6 "Read the results" lost its data table and asked for a trend from nothing):
    // a table is words already, so one that cannot draw keeps its data as text lines.
    const t = tableRows(visuals.get(`${i}:${dAsk.key}`), dAsk);
    const asText = dAsk.kind === "table" && t.rows.length ? arm.asTableText?.(s, t) : undefined;
    if (asText) {
      await swapSlide(i, asText);
      path.set(i, "table-text");
      return;
    }
    // Words only as the last resort. Round 6: the pointing words stay for now, so the stand-alone
    // stage below rewrites them (a call) before it strips them.
    const words = arm.asWords?.(s, { keepPointing: true });
    if (words && JSON.stringify(words) !== JSON.stringify(s)) await swapSlide(i, words);
    path.set(i, "words");
  };
  await Promise.all(Array.from({ length: n }, (_, i) => fallback(i)));
  for (const [i, p] of path) log({ ev: "visual-path", slide: i + 1, path: p });
  // ── e2. round 6: visual or rewrite. Words that point at a visual the slide does not show (r5 y2
  // s3/s5, y4 s4, y12 s7) are rewritten to stand alone; failing that, the pointing sentences go.
  // Never a silent text-only slide: every one is logged with how it ended.
  // Round 7: the swap is by construction (ask / ask_without in the arm); the referent regex only
  // reports. The rewrite-or-strip below runs only for a slide with no ask fields (older prompts).
  const DANGLING = /^(dangling|unanswerable):/;
  const standAlone = async (i: number) => {
    const s0 = plan.slides[i] as Record<string, unknown> | undefined;
    if (!s0 || !repairable(s0, i)) return;
    const hit = check()[i]?.faults.find((f) => DANGLING.test(f));
    if (!hit) return;
    if (asksPrompt) {
      log({ ev: "stand-alone", slide: i + 1, fault: hit, how: "report" });
      return;
    }
    let how = "left";
    const fault = `${hit}; no visual can be made for it, so the words must stand alone`;
    if (!o.noRepair && (await repairOne({ slide: i + 1, faults: [fault] }, "stand-alone")))
      how = "rewrite";
    else {
      const s = plan.slides[i] as Record<string, unknown>;
      const words = arm.asWords?.(s);
      // A strip that leaves a fragment ("Tell your partner why.") is no slide: it stays flagged.
      const count = (x: Record<string, unknown>) =>
        (arm.words(x).match(/\S+/g) ?? []).length - String(x.heading ?? "").split(/\s+/).length;
      const kept = words ? count(words) / Math.max(1, count(s)) : 0;
      if (words && JSON.stringify(words) !== JSON.stringify(s) && kept >= 0.6) {
        const n0 = notes.get(i);
        const saved = await swapSlide(i, words);
        if (check()[i]?.faults.some((f) => DANGLING.test(f))) restore(i, s, n0, saved);
        else how = "strip";
      }
    }
    log({ ev: "stand-alone", slide: i + 1, fault: hit, how });
  };
  await Promise.all(Array.from({ length: n }, (_, i) => standAlone(i)));
  // ── f. round 4 notes: one call on the final slides as rendered, only placed visuals listed ──
  if (lessonNotesCall && !o.noNotes) {
    const placed = (i: number) =>
      (asks.get(i) ?? []).flatMap((a) => {
        const v = visuals.get(`${i}:${a.key}`);
        // Round 5 (notes audit: marble chips described as magnesium): what the placed picture is,
        // its own alt and the subjects the judge saw in it, not what was asked for.
        if (v?.status === "photo") return [`Picture: ${placedPictureText(v.photo, a.shows)}`];
        if (v?.status === "diagram" && a.type === "diagram")
          return [`Diagram (${a.kind}): ${(a.labels ?? []).join(", ")}`];
        return [];
      });
    // Title and objectives slides get no notes (audit d): they are left out of the call.
    const lines = Array.from({ length: n }, (_, i) => i)
      .filter((i) => i >= 2)
      .map((i) => renderedLines(i + 1, (laid.get(i)?.slide.elements ?? []) as never, placed(i)))
      .join("\n\n");
    const userNotes = fillTemplate(readFileSync(`${shared}/notes-user.txt`, "utf8"), brief, {
      objectives: plan.objectives,
      context: user,
      slidesAsShown: lines,
    });
    const held = await ledger.holdWhenFree("lesson notes", STEP_EST.notes * n);
    if (held) {
      const got = await lessonNotes({
        slides: n,
        first: 3,
        system: readFileSync(`${shared}/notes.txt`, "utf8"),
        user: userNotes,
        schema: JSON.parse(readFileSync(`${shared}/notes-schema.json`, "utf8")),
        chat,
        log,
        onUsd: (v) => ledger.add("notes", v),
      }).finally(held);
      for (const [k, s0] of got) {
        if (k < 3 || k > n) continue;
        // Audit b: a multiple-choice answer starts with the correct letter as rendered.
        const s = { ...s0, answers: withCorrectLetter(s0.answers, plan.slides[k - 1]) };
        notes.set(k - 1, { notes: notesText(s), answers: s.answers ? [s.answers] : [] });
      }
      writeJson(`${o.outDir}/notes.json`, { slides: [...got.values()] });
      mark("notes");
    } else log({ ev: "notes-refused" });
  }
  checks = check();
  // Round 7: every slide that shows an `ask_without` line, and why its visual is not there.
  const askWithout: { slide: number; key: string; why: string; line: string }[] = [];
  for (const [i, s0] of firstSlides) {
    const holders: [string, Record<string, unknown>][] = [];
    for (const k of ["picture", "diagram", "figure"]) {
      const f = s0[k];
      if (f && typeof f === "object") holders.push([k, f as Record<string, unknown>]);
    }
    (Array.isArray(s0.columns) ? (s0.columns as Record<string, unknown>[]) : []).forEach((c, n) => {
      if (c?.picture && typeof c.picture === "object")
        holders.push([`col.${n}`, c.picture as Record<string, unknown>]);
    });
    if (s0.template === "picture-sequence") holders.push(["seq.0", s0]);
    for (const [k, f] of holders) {
      const line = typeof f.ask_without === "string" ? f.ask_without.trim() : "";
      if (!line) continue;
      const keys = (asks.get(i) ?? []).map((a) => a.key);
      const key =
        keys.find((x) => x === k) ??
        (["picture", "diagram", "figure"].includes(k)
          ? keys.find((x) => ["picture", "diagram", "figure"].includes(x))
          : keys.find((x) => x.startsWith(k.split(".")[0] ?? k))) ??
        k;
      const st = visuals.get(`${i}:${key}`)?.status ?? "none";
      const dropped = laid.get(i)?.diagram;
      const p = path.get(i);
      const now = plan.slides[i] as Record<string, unknown>;
      const gone = !hasAsks(now);
      const why =
        st === "failed" || st === "none"
          ? `${st}${p ? `, then ${p}` : ""}`
          : dropped?.length
            ? `layout dropped: ${dropped.join("; ").slice(0, 160)}`
            : gone
              ? `fallback ${p ?? "swap"}`
              : st === "pending"
                ? "never landed"
                : p === "picture"
                  ? "diagram failed; a picture with the stand-alone line"
                  : "";
      if (why) askWithout.push({ slide: i + 1, key: k, why, line: line.slice(0, 160) });
    }
  }
  for (const a of askWithout) log({ ev: "ask-without", ...a });
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
    askWithout,
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
    "slide2First",
    "slide2",
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
              "slide2",
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

/**
 * Round 3: which lesson slide a streamed value is. The T schema (prompts/T/make_schema.py) makes
 * slide 1 and 2 structural: top-level `title` and `objectives` objects, then `slides` = slide 3 on.
 * Older schemas (and K/R) put every slide in `slides`. The two layouts are told apart by the
 * stream itself: a top-level `title` object switches the offset on.
 */
export function slideIndexer() {
  let split = false;
  return (path: Path, v: unknown): number | undefined => {
    const isSlide = !!v && typeof v === "object" && !Array.isArray(v);
    if (path.length === 1 && path[0] === "title" && isSlide) {
      split = true;
      return 0;
    }
    if (path.length === 1 && path[0] === "objectives" && isSlide) return 1;
    if (path.length === 2 && path[0] === "slides" && typeof path[1] === "number")
      return path[1] + (split ? 2 : 0);
    return undefined;
  };
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
