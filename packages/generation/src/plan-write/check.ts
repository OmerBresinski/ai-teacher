import type { PlanLessonOutput, PlanMenuEntry, PlanSlide } from "../prompts/plan-lesson";
import { isSetForm } from "./menu";

/*
 * Plan-write's code check (spike/plan-write, step 2): the slide table the planner wrote, held to
 * the rules code can judge. A layout too small for the idea's parts is switched in code to a
 * sibling layout that holds them; every other broken rule is a problem for the one repair call.
 */

export type PlanRule =
  | "count"
  | "title"
  | "form"
  | "layout"
  | "capacity"
  | "objective"
  | "untaught";

export type PlanProblem = { rule: PlanRule; slide?: number; message: string };

export type LayoutSwitch = { slide: number; form: string; from: string; to: string };

export type PlanCheck = {
  /** The plan with any sibling layouts switched in. */
  plan: PlanLessonOutput;
  problems: PlanProblem[];
  switched: LayoutSwitch[];
};

/** Forms whose slide checks pupils: each needs a target taught on an earlier slide. */
export const CHECKING_FORMS: ReadonlySet<string> = new Set([
  "hinge",
  "true-false",
  "matching",
  "fill-gap",
  "sort",
  "open-response",
  "check-set",
  "exit-ticket",
]);

/** Code draws slides 1 and 2: the title (with its picture) and the objectives (UX ruling 134). */
export const FIXED_SLIDES = 2;

const key = (k: string) => k.trim().toLowerCase();

export function checkPlan(
  input: PlanLessonOutput,
  opts: { slideCount: number; menu: readonly PlanMenuEntry[] },
): PlanCheck {
  const problems: PlanProblem[] = [];
  const switched: LayoutSwitch[] = [];
  const { slideCount, menu } = opts;
  const n = input.objectives.length;
  if (input.slides.length !== slideCount) {
    problems.push({
      rule: "count",
      message: `The plan has ${input.slides.length - FIXED_SLIDES} rows after the objectives slide; it must have exactly ${slideCount - FIXED_SLIDES}.`,
    });
  }
  const layoutsOf = (form: string) => menu.filter((m) => m.form === form);
  const slides: PlanSlide[] = input.slides.map((s, i) => {
    const number = i + 1;
    if (number === 1) {
      if (s.form !== "title") {
        problems.push({
          rule: "title",
          slide: 1,
          message: `Slide 1 must be the title (form "title"); it is "${s.form}".`,
        });
      }
      return s;
    }
    if (number === 2) {
      if (s.form !== "objectives") {
        problems.push({
          rule: "title",
          slide: 2,
          message: `Slide 2 must be the objectives (form "objectives"); it is "${s.form}".`,
        });
      }
      return s;
    }
    if (s.form === "objectives") {
      problems.push({
        rule: "title",
        slide: number,
        message: `Slide ${number} is a second objectives slide; only slide 2 lists the objectives.`,
      });
      return s;
    }
    if (s.form === "title") {
      problems.push({
        rule: "title",
        slide: number,
        message: `Slide ${number} is a second title; only slide 1 is the title.`,
      });
      return s;
    }
    for (const o of s.objectives) {
      if (o < 1 || o > n) {
        problems.push({
          rule: "objective",
          slide: number,
          message: `Slide ${number} serves objective ${o}, but the lesson has ${n}.`,
        });
      }
    }
    const offered = layoutsOf(s.form);
    if (offered.length === 0) {
      problems.push({
        rule: "form",
        slide: number,
        message: `Slide ${number}'s form "${s.form}" is not on the menu.`,
      });
      return s;
    }
    const holds = (m: PlanMenuEntry) => m.capacity === undefined || s.parts <= m.capacity;
    const own = offered.find((m) => m.layout === s.layout);
    if (own && holds(own)) return s;
    // The named layout is missing or too small: a sibling that holds the parts, else a problem.
    const sibling = offered.find(holds);
    if (sibling) {
      switched.push({ slide: number, form: s.form, from: s.layout, to: sibling.layout });
      return { ...s, layout: sibling.layout };
    }
    const most = Math.max(...offered.map((m) => m.capacity ?? 0));
    problems.push(
      own
        ? {
            rule: "capacity",
            slide: number,
            message: `Slide ${number}'s idea has ${s.parts} parts; ${s.form} holds at most ${most} in any layout.`,
          }
        : {
            rule: "layout",
            slide: number,
            message: `Slide ${number}'s layout "${s.layout}" is not a layout of ${s.form}.`,
          },
    );
    return s;
  });

  // Every checked idea was taught on an earlier slide. A starter set retrieves prior knowledge.
  const taught = new Set<string>();
  slides.forEach((s, i) => {
    const number = i + 1;
    const checks = CHECKING_FORMS.has(s.form) || s.tests.length > 0;
    if (checks && s.form !== "starter-set") {
      if (s.tests.length === 0 && CHECKING_FORMS.has(s.form)) {
        problems.push({
          rule: "untaught",
          slide: number,
          message: `Slide ${number} is a ${s.form} but names no idea it tests.`,
        });
      }
      const missing = s.tests.filter((t) => !taught.has(key(t)));
      if (missing.length > 0) {
        problems.push({
          rule: "untaught",
          slide: number,
          message: `Slide ${number} tests ${missing.map((m) => `"${m}"`).join(", ")}, which no earlier slide teaches.`,
        });
      }
    }
    for (const t of s.teaches) taught.add(key(t));
  });

  // Every objective is taught on a slide (UX ruling 135): thin coverage is fine, a dropped one is not.
  for (let o = 1; o <= n; o++) {
    const teaching = slides.some(
      (s, i) => i >= FIXED_SLIDES && s.objectives.includes(o) && s.teaches.length > 0,
    );
    if (!teaching) {
      problems.push({
        rule: "objective",
        message: `Objective ${o} is taught on no slide; give it a slide that teaches it before any slide tests it.`,
      });
    }
  }

  return { plan: { ...input, slides }, problems, switched };
}

/** Problems the write step cannot run with (the rest are logged and written as planned). */
export function blocking(problems: readonly PlanProblem[]): PlanProblem[] {
  return problems.filter(
    (p) => p.rule === "count" || p.rule === "title" || p.rule === "form" || p.rule === "layout",
  );
}

/** Whether a form is one the writer fills (not the title or the objectives, which code prints). */
export const writtenForm = (form: string) => form !== "title" && form !== "objectives";
export { isSetForm };

/** The roles that check what was just taught: a code-placed check counts only these. */
const CHECKING_ROLES = new Set(["check", "hinge", "practise"]);

/** One check code adds to a plan: its row, placed straight after the slide numbered `after`. */
export type InsertedCheck = { after: number; row: PlanSlide };

/**
 * The checks code guarantees (UX rulings 135 and 136): after each objective's teaching, before
 * the next teach slide, one row that checks it (a check, the hinge or the practise slide, whichever
 * the plan put there). Where the plan has none, a short check-set on that objective's taught ideas
 * goes straight after its last teach slide. Teach slides are never taken for it: the lesson grows
 * by the checks added. Objectives taught by the same last slide share one check.
 */
export function checksToInsert(slides: readonly PlanSlide[]): InsertedCheck[] {
  const teachOf = new Map<number, number[]>();
  slides.forEach((s, i) => {
    if (i < FIXED_SLIDES || s.role !== "teach") return;
    for (const o of s.objectives) teachOf.set(o, [...(teachOf.get(o) ?? []), i]);
  });
  const byLast = new Map<number, number[]>();
  for (const [o, rows] of [...teachOf.entries()].sort((a, b) => a[0] - b[0])) {
    const last = Math.max(...rows);
    const taught = new Set(rows.flatMap((i) => slides[i]?.teaches ?? []));
    // lab/cand-fix: a worked example is checked as it is taught (its notes ask the class for each
    // line), so a quick check straight after it would only repeat its numbers (audit problem 1).
    let checked = ["worked-example", "hinge"].includes(slides[last]?.form ?? "");
    for (let j = last + 1; !checked && j < slides.length; j++) {
      const s = slides[j] as PlanSlide;
      if (s.role === "teach") break;
      if (
        CHECKING_ROLES.has(s.role) &&
        (s.objectives.includes(o) || s.tests.some((t) => taught.has(t)))
      ) {
        checked = true;
        break;
      }
    }
    if (!checked) byLast.set(last, [...(byLast.get(last) ?? []), o]);
  }
  return [...byLast.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([last, objs]) => {
      const tests = [
        ...new Set(
          slides.flatMap((s, i) =>
            i >= FIXED_SLIDES &&
            i <= last &&
            s.role === "teach" &&
            s.objectives.some((o) => objs.includes(o))
              ? s.teaches
              : [],
          ),
        ),
      ];
      return {
        after: last + 1,
        row: {
          role: "check",
          objectives: objs,
          tests,
          teaches: [],
          purpose: `quick check on objective ${objs.join(" and ")}: the ideas just taught, applied to a new case or new numbers`,
          parts: 3,
          form: "check-set",
          layout: "default",
          imageBrief: null,
          figureBrief: null,
        },
      };
    });
}

/**
 * The retrieval warm-up code guarantees (round H): the first slide after the objectives is a short
 * retrieval starter on what pupils learned before that this lesson builds on. A plan that opens
 * with a retrieve row or a starter set keeps it; otherwise this row goes in first. Teach slides are
 * never taken for it.
 */
export function warmUpToInsert(slides: readonly PlanSlide[]): PlanSlide | undefined {
  const first = slides[FIXED_SLIDES];
  if (first && (first.role === "retrieve" || first.form === "starter-set")) return undefined;
  return {
    role: "retrieve",
    objectives: [],
    tests: [],
    teaches: [],
    purpose:
      "retrieval warm-up: three short questions on what pupils learned before that this lesson builds on, never what it teaches",
    parts: 3,
    form: "starter-set",
    layout: "default",
    imageBrief: null,
    figureBrief: null,
  };
}
