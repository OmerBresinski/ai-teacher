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
    writeJson(lessonFile, {
      version: 1,
      id: lessonId,
      title: (plan.slides[0]?.heading as string) ?? brief.topic,
      themeId,
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
    : pictureService({
        runDir: o.outDir,
        pgPort: o.pgPort,
        ledger,
        bankCapUsd: 0.03,
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
    if (!pics) return;
    const k = `${i}:${a.key}`;
    visuals.set(k, { status: "pending" });
    const ask: PhotoAsk = {
      key: k,
      shows: a.shows,
      mustSee: a.mustSee,
      named: a.named,
      ...(a.aspect ? { aspect: a.aspect } : {}),
      ...(plan.design?.picture_style ? { style: plan.design.picture_style } : {}),
      slide: { heading: words.heading, text: words.text, point: "" },
      index: i,
    };
    log({ ev: "picture-start", key: k, shows: a.shows, aspect: a.aspect });
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
      photos.forEach((a, n) => {
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
        for (const a of as) if (a.type === "diagram") startDiagram(idx, a, `${heading}\n${words}`);
      relay(idx, "slide");
      if (idx === 1) mark("objectivesSlide");
      if (idx >= 2) mark("firstTeachingSlide");
    }
  };
  function applyDesign() {
    const d = plan.design ?? {};
    const chosen = brief.teacherTheme ? brief.teacherTheme : d.theme;
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
    ledger.guard("objectives call");
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
  // The arm's per-stage repair schema and layouts menu (prompts/<arm>/repair-schema.<stage>.json, layouts.<stage>.txt).
  const stageKey =
    arm.promptStage?.(brief) ??
    (brief.keyStage === "ks1" ? "KS1" : brief.keyStage === "ks2" ? "KS2" : "KS3-5");
  const armDir = `${BAKEOFF}/prompts/${arm.id}`;
  const repairSchema = existsSync(`${armDir}/repair-schema.${stageKey}.json`)
    ? `${armDir}/repair-schema.${stageKey}.json`
    : `${armDir}/repair-schema.json`;
  const repairUser = `${shared}/repair-user.txt`;
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
          const placed = ask.flatMap((a) => {
            const v = visuals.get(`${i}:${a.key}`);
            return v?.status === "photo" ? [`${a.key}: ${v.photo.about ?? v.photo.alt}`] : [];
          });
          const u = existsSync(repairUser)
            ? fillTemplate(readFileSync(repairUser, "utf8"), brief, {
                context: user,
                N: i + 1,
                "the arm's layouts menu for this key stage: <arm>/layouts.<stage>.txt": existsSync(
                  `${armDir}/layouts.${stageKey}.txt`,
                )
                  ? readFileSync(`${armDir}/layouts.${stageKey}.txt`, "utf8").trim()
                  : "",
                "the slide's JSON exactly as the main call wrote it": JSON.stringify(
                  plan.slides[i],
                ),
                [String(
                  readFileSync(repairUser, "utf8").match(
                    /\{\{(one line per placed picture[^}]*)\}\}/,
                  )?.[1] ?? "-",
                )]: placed.length ? placed.join("\n") : "none",
                [String(
                  readFileSync(repairUser, "utf8").match(
                    /\{\{(one line per fault[^}]*)\}\}/,
                  )?.[1] ?? "-",
                )]: [...c.faults, ...found].sort().join("\n"),
              })
            : `${user}\n\nSlide ${i + 1}:\n${JSON.stringify(plan.slides[i])}\n\nWhat the check found:\n${[...c.faults, ...found].map((f) => `- ${f}`).join("\n")}`;
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
