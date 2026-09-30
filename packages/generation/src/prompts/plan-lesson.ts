import { z } from "zod";
import { type Audience, audienceBlock } from "./shared";

/*
 * plan-lesson.v1 (spike/plan-write): one call designs the whole lesson as a slide table. Drafted
 * in scratchpad/quality-prd/lab/plan-write/prompts-draft/plan-lesson.md (reasons in
 * PROMPT-NOTES.md), fitted to the schema keys the code check reads: slide 1 is a table row (the
 * title), `parts` is the count, and `teaches` / `tests` carry the taught-earlier rule. Field order
 * in the schemas is part of the prompt (the key before the question, the content before the form).
 */

export const PLAN_LESSON_VERSION = "plan-lesson.v1";

/** One form and layout on the planner's menu, with its measured capacity and contract text. */
export type PlanMenuEntry = {
  form: string;
  layout: string;
  /** When to pick this layout over the form's others (from the contract). */
  when?: string;
  /** The most parts (points, steps, options, pairs, sentences…) the layout holds. */
  capacity?: number;
  /** `contractText(form, layout)`: the slots, one per line, in structural units. */
  contract: string;
};

export type PlanLessonInput = {
  topic: string;
  audience: Audience;
  /** The brief's clarifying answers, as the teacher gave them. */
  answers?: Record<string, string>;
  priorKnowledge?: string;
  /** Exactly this many slides, the title included. */
  slideCount: number;
  menu: PlanMenuEntry[];
  /** A repair: the plan as written, and the rules it broke, one per line. */
  repair?: { previous: PlanLessonOutput; problems: string[] };
};

const nullableText = z.string().nullable();

export const PlanSlideSchema = z.object({
  role: z
    .string()
    .describe("title (slide 1 only), retrieve, hook, teach, check, hinge, practise or exit"),
  /** 1-based objective numbers this slide serves. */
  objectives: z.array(z.number().int().min(1)).describe("the numbers of the objectives it serves"),
  /** Keys of the ideas this slide checks; each must be taught on an earlier slide. */
  tests: z
    .array(z.string())
    .describe("the keys, copied exactly from earlier slides' teaches, of what this slide asks"),
  /** Short keys for the ideas this slide teaches. */
  teaches: z.array(z.string()).describe("a short key for each idea this slide teaches"),
  purpose: z.string().describe("what the slide does, as a short phrase"),
  /** How many parts the slide's idea has (points, steps, options, pairs, sentences). */
  parts: z.number().int().min(0).describe("how many items the layout's counted slot will hold"),
  /** A menu form, or "title" on slide 1. */
  form: z.string().describe('a form from the palette; "title" on slide 1 only'),
  /** A layout of that form on the menu ("default" when it has one). */
  layout: z.string().describe('a layout of that form from the palette; "default" when it has one'),
  imageBrief: z
    .object({ subject: z.string(), mustShow: z.array(z.string()) })
    .nullable()
    .describe("on a photo only, else null"),
  figureBrief: nullableText.describe("on a figure or diagram slot only, else null"),
});
export type PlanSlide = z.infer<typeof PlanSlideSchema>;

export const planLessonSchema = z.object({
  misconception: z
    .string()
    .describe("the one wrong idea that matters most for these pupils, then the correct idea"),
  objectives: z.array(z.string()).min(1).max(4),
  runningExample: z.string(),
  slides: z.array(PlanSlideSchema),
});
export type PlanLessonOutput = z.infer<typeof planLessonSchema>;

const SYSTEM = `You are an experienced UK teacher planning a whole lesson as slides. You make every teaching decision here. Writers then write each slide from your plan, and they see the whole plan, so each row says what its slide does and the writer fills in the detail.

Write in British English spelling and conventions.
Never invent or include the name of any pupil, student or member of staff.

Decide the fields in this order:
- misconception: the one wrong idea about this topic that matters most for these pupils, then the correct idea.
- objectives: what pupils will be able to do by the end, each on one line, starting with a verb. Usually three; one or two only when the topic is a single method or skill. They go on the title slide.
- runningExample: one case, context or question the whole lesson returns to, so the slides tell one story.
- slides: one row for each slide the Slides line gives. Slide 1 is the title: role "title", form "title", layout "default", every objective, parts 0.

The shape is yours to choose as good teaching for this topic and this age: whether the lesson opens by recalling earlier learning, with a hook, or straight into teaching; where a hinge checks the idea everything after it depends on, before pupils work alone; where pupils practise and apply; and whether it closes with a check.
Order the ideas so each builds on the one before. An objective usually takes one or two teaching slides, with a check soon after; one check may cover two objectives.
Pupils answer, sort, match or write on about half the slides.
When the topic holds more than the slides do, leave the rest for a later lesson.

Each row:
- role: retrieve (recalls earlier learning), hook (a question, case or picture that opens the puzzle), teach, check (a quick question on what was just taught), hinge (the check the rest of the lesson depends on), practise (pupils use the idea on a new case, in their own words) or exit (a closing check).
- objectives: the numbers of the objectives it serves; none for retrieve or hook.
- tests: on a check, hinge, practise or exit, the keys of what it asks, each copied exactly from the teaches of an earlier slide; none on other roles. Every idea a question tests is taught on an earlier slide itself, not only in that slide's notes.
- teaches: a short key for each idea the slide teaches.
- purpose: what the slide does, as a short phrase.
- parts: how many items its layout's counted slot will hold: its steps, points, sides, pairs, cards, terms, gaps, options, questions or sentences.
- form and layout: from the palette, chosen by the shape of the content and its count. A diagram slot, whose labels take any number of parts, or a figure draws a process, a structure or a layout. Steps, stages or a chain of events are a sequence; two things set side by side are a compare; a method pupils will carry out is a worked example; a real thing, place or event pupils may never have seen, or one that surprises, is a photo. A lesson whose ideas cannot be seen has no picture.
- The parts fit the layout's count. When an idea has more parts than a form holds, choose a form that holds them or split the idea over two slides.
- A hinge's wrong options are mistakes pupils really make, and the misconception is one of them.
- imageBrief, on a photo only: a subject stock photography has, and what the photo must show; no names of people and no local places.
- figureBrief, on a figure or diagram slot only: for a figure, its template and what it shows; for a diagram slot, what to draw.

Size the lesson in slides: no minutes or timings anywhere.`;

/** One palette entry as the planner reads it: the contract, its "When" line and its part count. */
function menuLine(m: PlanMenuEntry): string {
  const lines = [m.contract];
  if (m.when) lines.push(`  When: ${m.when}`);
  if (m.capacity !== undefined) lines.push(`  Parts: at most ${m.capacity}`);
  return lines.join("\n");
}

export function planLessonPrompt(input: PlanLessonInput): { system: string; user: string } {
  const n = input.slideCount;
  const lines = [
    "Palette (each form and layout, its slots, when to use it and how many parts it holds):",
    input.menu.map(menuLine).join("\n"),
    "",
    `Topic: ${input.topic}`,
    audienceBlock(input.audience),
  ];
  if (input.priorKnowledge && !input.audience.classContext?.priorKnowledge) {
    lines.push(`Prior knowledge: ${input.priorKnowledge}`);
  }
  const answers = Object.values(input.answers ?? {}).filter((a) => a.trim().length > 0);
  if (answers.length > 0) lines.push(`The teacher's answers: ${answers.join("; ")}`);
  lines.push(`Slides: ${n}. Slide 1 is the title with the objectives; plan all ${n} rows.`);
  if (input.repair) {
    lines.push(
      "",
      "Your plan:",
      JSON.stringify(input.repair.previous),
      "",
      "It breaks these rules:",
      ...input.repair.problems.map((p) => `- ${p}`),
      "Return the whole plan again, changing only what these rules need.",
    );
  }
  return { system: SYSTEM, user: lines.join("\n") };
}
