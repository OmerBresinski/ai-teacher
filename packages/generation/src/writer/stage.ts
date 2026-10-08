import type { Slide, Theme } from "@tj/domain/documents";
import { getTheme } from "@tj/slides/themes";
import { type CheckResult, checkSlide, duplicateFaults, slideNoEmDash } from "./checks";
import {
  applyRepair,
  asksVisual,
  type Brief,
  charsOver,
  contextBlock,
  fillTemplate,
  keepAsksHonest,
  layoutsFor,
  lookOf,
  OVERFLOW,
  overflowPt,
  promptStage,
  repairTerms,
  shuffleHinge,
  withCorrectLetter,
  withLook,
  writerIncomplete,
} from "./fixes";
import { judgeRepair, repairable, sameFigure, teaching } from "./guards";
import { localise } from "./locale";
import {
  codeObjectives,
  codeTitle,
  type Materialised,
  materialise,
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
import { writerSchema } from "./schema";
import {
  SMALL_MODEL,
  WRITER_EFFORT,
  WRITER_MAX_TOKENS,
  WRITER_MODEL,
  type WriterServices,
} from "./services";
import * as P from "./writer-prompts.gen";

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
  constructor(readonly why: string) {
    super(`writer output incomplete: ${why}`);
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
  /** Called as soon as every slide is laid out (the editable deck), before repair and notes. */
  onEditable?: (slides: WriterSlide[]) => Promise<void> | void;
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
export function writerSystem(brief: Brief): string {
  const k = promptStage(brief.keyStage);
  return k === "KS1" ? P.systemKS1 : k === "KS2" ? P.systemKS2 : P.systemKS3_5;
}
const repairSchemaFor = (k: string) =>
  JSON.parse(
    k === "KS1" ? P.repairSchemaKS1 : k === "KS2" ? P.repairSchemaKS2 : P.repairSchemaKS3_5,
  );
const layoutsMenu = (k: string) =>
  k === "KS1" ? P.layoutsKS1 : k === "KS2" ? P.layoutsKS2 : P.layoutsKS3_5;
const baseVisuals = (k: string) =>
  k === "KS1" ? P.baseVisualsKS1 : k === "KS2" ? P.baseVisualsKS2 : P.baseVisualsKS3_5;

export async function runWriter(run: WriterRun): Promise<WriterOutput> {
  const { brief } = run;
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
  const visualState = (i: number) => (key: string) => {
    const was = carried.get(`${i}:${key}`);
    if (was)
      return run.visual ? run.visual(i, was.key, was.ask) : ({ status: "pending" } as VisualState);
    const a = (asks.get(i) ?? []).find((x) => x.key === key);
    return a && run.visual ? run.visual(i, key, a) : ({ status: "pending" } as VisualState);
  };
  const relay = (i: number) => {
    const s = plan.slides[i];
    if (!s) return;
    laid.set(i, materialise(s, { ...base, index: i, plan, visual: visualState(i) }));
  };
  const title = codeTitle(brief, base);
  laid.set(0, title);
  laid.set(1, codeObjectives({ ...base, index: 1, plan }));

  // ── the writer call ──
  const user = contextBlock(
    brief,
    run.objectives.map((t) => ({ teacher: t, pupil: "" })),
  );
  const stageKey = promptStage(brief.keyStage);
  const schema = writerSchema(stageKey, brief.slides);
  const main = run.recordedWriter
    ? { usd: 0, ms: 0, ...run.recordedWriter }
    : await run.services.writer(
        {
          model: WRITER_MODEL,
          effort: WRITER_EFFORT,
          system: writerSystem(brief),
          user: localise(user),
          schema,
          name: "lesson",
          maxTokens: WRITER_MAX_TOKENS,
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
    relay(idx);
  }
  const n = plan.slides.length;
  const deck = (): WriterSlide[] => {
    const slides: WriterSlide[] = [];
    for (let i = 0; i < Math.max(n, 2); i++) {
      const m = laid.get(i) ?? (i === 0 ? title : undefined);
      if (!m) continue;
      slides.push({ id: `s${i + 1}`, ...m.slide, notes: notes.get(i)?.notes ?? "" });
    }
    return slides;
  };
  await run.onEditable?.(deck());

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
    return res;
  };
  let checks = check();
  log({ ev: "checks", failing: checks.filter((c) => c.faults.length).length });

  // ── objective coverage: one targeted repair when an objective has no teaching or checking slide ──
  const swapSlide = (i: number, next0: S) => {
    const next = slideNoEmDash(next0);
    const oldAsks = asks.get(i) ?? [];
    const oldCarried = new Map(oldAsks.map((a) => [a.key, carried.get(`${i}:${a.key}`)]));
    plan.slides[i] = next;
    const newAsks = visualsOf(next, i, { ...base, plan });
    asks.set(i, newAsks);
    for (const a of newAsks) {
      const was = oldAsks.find((b) =>
        sameFigure({ type: b.type, shows: b.shows }, { type: a.type, shows: a.shows }),
      );
      if (was && was.key !== a.key)
        carried.set(`${i}:${a.key}`, oldCarried.get(was.key) ?? { key: was.key, ask: was });
      else if (!was) carried.delete(`${i}:${a.key}`);
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
  const diagramKinds = () =>
    baseVisuals(stageKey)
      .match(/Diagram kinds:[\s\S]*?(?=\n\s*\n|$)/)?.[0]
      .trim() ?? "";
  const repairOne = async (
    c: CheckResult,
    ro: { keepPartial?: boolean } = {},
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
    const hasDiagram = ask.some((a) => a.type === "diagram");
    const faultLines = c.faults.map((f) => repairTerms(f, plan.slides[i], stageKey));
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
      system: P.repair,
      user: u,
      schema: repairSchemaFor(stageKey),
      name: "slide",
    }).catch((e) => {
      log({ ev: "repair-error", slide: i + 1, err: String(e).slice(0, 200) });
      return undefined;
    });
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
    });
    if (!verdict.ok) {
      log({ ev: "repair-rejected", slide: i + 1, fix: o2.fix, why: verdict.why });
      return false;
    }
    const n0 = notes.get(i);
    const oldAsks = asks.get(i) ?? [];
    swapSlide(i, o2.slide);
    applyRepair(plan.slides, notes, i, r?.out);
    const now = (check()[i]?.faults ?? []).filter((f) => n0 || !f.startsWith("unanswered"));
    const was = kinds(c.faults);
    const fresh = [...kinds(now)].filter((k) => !was.has(k));
    const worse = ro.keepPartial
      ? fresh.length > 0 || overflowPt(now) >= overflowPt(c.faults)
      : [...kinds(now)].some((k) => was.has(k)) || now.length > c.faults.length;
    if (worse) {
      plan.slides[i] = before;
      if (n0) notes.set(i, n0);
      else notes.delete(i);
      asks.set(i, oldAsks);
      relay(i);
    }
    log({ ev: "repair", slide: i + 1, ok: true, fix: o2.fix, reverted: worse });
    return !worse;
  };
  /** Measure and retry: an overflowing slide gets at most two rewords. */
  const fitLoop = async (c: CheckResult): Promise<boolean> => {
    if (!c.faults.some((f) => OVERFLOW.test(f))) return repairOne(c);
    const first = await repairOne(c, { keepPartial: true });
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
