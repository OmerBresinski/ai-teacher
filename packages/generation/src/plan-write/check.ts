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
      message: `The plan has ${input.slides.length - 1} rows after the title; it must have exactly ${slideCount - 1}.`,
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
          message: `Slide 1 must be the title (form "title"), which carries the objectives; it is "${s.form}".`,
        });
      }
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

  return { plan: { ...input, slides }, problems, switched };
}

/** Problems the write step cannot run with (the rest are logged and written as planned). */
export function blocking(problems: readonly PlanProblem[]): PlanProblem[] {
  return problems.filter(
    (p) => p.rule === "count" || p.rule === "title" || p.rule === "form" || p.rule === "layout",
  );
}

/** Whether a form is one the writer fills (not the title, which code prints). */
export const writtenForm = (form: string) => form !== "title";
export { isSetForm };
