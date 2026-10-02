import type { FactId, Lesson, LessonFacts, OutlineEntry, Slide } from "@tj/domain/documents";
import { richDocToPlainText, slideText } from "@tj/domain/documents";

/*
 * The finished lesson as learning cycles (TEACH-86, rulings 142 and 144): what "Follows the
 * lesson" writes one task for. A cycle is a run of teaching slides up to and including the check
 * and practice slides that follow it, read from the saved slides in order. A slide's part comes
 * from its kind tag ("CHECK", "PRACTICE", …), then its outline entry's phase (objectives-first
 * and plan-write both save one per slide), then whether it carries a question. Title, objectives,
 * the retrieval starter and an exit-ticket pointer belong to no cycle. With no slides yet (the
 * slides job can still be running beside the worksheet job, ADR 0030) the outline stands in; with
 * no outline either, one cycle per objective. Pure: no model call.
 */

export type CyclePart = "teach" | "check" | "practise";

export type CycleSlide = {
  /** The slide's id, or the outline entry's when the slides are not written yet. */
  id: string;
  part: CyclePart;
  /** `slideText` of the slide (or the outline entry's brief). */
  text: string;
};

export type LessonCycle = {
  /** 1-based, in lesson order. */
  index: number;
  /** The first teaching slide's heading, for the task title. */
  title: string;
  objectiveIds: FactId[];
  slides: CycleSlide[];
};

/** Slides that are no part of a cycle: framing, the retrieval starter, the exit-ticket pointer. */
const OUTSIDE_KINDS: ReadonlySet<string> = new Set(["title", "objectives", "exit-ticket"]);
/** Kinds whose slide is a question for the class. */
const CHECK_KINDS: ReadonlySet<string> = new Set([
  "true-false",
  "multiple-choice",
  "matching",
  "fill-gap",
  "sort",
  "open-response",
]);

type SlidePart = CyclePart | "outside";

/** The slide's kind tag ("CHECK", "PRACTICE", "STARTER"), when its layout drew one. */
function kindTag(slide: Slide): string | undefined {
  const tag = slide.elements.find((e) => e.name === "Kind tag");
  return tag && "doc" in tag && tag.doc ? richDocToPlainText(tag.doc).trim() : undefined;
}

function partOfTag(tag: string | undefined): SlidePart | undefined {
  if (!tag) return undefined;
  if (/starter|recall|retriev|warm/i.test(tag)) return "outside";
  if (/exit/i.test(tag)) return "outside";
  if (/practi|your turn|try|task/i.test(tag)) return "practise";
  if (/check|hinge|quiz|question/i.test(tag)) return "check";
  return undefined;
}

function partOfPhase(entry: OutlineEntry | undefined): SlidePart | undefined {
  switch (entry?.phase) {
    case "starter":
      return "outside";
    case "check":
      return "check";
    case "practise":
      return "practise";
    case "explain":
      return "teach";
    default:
      return undefined;
  }
}

function slidePart(slide: Slide, entry: OutlineEntry | undefined): SlidePart {
  if (OUTSIDE_KINDS.has(slide.kind)) return "outside";
  const tagged = partOfTag(kindTag(slide));
  if (tagged) return tagged;
  const phased = partOfPhase(entry);
  if (phased) return phased;
  if (slide.kind === "starter") return "outside";
  if (slide.question !== undefined || CHECK_KINDS.has(slide.kind)) return "check";
  return "teach";
}

function headingOf(slide: Slide, text: string): string {
  const heading = slide.elements.find((e) => e.name === "Heading");
  const own = heading && "doc" in heading && heading.doc ? richDocToPlainText(heading.doc) : "";
  return (own.trim() || text.split("\n")[0] || "").trim();
}

type Unit = { id: string; part: SlidePart; text: string; title: string; refs: FactId[] };

/** Group units into cycles: teaching then its run of checks/practice; a new teach after a check opens the next. */
function group(units: Unit[], objectiveIds: ReadonlySet<FactId>): LessonCycle[] {
  const cycles: LessonCycle[] = [];
  let current: { units: Unit[]; checked: boolean } | undefined;
  const close = () => {
    if (!current || current.units.length === 0) return;
    const teach = current.units.find((u) => u.part === "teach") ?? current.units[0];
    const refs = new Set<FactId>();
    for (const u of current.units) for (const r of u.refs) if (objectiveIds.has(r)) refs.add(r);
    cycles.push({
      index: cycles.length + 1,
      title: teach?.title ?? "",
      objectiveIds: [...refs],
      slides: current.units.map(({ id, part, text }) => ({
        id,
        part: part as CyclePart,
        text,
      })),
    });
  };
  for (const unit of units) {
    if (unit.part === "outside") continue;
    if (unit.part === "teach" && current?.checked) {
      close();
      current = undefined;
    }
    current ??= { units: [], checked: false };
    current.units.push(unit);
    if (unit.part !== "teach") current.checked = true;
  }
  close();
  return cycles;
}

/** One cycle per objective, from the facts alone: the last resort. */
function byObjective(facts: LessonFacts): LessonCycle[] {
  return facts.objectives.map((objective, i) => {
    const ideas = (facts.keyIdeas ?? []).filter((k) => k.objectiveRefs.includes(objective.id));
    return {
      index: i + 1,
      title: objective.text,
      objectiveIds: [objective.id],
      slides: ideas.map((k) => ({
        id: k.id,
        part: "teach" as const,
        text: [k.statement, k.explanation].filter(Boolean).join("\n"),
      })),
    };
  });
}

/**
 * The lesson's learning cycles in order. Cycles that name no objective are given the objective
 * at their position when the counts line up, so every task can cite one.
 */
export function lessonCycles(lesson: Lesson): LessonCycle[] {
  const facts = lesson.facts;
  const objectives = new Set<FactId>(facts?.objectives.map((o) => o.id) ?? []);
  const outline = facts?.outline ?? [];
  let units: Unit[];
  if (lesson.slides.length > 0) {
    const aligned = outline.length === lesson.slides.length;
    units = lesson.slides.map((slide, i) => {
      const entry = aligned ? outline[i] : undefined;
      const text = slideText(slide);
      const own = slide.elements.flatMap((e) => e.generatedFrom?.factRefs ?? []);
      return {
        id: slide.id,
        part: slidePart(slide, entry),
        text,
        title: headingOf(slide, text),
        refs: [...(entry?.factRefs ?? []), ...own],
      };
    });
  } else {
    units = outline.map((entry) => ({
      id: entry.id,
      part:
        entry.kind === "title" || entry.kind === "objectives" || entry.kind === "exit-ticket"
          ? "outside"
          : (partOfPhase(entry) ??
            (CHECK_KINDS.has(entry.kind)
              ? "check"
              : entry.kind === "starter"
                ? "outside"
                : "teach")),
      text: entry.brief?.adds ?? "",
      title: entry.brief?.adds ?? "",
      refs: entry.factRefs,
    }));
  }
  let cycles = group(units, objectives);
  if (cycles.length === 0 && facts) cycles = byObjective(facts);
  const ordered = facts?.objectives.map((o) => o.id) ?? [];
  if (ordered.length === cycles.length) {
    cycles = cycles.map((c, i) =>
      c.objectiveIds.length > 0 ? c : { ...c, objectiveIds: [ordered[i] as FactId] },
    );
  }
  return cycles;
}

/** Whether the slides point the class to an exit ticket on the worksheet (ruling 141). */
export function lessonPointsToExitTicket(lesson: Lesson): boolean {
  if (lesson.slides.some((s) => s.kind === "exit-ticket")) return true;
  return (lesson.facts?.outline ?? []).some((e) => e.kind === "exit-ticket");
}

/** Normalised for a verbatim comparison: case, spacing and trailing punctuation ignored. */
export const normaliseStem = (text: string): string =>
  text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[\s.?!:]+$/, "")
    .trim();

/**
 * The questions the class already met on the slides — the facts' question stems and every line
 * ending in "?" on a check or practice slide — normalised, so the exit ticket can avoid them.
 */
export function slideQuestionStems(lesson: Lesson, cycles: readonly LessonCycle[]): string[] {
  const stems = new Set<string>();
  for (const q of lesson.facts?.questions ?? []) stems.add(normaliseStem(q.stem));
  for (const cycle of cycles) {
    for (const slide of cycle.slides) {
      if (slide.part === "teach") continue;
      for (const line of slide.text.split("\n")) {
        if (line.trim().endsWith("?")) stems.add(normaliseStem(line));
      }
    }
  }
  return [...stems];
}
