import { z } from "zod";
import { type Audience, audienceBlock } from "./shared";

/*
 * plan-lesson.v1 (spike/plan-write): one call designs the whole lesson as a slide table. Drafted
 * in scratchpad/quality-prd/lab/plan-write/prompts-draft/plan-lesson.md (reasons in
 * PROMPT-NOTES.md), fitted to the schema keys the code check reads: slide 1 is a table row (the
 * title), `parts` is the count, and `teaches` / `tests` carry the taught-earlier rule. Field order
 * in the schemas is part of the prompt (the key before the question, the content before the form).
 */

/* v9: titlePicture carries `named` (proper name or null) for the Commons search (ruling 139). */
/* v10: teaching first (ROOT-CAUSE-CHALKIE cause 1): at least half the slides teach, one per objective at least; no exit slide (the exit ticket is on the worksheet); "about half the slides" answer and "leave the rest for a later lesson" deleted. */
/* v11 (merge of spike/teach-first and spike/photo-bench, both v10): v10's "at least half the slides teach" was met
 * exactly in every deck (a floor is read as the target), so teaching is now the default job and the
 * non-teaching slides are listed as the only ones the lesson needs; code gives the teach count for
 * this deck's size in the user turn (teachRange). Plus photo-bench's plain title-picture subject. */
/* v12 (round A6, teaching pictures): a teach slide is a photo or a diagram slot unless its idea cannot be
 * pictured (was "most teach slides carry a picture"); a diagram wherever the idea has a shape, and a process
 * or cycle may be a diagram slot rather than a sequence. */
export const PLAN_LESSON_VERSION = "plan-lesson.v12";

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

/**
 * One slide of the checked table, as the code check and the writers read it. The planner does not
 * write this shape: it writes one coded row per slide (`planLessonSchema.slides`), which
 * `parsePlan` turns into these, and code adds the title row.
 */
export const PlanSlideSchema = z.object({
  role: z.string(),
  /** 1-based objective numbers this slide serves. */
  objectives: z.array(z.number().int().min(1)),
  /** Keys of the ideas this slide checks; each must be taught on an earlier slide. */
  tests: z.array(z.string()),
  /** Short keys for the ideas this slide teaches. */
  teaches: z.array(z.string()),
  /** The row's aim, a short phrase; the writer fills in the detail. */
  purpose: z.string(),
  /** How many parts the slide's idea has (points, steps, options, pairs, sentences). */
  parts: z.number().int().min(0),
  /** A menu form, or "title" on slide 1. */
  form: z.string(),
  /** A layout of that form on the menu ("default" when it has one). */
  layout: z.string(),
  imageBrief: z
    .object({
      subject: z.string(),
      named: z.string().nullish(),
      mustShow: z.array(z.string()),
    })
    .nullable(),
  figureBrief: nullableText,
});
export type PlanSlide = z.infer<typeof PlanSlideSchema>;

/** The checked plan as the stages save and read it (slide 1 the title row). */
export const planTableSchema = z.object({
  misconception: z.string(),
  objectives: z.array(z.string()).min(1).max(4),
  runningExample: z.string(),
  slides: z.array(PlanSlideSchema),
});
export type PlanLessonOutput = z.infer<typeof planTableSchema>;

/** The row format, field by field; the prompt and `parsePlan` share it. */
export const ROW_FORMAT = "role | form | layout | objectives | parts | aim | teaches | tests";

/** The title slide's photograph (plan-lesson.v8): what whoever finds it looks for. */
export const titlePictureSchema = z.object({
  subject: z
    .string()
    .describe(
      "the thing itself in a few plain words, as a search would name it ('Roman legionary helmet', not 'A photograph of ...')",
    ),
  named: z
    .string()
    .nullable()
    .describe(
      "the proper name of the one place, artefact, person or specimen this photo must show; null when any photo of its kind will do",
    ),
  mustShow: z.array(z.string()).max(3).describe("up to 3 short labels, not shown on the slide"),
});

/** What the planner writes: the header, then one coded row per slide after the objectives. */
export const planLessonSchema = z.object({
  misconception: z
    .string()
    .describe("the one wrong idea that matters most for these pupils, then the correct idea"),
  objectives: z.array(z.string()).min(1).max(4),
  runningExample: z.string(),
  titlePicture: titlePictureSchema,
  slides: z
    .array(z.string())
    .describe(`one row per slide after the objectives slide: ${ROW_FORMAT}`),
});
export type PlanLessonWire = z.infer<typeof planLessonSchema>;

const none = (v: string) => v === "" || v === "-" || /^none$/i.test(v);
const listOf = (v: string) =>
  none(v.trim())
    ? []
    : v
        .split(",")
        .map((x) => x.trim())
        .filter((x) => x !== "" && !none(x));

/** The two slides code draws before the planner's rows: the title and the objectives. */
const FIXED_ROWS = 2;

/**
 * The planner's rows as the table: the title row (its picture) and the objectives row first, then
 * one slide per row. A row that is not in the format keeps what it can, and is named in
 * `unreadable`.
 */
export function parsePlan(
  wire: Omit<PlanLessonWire, "titlePicture"> & { titlePicture?: PlanSlide["imageBrief"] },
): { plan: PlanLessonOutput; unreadable: number[] } {
  const unreadable: number[] = [];
  const every = wire.objectives.map((_, i) => i + 1);
  const fixed = { tests: [], teaches: [], parts: 0, layout: "default", figureBrief: null };
  const pic = wire.titlePicture;
  const title: PlanSlide = {
    ...fixed,
    role: "title",
    objectives: every,
    purpose: "the lesson title and its picture",
    form: "title",
    imageBrief:
      pic && typeof pic.subject === "string" && pic.subject.trim()
        ? {
            subject: pic.subject,
            named: typeof pic.named === "string" && pic.named.trim() ? pic.named.trim() : null,
            mustShow: (pic.mustShow ?? []).filter((m) => typeof m === "string"),
          }
        : null,
  };
  const objectivesRow: PlanSlide = {
    ...fixed,
    role: "objectives",
    objectives: every,
    purpose: "the lesson's objectives",
    form: "objectives",
    imageBrief: null,
  };
  const rows = wire.slides.map((line, i): PlanSlide => {
    const f = line.split("|").map((x) => x.trim());
    if (f.length !== 8) unreadable.push(i + 1 + FIXED_ROWS);
    const [
      role = "",
      form = "",
      layout = "",
      objectives = "",
      parts = "",
      aim = "",
      teaches = "",
      tests = "",
    ] = f;
    const count = Number.parseInt(parts, 10);
    // "hinge (stacked)" in the form field: the menu's own name for a layout, read as form + layout.
    const named = /^(.+?)\s*\((.+)\)$/.exec(form);
    const [formName, layoutName] = named ? [named[1] ?? "", named[2] ?? ""] : [form, layout];
    return {
      role: role.toLowerCase(),
      objectives: listOf(objectives)
        .map((o) => Number.parseInt(o.replace(/^o/i, ""), 10))
        .filter((o) => Number.isInteger(o)),
      tests: listOf(tests),
      teaches: listOf(teaches),
      purpose: aim,
      parts: Number.isInteger(count) && count >= 0 ? count : 0,
      form: formName.toLowerCase(),
      layout: none(layoutName) ? "default" : layoutName.toLowerCase(),
      imageBrief: null,
      figureBrief: null,
    };
  });
  return {
    plan: {
      misconception: wire.misconception,
      objectives: wire.objectives,
      runningExample: wire.runningExample,
      slides: [title, objectivesRow, ...rows],
    },
    unreadable,
  };
}

/** The table back in the planner's own format (for a repair). */
export function toWire(plan: PlanLessonOutput): PlanLessonWire {
  const l = (xs: readonly (string | number)[]) => (xs.length ? xs.join(", ") : "-");
  return {
    misconception: plan.misconception,
    objectives: plan.objectives,
    runningExample: plan.runningExample,
    titlePicture: (() => {
      const pic = plan.slides[0]?.imageBrief;
      return pic
        ? { ...pic, named: pic.named ?? null }
        : { subject: "", named: null, mustShow: [] };
    })(),
    slides: plan.slides
      .filter((s, i) => !(i === 0 && s.form === "title") && !(i === 1 && s.form === "objectives"))
      .map((s) =>
        [
          s.role,
          s.form,
          s.layout,
          l(s.objectives),
          s.parts,
          s.purpose,
          l(s.teaches),
          l(s.tests),
        ].join(" | "),
      ),
  };
}

/**
 * How many of a deck's rows teach, as the Slides line states it: about two thirds of the rows after
 * the objectives slide, rounded to a range (8 rows: "5 or 6"; 4 rows: "2 or 3"). Chalkie teaches on
 * about 60–70% of those rows; a lone floor is met exactly (plan-lesson.v10), so the line names a range.
 */
export function teachRange(rows: number): string {
  const lo = Math.max(1, Math.floor((rows * 2) / 3));
  const hi = Math.max(lo, Math.min(rows - 1, Math.ceil(rows * 0.7)));
  return hi > lo ? `${lo} or ${hi}` : `${lo}`;
}

/** Shared by the planner, the writers and the single stream (reused verbatim). */
export const HOUSE_RULES = `Write in British English spelling and conventions.
Never invent or include the name of any pupil, student or member of staff.`;

/** The planning rules, from "Decide the fields" to the end (reused by stream-lesson). */
export const PLAN_RULES = `Decide the fields in this order:
- misconception: the one wrong idea about this topic that matters most for these pupils, then the correct idea.
- objectives: what pupils will be able to do by the end, each on one line, starting with a verb. Usually three; one or two only when the topic is a single method or skill. Pitch them at what this year group's specification expects, harder cases included. They go on their own slide straight after the title; code adds both, as slides 1 and 2.
- runningExample: one case, context or question the whole lesson returns to, so the slides tell one story.
- titlePicture: the photograph on the title slide, a real place, thing or event this lesson teaches, filling the frame: its subject in a few plain words, and up to three things it must show.
- slides: one row for each slide after the objectives slide, as "${ROW_FORMAT}".

The shape is yours to choose as good teaching for this topic and this age: whether the lesson opens by recalling earlier learning, with a hook, or straight into teaching; where a hinge checks the idea everything after it depends on, before pupils work alone; and where pupils practise and apply. The exit ticket is on the worksheet, so no slide is an exit.
Order the ideas so each builds on the one before. Every objective is taught on a slide before any slide tests it, and pupils do what it says on a later slide.
Teaching is a slide's job unless the lesson needs it for something else. After the objectives slide, about two thirds of the slides teach: the Slides line gives how many. Each objective has at least one teach slide, and each teach slide carries its idea's facts, example and explanation. The other slides are only these: an opening (a retrieve or a hook), a check after each idea or pair of ideas, and the hinge; a practise slide only when a slide is still spare. When the slides are few, the practise slide gives way first, then the opening, then the checks, which the hinge covers; the hinge and the teach slides stay.
Each slide where pupils answer, sort, match or write asks something new.

Each row, fields in order, split by " | ", "-" for none:
- role: retrieve (recalls earlier learning), hook (a question, case or picture that opens the puzzle), teach, check (a quick question on what was just taught), hinge (the check the rest of the lesson depends on) or practise (pupils use the idea on a new case, in their own words).
- form and layout: from the palette, chosen by the shape of the content and its count. A diagram slot, whose labels take any number of parts, draws a process, a structure or a layout. Steps, stages or a chain of events are taught as a sequence, or as a diagram slot when they make a process or a cycle, and a sort only checks an order already taught; a hinge's options are each a word, a number or a short phrase, and when the natural options would be whole ideas, methods or outlines the check takes another form; two things set side by side are a compare; a method pupils will carry out is a worked example; a teach slide is a photo or a diagram slot unless its idea cannot be pictured: a diagram slot wherever the idea has a shape (a process, a cycle, a graph, a structure, a labelled cross-section, a bar model, a number line, a table), otherwise a photo of the real place, object, event or specimen it teaches. A slide whose idea cannot be pictured has none.
- objectives: the numbers of the objectives it serves, split by commas; "-" for retrieve or hook.
- parts: how many items its layout's counted slot will hold: its steps, points, sides, pairs, cards, terms, gaps, options, questions or sentences. The parts fit the layout's count. When an idea has more parts than a form holds, choose a form that holds them or split the idea over two slides.
- aim: what the slide does, in a few words; the writer adds the detail.
- teaches: a short key for each idea the slide teaches, split by commas.
- tests: on a check, hinge or practise, the keys of what it asks, each copied exactly from the teaches of an earlier row; "-" on other roles.
Example row: teach | compare | default | 2 | 2 | a solid keeps its shape, a liquid takes its container's | solid-vs-liquid | -

Size the lesson in slides: no minutes or timings anywhere.`;

const SYSTEM = `You are an experienced UK teacher planning a whole lesson as slides. You make every teaching decision here. Writers then write each slide from your plan, and they see the whole plan, so each row says what its slide does and the writer fills in the detail and the pictures.\n\n${HOUSE_RULES}\n\n${PLAN_RULES}`;

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
  lines.push(
    `Slides: ${n}. Slide 1 is the title and slide 2 the objectives; write ${n - FIXED_ROWS} rows, for slides 3 to ${n}. ${teachRange(n - FIXED_ROWS)} of them teach.`,
  );
  if (input.repair) {
    lines.push(
      "",
      "Your plan:",
      JSON.stringify(toWire(input.repair.previous)),
      "",
      "It breaks these rules:",
      ...input.repair.problems.map((p) => `- ${p}`),
      "Return the whole plan again, changing only what these rules need.",
    );
  }
  return { system: SYSTEM, user: lines.join("\n") };
}
