import { HOUSE_RULES, type PlanSlide } from "./plan-lesson";
import { type Audience, audienceBlock } from "./shared";

/*
 * write-slides.v1 (spike/plan-write): parallel writers, 2–3 slides each, and the one fit re-write.
 * Drafted in scratchpad/quality-prd/lab/plan-write/prompts-draft/write-slides.md (reasons in
 * PROMPT-NOTES.md). The output schema is built in code (`writerSchema` per slide, keyed
 * `slide<n>`); its counts are enforced there and stated here only through each contract line.
 */

export const WRITE_SLIDES_VERSION = "write-slides.v7";

/** One slide this call writes: its row number, form, layout and contract. */
export type WriteSlideTarget = {
  /** 1-based slide number; the output key is `slide<number>`. */
  number: number;
  form: string;
  layout: string;
  /** `contractText(form, layout)` (or the question set's contract). */
  contract: string;
};

export type WriteSlidesInput = {
  topic: string;
  audience: Audience;
  objectives: string[];
  runningExample: string;
  misconception: string;
  /** The WHOLE checked slide table, slide 1 (the title) first. */
  table: PlanSlide[];
  /** The slides this call writes (2–3). */
  slides: WriteSlideTarget[];
  /**
   * A re-write of one field of one slide that failed the fit check. The output is then just
   * `{ [field]: … }`. `failure` says what the slide showed (e.g. "the heading sits on 2 lines on 4
   * of 10 themes"); never a word or character limit.
   */
  rewrite?: {
    slide: WriteSlideTarget;
    field: string;
    failure: string;
    current: Record<string, unknown>;
  };
};

/** The writing rules, from "Pitch the content" to the end (reused by stream-lesson). */
export const WRITE_RULES = `Pitch the content at what this year group's specification expects, and the language at the reading level given; explain any word a pupil at that level would not know.

Fill each slot exactly as its contract line says: its count of items, lines or sentences, the kind of text each one is, and the lines it takes on the slide. A line here is a line of large projected type, much shorter than a line on a page: "Kenya is hotter than the Arctic" fills a heading's line; "Oak flowers are pollinated by the wind" fills the line of a full-width card; "I think the main reason was…" is half a line; "Positive ions move to the negative electrode, where they gain electrons." takes two lines of body text. Say each idea in the lines its slot has, in the plainest words that carry it. Everything taught is on the slide; the notes add the teacher's talk.
Where a slot's kind is a phrase, a label or a term, write that and not a sentence: "Heavier than water", not "The stone is heavier than the water it pushes aside."
Each idea a row teaches appears on its slide itself, in the order the plan gives. The questions on other slides are written from them.
A heading is the slide's idea as a claim on one line: a subject and one verb, with no full stop and no "and", "but" or list ("Cholera spread through water", not "Cholera spread through drinking water rather than bad air in 1854 London"). The reason and the case go in the body. A worked example's heading is the label of its method ("Finding a missing angle").
A teach slide's body says how or why its claim holds (what acts on what, and what follows) and works one real case through it, with the case's own detail: the running example where it fits, otherwise a place, an event, a person, a reaction, a quoted line or worked numbers. A list, compare or sequence carries its case in a point, side or step.
A worked example's question gives its case and what to find in one sentence ("Find angle x when the other two angles are 70° and 56°."), and each line of working is one calculation or one phrase ("180° − 126° = 54°", "so x is 54°").
A check, hinge, practise or exit slide asks about what its tests name, as the earlier slides that teach them state it. A retrieve or hook slide asks about what the class already knows.
A practise slide has pupils do what its objective says, on a case or numbers that no teach slide used.
A hinge's options are answers only, each the same kind of answer as the right one and about as long. Each wrong one is a mistake pupils really make, and the misconception is one of them; why each is wrong goes in the notes. A true-false statement is one whole claim, true or false as written.
An explain-callout's callout states the misconception as wrong, with "not" ("Evaporation is not the same as boiling.").
Notes come first on every slide: what you say aloud as it is shown, with no timings. On a teach slide they tell the slide in your words (an analogy, the question you ask the class); everything a question tests is on a slide itself. On a question slide they open with the answer and why it is right, then what each wrong answer shows and what to do next.
A subject specialist checks every slide before the lesson is taught: give each date, number, name and rule as this year group's specification states it.`;

const SYSTEM = `You are an experienced UK teacher writing the slides of a planned lesson. The plan fixes each slide's role, form, layout and what it teaches; you write the slides you are given, each in its form and layout. A row gives its slide's aim in a few words; the detail, the examples and any picture's description are yours. Nothing rewrites your words, so what you write is the slide.\n\n${HOUSE_RULES}\n${WRITE_RULES}`;

const list = (xs: readonly (string | number)[]) => xs.join(", ");

/** One plan row as the writers read it; empty fields are left out. */
function rowLine(s: PlanSlide, n: number): string {
  if (n === 1) return "1 title";
  const bits = [`${n} ${s.role}`];
  if (s.objectives.length > 0) bits.push(`objectives ${list(s.objectives)}`);
  bits.push(`${s.form}${s.layout === "default" ? "" : ` (${s.layout})`}`, s.purpose);
  if (s.teaches.length > 0) bits.push(`teaches: ${s.teaches.join(" | ")}`);
  if (s.tests.length > 0) bits.push(`tests: ${s.tests.join(" | ")}`);
  return bits.join(" · ");
}

function pictureLine(s: PlanSlide | undefined): string | undefined {
  if (s?.imageBrief) {
    const shows = s.imageBrief.mustShow.length ? `; shows ${s.imageBrief.mustShow.join(", ")}` : "";
    return `Picture: ${s.imageBrief.subject}${shows}`;
  }
  return s?.figureBrief ? `Picture: ${s.figureBrief}` : undefined;
}

function targetBlock(t: WriteSlideTarget, table: readonly PlanSlide[]): string {
  const row = table[t.number - 1];
  const head = `Slide ${t.number}: ${row?.role ?? "slide"}, ${t.form}${t.layout === "default" ? "" : ` (${t.layout})`}`;
  const picture = pictureLine(row);
  return [head, t.contract, ...(picture ? [picture] : [])].join("\n");
}

export function writeSlidesPrompt(input: WriteSlidesInput): { system: string; user: string } {
  const lines = [
    `Topic: ${input.topic}`,
    audienceBlock(input.audience),
    "",
    "The lesson plan",
    "Objectives:",
    ...input.objectives.map((o, i) => `${i + 1}. ${o}`),
    `Misconception: ${input.misconception}`,
    `Running example: ${input.runningExample}`,
    "Slides:",
    ...input.table.map((s, i) => rowLine(s, i + 1)),
    "",
  ];
  if (input.rewrite) {
    const { slide, field, failure, current } = input.rewrite;
    lines.push(
      `Write slide ${slide.number}.`,
      "",
      targetBlock(slide, input.table),
      "",
      `Your slide ${slide.number} as written:`,
      JSON.stringify(current),
      `It does not fit its slide: ${failure}. Write ${field} again as its contract line says. The rest of the slide stays as it is.`,
    );
    return { system: SYSTEM, user: lines.join("\n") };
  }
  const nums = input.slides.map((t) => t.number);
  const which =
    nums.length === 1
      ? `slide ${nums[0]}`
      : nums.length === 2
        ? `slides ${nums[0]} and ${nums[1]}`
        : `slides ${nums[0]} to ${nums[nums.length - 1]}`;
  lines.push(`Write ${which}.`);
  for (const t of input.slides) lines.push("", targetBlock(t, input.table));
  return { system: SYSTEM, user: lines.join("\n") };
}
