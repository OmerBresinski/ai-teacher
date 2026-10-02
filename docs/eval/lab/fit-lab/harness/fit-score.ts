// fit-lab scorer (lab tool, docs/eval/lab). Free: no model calls. For each deck, runs the editor's own first-open
// fit (`fitLessonToTheme` = lint every slide with the measurer, Tidy the flagged ones, the same path
// use-fit-migration takes on a fitVersion-0 lesson) on the lesson's own theme, and the editor's
// re-theme (`rethemeLesson`: setTheme, recolour, then the same fit) for every other theme, with the
// headless measurer (`measureHeadless`, the font-advance twin of the browser ruler).
//
// Usage: bun fit-score.ts [--worktree <path>] [--out <score.json>] <deck.lesson.json> ...
// --worktree picks whose editor/slides code measures (default: the current directory, a master checkout). Keep
// it at fit-base to compare approaches on one ruler; point it at an approach's worktree only when
// that approach changes the editor or the fit engine itself.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const argv = process.argv.slice(2);
const opt = (name: string) => {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
};
const wt = resolve(opt("--worktree") ?? ".");
const outPath = opt("--out");
if (argv.length === 0) {
  console.error(
    "usage: bun fit-score.ts [--worktree <path>] [--out <score.json>] <deck.lesson.json> ...",
  );
  process.exit(2);
}
const { fitLessonToTheme, rethemeLesson, slidesNeedingFit } = await import(
  `${wt}/packages/editor/src/layout/retheme.ts`
);
const { THEMES, getTheme, measureHeadless, CALLOUT_NAMES } = await import(
  `${wt}/packages/slides/src/index.ts`
);
const { isContinuation } = await import(`${wt}/packages/domain/src/documents/index.ts`);
// The shared fit block (designer plan PR 0): the same function the worker's summary line calls.
// Present only in worktrees that carry it; the scorer's own columns stand without it.
const slidesMod = await import(`${wt}/packages/slides/src/index.ts`);
const fitReport = slidesMod.fitReport as
  | undefined
  | ((
      l: unknown,
      o?: { pagesOnOpen?: (l: unknown) => number },
    ) => {
      slides: { requested: number | null; delivered: number; stored: number };
      overflowing: Record<string, number>;
      clashing?: Record<string, number>;
      callouts: { planned: number; placed: number };
      pagesOnOpen: number;
    });

type El = { id: string; name?: string; generatedFrom?: { factRefs?: string[] } };
type Slide = { id: string; kind: string; elements: El[] };
type Lesson = {
  themeId?: string;
  brief?: { slideCount?: number };
  slides: Slide[];
  facts?: {
    objectives: { id: string; text: string }[];
    questions?: { id: string; objectiveRefs?: string[] }[];
    workedExamples?: { id: string; objectiveRefs?: string[] }[];
    outline?: { id: string; kind: string; factRefs: string[]; callout?: unknown }[];
  };
};

const refsOf = (s: Slide) => [
  ...new Set(s.elements.flatMap((e) => e.generatedFrom?.factRefs ?? [])),
];
const hasCallout = (s: Slide) =>
  s.elements.some((e) => e.name === CALLOUT_NAMES.card || e.name === CALLOUT_NAMES.text);

function score(path: string) {
  const lesson = JSON.parse(readFileSync(path, "utf8")) as Lesson;
  const own = getTheme(lesson.themeId).id as string;
  const outline = lesson.facts?.outline ?? [];
  const slides = lesson.slides;
  const pages = (l: Lesson) =>
    l.slides.filter((s, i) => i > 0 && isContinuation(s, l.slides[i - 1])).length;

  // Fit on every theme, as the editor would on first open (own theme) or on a theme change.
  const themes = (THEMES as { id: string }[]).map((t) => {
    const theme = getTheme(t.id);
    const measure = measureHeadless(theme);
    const flagged: string[] =
      t.id === own
        ? slidesNeedingFit(lesson, theme, measure)
        : slidesNeedingFit({ ...lesson, themeId: t.id }, theme, measure);
    const made =
      t.id === own ? fitLessonToTheme(lesson, measure) : rethemeLesson(lesson, t.id, measure);
    const after = made.lesson as Lesson;
    const overflowIds = new Set<string>(made.outcome.overflow);
    const overflowSlides = after.slides
      .map((s, i) => (s.elements.some((e) => overflowIds.has(e.id)) ? i + 1 : 0))
      .filter(Boolean);
    const idx = (id: string) => slides.findIndex((s) => s.id === id) + 1;
    return {
      theme: t.id,
      own: t.id === own,
      flagged: flagged.map(idx),
      pagesAfterTidy: after.slides.length,
      continuations: pages(after) - pages(lesson),
      overflowAfterTidy: overflowSlides.length,
    };
  });
  const ownT = themes.find((t) => t.own) ?? themes[0];

  // Callouts: planned on a teaching slide (the worked example's is left off by design) vs placed.
  const plannedCallouts = outline.filter(
    (e) => (e.kind === "content" || e.kind === "image-text") && e.callout,
  );
  const aligned = outline.length === slides.length;
  const droppedAt = aligned
    ? outline.flatMap((e, i) =>
        (e.kind === "content" || e.kind === "image-text") &&
        e.callout &&
        !hasCallout(slides[i] as Slide)
          ? [i + 1]
          : [],
      )
    : [];
  const placed = slides.filter(
    (s) => (s.kind === "content" || s.kind === "image-text") && hasCallout(s),
  ).length;
  const calloutsDropped = aligned ? droppedAt.length : Math.max(0, plannedCallouts.length - placed);

  // Exit ticket: every objective has at least one question on it.
  const f = lesson.facts;
  const qObj = new Map((f?.questions ?? []).map((q) => [q.id, q.objectiveRefs ?? []]));
  const exitSlide = slides.find((s) => s.kind === "exit-ticket");
  const exitEntry = outline.find((e) => e.kind === "exit-ticket");
  const exitRefs = exitSlide ? refsOf(exitSlide) : [];
  const exitQs = (
    exitRefs.some((r) => qObj.has(r)) ? exitRefs : (exitEntry?.factRefs ?? [])
  ).filter((r) => qObj.has(r));
  const onExit = new Set(exitQs.flatMap((q) => qObj.get(q) ?? []));
  const objectives = (f?.objectives ?? []).map((o) => o.id);
  const missingOnExit = objectives.filter((o) => !onExit.has(o));

  // Worked examples: each sits after a teaching slide on its own objective and before any teaching
  // slide on a later objective (objective order = facts.objectives order).
  const order = new Map(objectives.map((o, i) => [o, i]));
  const weObj = new Map((f?.workedExamples ?? []).map((w) => [w.id, w.objectiveRefs?.[0]]));
  const objOf = (s: Slide) => {
    const refs = refsOf(s);
    const x = refs.find((r) => weObj.has(r));
    return (x && weObj.get(x)) ?? refs.find((r) => order.has(r));
  };
  const teach = slides
    .map((s, i) => ({
      i: i + 1,
      kind: s.kind,
      o: objOf(s),
      cont: i > 0 && isContinuation(s, slides[i - 1] as Slide),
    }))
    .filter(
      (t) =>
        !t.cont && (t.kind === "content" || t.kind === "image-text" || t.kind === "worked-example"),
    );
  const workedExamples = teach
    .filter((t) => t.kind === "worked-example")
    .map((w) => {
      const k = order.get(w.o ?? "") ?? -1;
      const before = teach.filter((t) => t.i < w.i && t.kind !== "worked-example");
      const taughtOwn = before.some((t) => t.o === w.o);
      const laterFirst = before.some((t) => (order.get(t.o ?? "") ?? -1) > k);
      return {
        slide: w.i,
        objective: w.o ?? null,
        afterOwnTeaching: taughtOwn,
        beforeLaterObjective: !laterFirst,
        ok: taughtOwn && !laterFirst,
      };
    });

  // The lesson designer (spike/lesson-designer): the driver's `<brief>.designer.json` beside the deck.
  const designerPath = path.replace(/\.lesson\.json$/, ".designer.json");
  const designer = existsSync(designerPath)
    ? (JSON.parse(readFileSync(designerPath, "utf8")) as {
        slots: { slide: number; objective: number; planned: string; form: string; rung: string }[];
        rungs: Record<string, number>;
        allocation: number[];
        exitCovered: number;
        minimums: { visualMissing: number[]; checks: number; sameNeighbours: unknown[] };
        marks?: { title: number | null; firstSlot: number | null; editable: number | null };
      })
    : undefined;
  const VISUAL = new Set(["photo", "figure", "diagram-slot"]);
  const designerCols = designer && {
    slotsPerForm: designer.slots.reduce<Record<string, number>>(
      (m, x) => ({ ...m, [x.form]: (m[x.form] ?? 0) + 1 }),
      {},
    ),
    plannedPerForm: designer.slots.reduce<Record<string, number>>(
      (m, x) => ({ ...m, [x.planned]: (m[x.planned] ?? 0) + 1 }),
      {},
    ),
    visualsPerObjective: designer.allocation.map(
      (_, o) => designer.slots.filter((x) => x.objective === o && VISUAL.has(x.form)).length,
    ),
    rungs: designer.rungs,
    exitCovered: `${designer.exitCovered}/${designer.allocation.length}`,
    minimums: designer.minimums,
    titleS: designer.marks?.title ?? null,
    firstSlotS: designer.marks?.firstSlot ?? null,
    editableS: designer.marks?.editable ?? null,
  };
  const fitLog = fitReport?.(lesson);
  const fitLogTidy = fitReport?.(lesson, { pagesOnOpen: () => ownT?.continuations ?? 0 });
  const nonCont = slides.filter(
    (s, i) => i === 0 || !isContinuation(s, slides[i - 1] as Slide),
  ).length;
  const worst = themes.reduce((a, b) => (b.continuations > a.continuations ? b : a), ownT);
  const result = {
    deck: path,
    brief: basename(path).replace(/\.lesson\.json$/, ""),
    slidesRequested: lesson.brief?.slideCount ?? null,
    outlineEntries: outline.length,
    slidesDelivered: nonCont,
    storedSlides: slides.length,
    ownTheme: own,
    ownFlagged: ownT?.flagged.length ?? 0,
    ownContinuations: ownT?.continuations ?? 0,
    ownOverflowAfterTidy: ownT?.overflowAfterTidy ?? 0,
    anyThemeContinuationsMax: worst?.continuations ?? 0,
    anyThemeContinuationsMaxTheme: worst?.theme,
    themesWithSplits: themes.filter((t) => t.continuations > 0).length,
    themesTotal: themes.length,
    flaggedSlidesAnyTheme: [...new Set(themes.flatMap((t) => t.flagged))].sort((a, b) => a - b),
    plannedCallouts: plannedCallouts.length,
    calloutsDropped,
    calloutsDroppedAt: droppedAt,
    objectivesOnExit: `${objectives.length - missingOnExit.length}/${objectives.length}`,
    missingOnExit,
    workedExamples,
    workedExamplesMisplaced: workedExamples.filter((w) => !w.ok).length,
    themes,
    ...(fitLog ? { fitLog, fitLogPagesOnOpenWithTidy: fitLogTidy?.pagesOnOpen } : {}),
    ...(designer ? { designer: designerCols } : {}),
  };
  const line = `${result.brief}: req ${result.slidesRequested} delivered ${nonCont} | own ${own}: flagged ${result.ownFlagged}, +${result.ownContinuations} pages, overflow ${result.ownOverflowAfterTidy} | worst theme +${result.anyThemeContinuationsMax} (${worst?.theme}), ${result.themesWithSplits}/${themes.length} themes split | callouts dropped ${calloutsDropped}/${plannedCallouts.length} | exit ${result.objectivesOnExit} | WE misplaced ${result.workedExamplesMisplaced}/${workedExamples.length}`;
  const fl = fitLog
    ? ` || fit log: req ${fitLog.slides.requested} delivered ${fitLog.slides.delivered} | overflow own ${fitLog.overflowing[own]} (${Object.values(fitLog.overflowing).join(",")}) clash own ${fitLog.clashing?.[own]} | callouts ${fitLog.callouts.placed}/${fitLog.callouts.planned} | pagesOnOpen ${fitLog.pagesOnOpen}`
    : "";
  const dl = designerCols
    ? ` || designer: forms ${JSON.stringify(designerCols.slotsPerForm)} | visuals/objective ${designerCols.visualsPerObjective.join(",")} | rungs ${JSON.stringify(designerCols.rungs)} | exit ${designerCols.exitCovered} | title ${designerCols.titleS}s first slot ${designerCols.firstSlotS}s editable ${designerCols.editableS}s`
    : "";
  return { result, line: line + fl + dl };
}

const all = argv.map((p) => score(resolve(p)));
for (const s of all) console.log(s.line);
if (outPath)
  writeFileSync(
    outPath,
    JSON.stringify(
      all.map((s) => ({ ...s.result, summary: s.line })),
      null,
      1,
    ),
  );
else console.log(JSON.stringify(all.map((s) => s.result)));
