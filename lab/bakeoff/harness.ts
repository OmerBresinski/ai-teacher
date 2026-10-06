// BAKEOFF shared harness: one streamed planning call, slides materialised as they complete, pictures
// and diagrams in parallel, notes per slide, code checks, one bounded repair, timings and cost.
// The layout step is an `ArmPlugin` (arm T: templates; K: blocks + recipes; R: reference slides).
// See BAKEOFF/HARNESS.md.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import type { Slide, Theme } from "@tj/domain/documents";
import { renderDiagram } from "../../packages/slides/src/diagrams/index";
import { getTheme, withKeyStage } from "../../packages/slides/src/themes";
import { type CheckResult, checkSlide } from "./checks";
import { PartialJson, type Path } from "./partial";
import {
  BAKEOFF,
  chat,
  chatStream,
  type DiagramAsk,
  diagramSpec,
  Ledger,
  type PhotoAsk,
  type PhotoResult,
  pictureService,
  replayStream,
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
};

/** A visual a slide asks for, as the plugin reads it off the slide JSON. */
export type VisualAsk =
  | { key: string; type: "photo"; shows: string; mustSee: string[]; named: boolean }
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
};

export type Plan = {
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
  visuals(slide: Record<string, unknown>, index: number): VisualAsk[];
  /** Lay one slide out from its JSON and the visuals' current states. Called again whenever a visual lands. */
  materialise(slide: Record<string, unknown>, ctx: MaterialiseCtx): Materialised;
  /** The questions on a slide (for the answerable check and the notes' answers). */
  questions(slide: Record<string, unknown>): string[];
  /** The slide's own words (for checks, the picture director and the diagram spec call). */
  words(slide: Record<string, unknown>): string;
  /** Optional: the title slide made in code from the brief before the call returns anything. */
  codeTitle?(brief: Brief, ctx: Omit<MaterialiseCtx, "index" | "plan" | "visual">): Materialised;
}

/* ------------------------------------------------------------------ */
/* Context block (the main call's user turn)                           */
/* ------------------------------------------------------------------ */

/**
 * The user turn: BAKEOFF/prompts/shared/user.txt (the prompt agent's) with {{field}}, {{a.b}} and
 * {{flag ? "yes" : "no"}} filled from the brief; a plain field list when there is none yet.
 */
export function contextBlock(b: Brief): string {
  const f = `${BAKEOFF}/prompts/shared/user.txt`;
  const get = (path: string): unknown =>
    path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], b);
  if (existsSync(f))
    return readFileSync(f, "utf8")
      .trim()
      .replace(/\{\{([^}]+)\}\}/g, (_, expr: string) => {
        const t = expr.match(/^\s*([\w.]+)\s*\?\s*"([^"]*)"\s*:\s*"([^"]*)"\s*$/);
        if (t) return get(t[1] as string) ? (t[2] as string) : (t[3] as string);
        const v = get(expr.trim());
        if (v === undefined) throw new Error(`user.txt: no brief field ${expr}`);
        return String(v);
      });
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
  /** Skip pictures and diagrams (layout-only dry run). */
  noVisuals?: boolean;
  /** Skip the notes calls. */
  noNotes?: boolean;
  /** Skip the repair pass. */
  noRepair?: boolean;
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
  const theme = withKeyStage(brief.keyStage, () => getTheme(brief.theme, brief.keyStage));
  const base = { brief, theme, stage: brief.keyStage };
  const plan: Plan = { slides: [] };
  const lessonId = `bakeoff-${arm.id}-${brief.id}`;
  const lessonFile = `${o.outDir}/lesson.json`;

  // ── state ──
  const visuals = new Map<string, VisualState>();
  const asks = new Map<number, VisualAsk[]>();
  const laid = new Map<number, Materialised>();
  const notes = new Map<number, { notes: string; answers: string[] }>();
  let title: Materialised | undefined;

  const save = (why: string) => {
    const slides: Slide[] = [];
    const n = Math.max(plan.slides.length, 1);
    for (let i = 0; i < n; i++) {
      const m = laid.get(i) ?? (i === 0 ? title : undefined);
      if (!m) continue;
      slides.push({ id: `s${i + 1}`, ...m.slide, notes: notes.get(i)?.notes ?? "" } as Slide);
    }
    writeJson(lessonFile, {
      version: 1,
      id: lessonId,
      title: (plan.slides[0]?.heading as string) ?? brief.topic,
      themeId: brief.theme,
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
  const pics = o.noVisuals
    ? undefined
    : pictureService({ runDir: o.outDir, pgPort: o.pgPort, ledger, bankCapUsd: 0.03 });
  const jobs: Promise<void>[] = [];
  const lessonInfo = {
    id: lessonId,
    title: brief.topic,
    yearGroup: brief.yearGroup,
    subject: brief.subject,
    base: {},
  };
  /** Early picture jobs from the flow, keyed by slide index; a slide's single picture takes it over. */
  const early = new Map<number, Promise<PhotoResult | undefined>>();
  const startPhoto = (
    i: number,
    a: Extract<VisualAsk, { type: "photo" }>,
    words: { heading: string; text: string },
  ) => {
    if (!pics) return;
    const k = `${i}:${a.key}`;
    visuals.set(k, { status: "pending" });
    const ask: PhotoAsk = {
      key: k,
      shows: a.shows,
      mustSee: a.mustSee,
      named: a.named,
      slide: { heading: words.heading, text: words.text, point: "" },
      index: i,
    };
    log({ ev: "picture-start", key: k, shows: a.shows });
    return pics.find(ask, lessonInfo);
  };
  const landPhoto = (i: number, key: string, p: Promise<PhotoResult | undefined>) =>
    jobs.push(
      p.then((r) => {
        visuals.set(`${i}:${key}`, r ? { status: "photo", photo: r } : { status: "failed" });
        log({
          ev: "picture-done",
          key: `${i}:${key}`,
          ok: !!r,
          src: r?.src,
          provider: r?.provider,
        });
        mark("lastPicture");
        timings.lastPicture = ms();
        relay(i, "picture");
      }),
    );
  const startDiagram = (i: number, a: Extract<VisualAsk, { type: "diagram" }>, words: string) => {
    const k = `${i}:${a.key}`;
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
        .then((spec) => {
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
    if (top === "objectives" && path.length === 1) {
      plan.objectives = v as Plan["objectives"];
      log({ ev: "objectives", n: plan.objectives?.length });
      mark("objectives");
    }
    if (top === "flow" && path.length === 1) {
      plan.flow = v as Plan["flow"];
      mark("flow");
      log({ ev: "flow", n: plan.flow?.length });
      // Every picture the flow names starts now (one per slide; a sequence starts at its slide).
      for (const f of plan.flow ?? []) {
        const i = f.slide - 1;
        if (f.look_at?.kind === "picture" && f.look_at.shows && i > 0) {
          const p = startPhoto(
            i,
            { key: "early", type: "photo", shows: f.look_at.shows, mustSee: [], named: false },
            { heading: f.does, text: "" },
          );
          if (p) early.set(i, p);
        }
      }
      // The objectives slide exists as soon as objectives do (slide 2 is always objectives).
    }
    if (top === "slides" && path.length === 2 && typeof idx === "number") {
      const s = v as Record<string, unknown>;
      plan.slides[idx] = s;
      const as = arm.visuals(s, idx);
      asks.set(idx, as);
      const words = arm.words(s);
      const heading = String(s.heading ?? "");
      const photos = as.filter(
        (a): a is Extract<VisualAsk, { type: "photo" }> => a.type === "photo",
      );
      const e = early.get(idx);
      photos.forEach((a, n) => {
        // The slide's first picture takes over the flow's early job (already running).
        if (n === 0 && e) {
          visuals.set(`${idx}:${a.key}`, { status: "pending" });
          landPhoto(idx, a.key, e);
          return;
        }
        const p = startPhoto(idx, a, { heading, text: words });
        if (p) landPhoto(idx, a.key, p);
      });
      if (!o.noVisuals)
        for (const a of as) if (a.type === "diagram") startDiagram(idx, a, `${heading}\n${words}`);
      relay(idx, "slide");
      if (idx === 1) mark("objectivesSlide");
      if (idx >= 2) mark("firstTeachingSlide");
    }
  };
  const parser = new PartialJson(onValue);
  const p = arm.prompt(brief);
  const user = contextBlock(brief);
  writeJson(`${o.outDir}/request.json`, {
    model: p.model,
    effort: p.effort,
    user,
    systemChars: p.system.length,
  });
  ledger.guard("main call");
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
        },
        (d) => parser.push(d),
      );
  ledger.add("main", main.usd);
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
        ledger.guard(`notes s${i + 1}`);
        const r = await chat({
          model: "gpt-6-luna",
          effort: "low",
          system,
          user: u,
          schema,
          name: "notes",
        });
        ledger.add("notes", r.usd);
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
  const repairSchema = `${BAKEOFF}/prompts/${arm.id}/repair-schema.json`;
  const failing = checks.filter((c) => c.faults.length);
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
          const u = `${user}\n\nSlide ${i + 1}:\n${JSON.stringify(plan.slides[i])}\n\nWhat the check found:\n${[...c.faults, ...found].map((f) => `- ${f}`).join("\n")}`;
          try {
            ledger.guard(`repair s${i + 1}`);
            const r = await chat({
              model: "gpt-6-luna",
              effort: "low",
              system,
              user: u,
              schema: JSON.parse(readFileSync(repairSchema, "utf8")),
              name: "slide",
            });
            ledger.add("repair", r.usd);
            if (r.out) {
              plan.slides[i] = r.out as Record<string, unknown>;
              relay(i, "repair");
            }
            log({ ev: "repair", slide: i + 1, usd: r.usd, ok: !!r.out });
          } catch (e) {
            log({ ev: "repair-error", slide: i + 1, err: String(e).slice(0, 200) });
          }
        }),
      );
      checks = check();
      mark("repaired");
    }
  }
  save("done");
  mark("done");
  const cost = { ...ledger.parts, picturesDirector: pics?.aiSpend() ?? 0 };
  const total = Object.values(cost).reduce((a, b) => a + b, 0);
  writeJson(`${o.outDir}/timings.json`, {
    ms: {
      title: timings.title,
      objectivesSlide: timings.objectivesSlide,
      firstTeachingSlide: timings.firstTeachingSlide,
      editable: timings.editable,
      lastPicture: timings.lastPicture,
      lastDiagram: timings.lastDiagram,
      lastVisual: Math.max(timings.lastPicture ?? 0, timings.lastDiagram ?? 0) || undefined,
      notes: timings.notes,
      done: timings.done,
    },
    all: timings,
    mainCall: { ms: main.ms, firstTokenMs: main.firstTokenMs },
  });
  writeJson(`${o.outDir}/cost.json`, {
    ...cost,
    total: Number(total.toFixed(5)),
    main: cost.main ?? 0,
  });
  writeJson(`${o.outDir}/checks.json`, { count, slides: checks });
  return { lessonFile, timings, cost: { ...cost, total }, checks };
}

/** Render helper for plugins: a diagram spec's SVG at a size, at the stage's type scale. */
export const drawDiagram = (
  spec: unknown,
  theme: Theme,
  stage: Stage,
  size: { w: number; h: number },
) => withKeyStage(stage, () => renderDiagram(spec, theme, size));
