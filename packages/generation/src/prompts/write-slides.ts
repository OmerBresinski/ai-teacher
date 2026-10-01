import { HOUSE_RULES, type PlanSlide } from "./plan-lesson";
import { type Audience, audienceBlock } from "./shared";

/*
 * write-slides.v1 (spike/plan-write): parallel writers, 2–3 slides each, and the one fit re-write.
 * Drafted in scratchpad/quality-prd/lab/plan-write/prompts-draft/write-slides.md (reasons in
 * PROMPT-NOTES.md). The output schema is built in code (`writerSchema` per slide, keyed
 * `slide<n>`); its counts are enforced there and stated here only through each contract line.
 */

/* v9 (spike/parallel-slides): a re-write asked by a check (`reason: "check"`) says what the check found.
 * v10 (spike/stream-v4): that line reworded (it read "a check ... found a problem: <clause>", and a check
 * is also a slide role); practice is work done alone that steps up to the lesson's hardest case, not one
 * open prompt; a diagram is the kind the text needs, marks what the text names, one label per real part,
 * on the part it names; a photo brief names the one specific thing it must show (`named`, for Commons).
 * v11: v10's smoke (ad907742) gave maths a stepped 3-item set, but history 3 closed recall questions;
 * the practice form now follows the objective's verb (a set to work out, a written task to explain).
 * v12: the photo slot's contract and schema carry `named` (proper name or null; code routes it to Commons). */
/* v14 (merge): v13's photo subject (spike/photo-bench); the exit role gone (its ticket is on the
 * worksheet); the notes rule no longer says "first", since the stream schema puts notes last. */
/* v15 (round A2, explanations that build; ruling 140's larger body): a slot's lines are for the complete
 * explanation, not the fewest words; a teach slide is one claim backed on the slide, case first then the
 * general rule; a worked example fades (the teacher shows the first step, the class gives the rest). */
/* v15 (round A6): the photo subject is worded as a photo library captions it; a photo slide's first sentence
 * points at what to notice. */
/* v16 (merge, round B base): A2's and A6's v15 together. Both set a teach slide's first sentence (A2: the
 * case; A6: what to notice in the photo), so a photo slide's photograph is now its case. */
/* v17 (round B1, practice): a practise slide is an independent set, not one open question: a list of
 * four to six numbered items on new cases in the lesson's context, stepping up from fluency through
 * reasoning to an application or problem, every answer and its working in the notes (Opus oracle). */
/* v18: exactly four items, a task heading, a short body (B1 run: five two-line items failed fit, the
 * re-write cut one and the notes kept its answer; claim headings read as teaching). Not yet benched. */
/* v19 (round C1): the first practice item is always an easy entry item, so every pupil starts; the last
 * item may return to the opening's question or case when the row's aim says so (plan-lesson.v16). */
/* v20 (round C2): a worked example shows the whole working, at least three lines, each step with its
 * reason after " — " (the reason column); the contracts' larger capacities come through contractText. */
/* v21 (round D1): C2's larger slots came back as paragraph walls and clarity fell (4.67 -> 3.67). A teach
 * slide's body is now two or three labelled chunks (case, rule, why), each a short label and one or two
 * sentences; Years 1 to 6 get shorter sentences, not less of the idea (y5 judged too wordy); a photo
 * brief names what in the photo carries the idea, for the past what survives from that time (y4). */
/* v22 (round E1): a teach chunk's contract line now gives its lines (2 across the full slide, 3 beside a
 * picture: about 55-60 words in three chunks, C2's clearest); the line calibration names a two-line
 * chunk, since D1's chunks ran to four and five lines and four of eleven teach slides overran. */
export const WRITE_SLIDES_VERSION = "write-slides.v22";

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
    /**
     * Why the field is written again: it does not fit (the default), or a check found it wrong
     * (a fact, a finding, or an answer key that disagrees with itself; spike/parallel-slides).
     */
    reason?: "fit" | "check";
  };
  /**
   * A hinge that still does not fit after its re-write, written again as another check on the same
   * idea (UX ruling 136). The output is one slide keyed by `kind`, one of `kinds`.
   */
  recheck?: {
    slide: WriteSlideTarget;
    failure: string;
    current: Record<string, unknown>;
    kinds: { kind: string; contract: string }[];
  };
};

/** The writing rules, from "Pitch the content" to the end (reused by stream-lesson). */
export const WRITE_RULES = `Pitch the content at what this year group's specification expects, and the language at the reading level given; explain any word a pupil at that level would not know.

Fill each slot exactly as its contract line says: its count of items, lines or sentences, the kind of text each one is, and the lines it takes on the slide. A line here is a line of large projected type, much shorter than a line on a page: "Kenya is hotter than the Arctic" fills a heading's line; "Oak flowers are pollinated by the wind" fills the line of a full-width card; "I think the main reason was…" is half a line; "Positive ions move to the negative electrode, where they gain electrons." takes two lines of body text, and so does the chunk "Gas: the particles are far apart and move fast. They spread out to fill any space." Write the complete explanation: every step a pupil needs to follow the idea, in the plainest words that carry it, with nothing said twice. A slot's count is the most it holds, not a target. In Years 1 to 6, each sentence says one thing, in everyday words, and a chunk is one or two short sentences: the whole idea, in shorter sentences, never less of it. Everything taught is on the slide; the notes add the teacher's talk.
Where a slot's kind is a phrase, a label or a term, write that and not a sentence: "Heavier than water", not "The stone is heavier than the water it pushes aside."
Each idea a row teaches appears on its slide itself, in the order the plan gives. The questions on other slides are written from them.
A heading is the slide's idea as a claim on one line: a subject and one verb, with no full stop and no "and", "but" or list ("Cholera spread through water", not "Cholera spread through drinking water rather than bad air in 1854 London"). The reason and the case go in the body. A worked example's heading is the label of its method ("Finding a missing angle").
A teach slide makes one claim, its heading, and its body backs that claim on the slide in two or three labelled chunks, never a paragraph: first one real case with its own detail (the running example where it fits, otherwise a place, an event, a person, a reaction, a quoted line, a source or worked numbers), then the general rule the case shows, then, where the idea needs it, how or why it holds (what acts on what, and what follows). Each chunk's label names its part in a few words a pupil can read at a glance ("In 1854", "The rule", "Why it works"). A list, compare or sequence carries its case in a point, side or step.
A worked example's question gives its case and what to find in one sentence ("Find angle x when the other two angles are 70° and 56°."), and it shows the whole working, never one step: at least three lines, each one step then " — " and why it is done ("70° + 56° = 126° — two of the angles are known", "180° − 126° = 54° — a triangle's angles add to 180°"), the last giving the answer. Its notes show the first line, then ask the class for each later line before it is revealed.
A check, hinge or practise slide asks about what its tests name, as the earlier slides that teach them state it. A retrieve or hook slide asks about what the class already knows.
Each check question has exactly one defensible answer.
A practise slide is where pupils do the thinking, alone. It is a list: its heading names the task ("Your turn: share in a ratio"); its body is one short sentence saying what to show ("Draw a bar model for each one."); its points are exactly four items, each labelled with its number ("1", "2", …) and each on a case or numbers no slide used, set in this lesson's context; when the row's aim says the last item returns to the lesson's opening question or case, that item asks the question the lesson can now settle about it. The items step up. Item 1 is an easy entry item that every pupil can do: one step, done just as taught, on a case as plain as the first one the lesson showed. Item 2 is another fluency item or a reasoning item; item 3 is a reasoning item (explain why, spot the mistake, compare two cases, choose which method fits); item 4 is an application or problem that puts the idea to work in a new situation with more than one step, up to the hardest case the lesson taught. Where an objective is to explain or describe, its item asks for a short written answer and names the evidence or term it must use; the entry item then asks for one sentence. Each item has one defensible answer.
A hinge's options are each a word, a number or a short phrase: answers only, each the same kind of answer as the right one and about as long. Each wrong one is a mistake pupils really make, and the misconception is one of them; why each is wrong goes in the notes. A true-false statement is one whole claim, true or false as written.
A photo's imageBrief names the real thing the slide teaches, which the photograph must show whole and centred: its subject in the few plain words a photo library would caption it with ("Roman milestone", "potassium permanganate crystals in water", "river level gauge", not "A photograph of a milestone by a road"), never a scene that only sets the theme. It shows the thing as the slide teaches it: for the past, what survives from that time (remains, an artefact, a preserved site), never the place as it is today where nothing of that time can be seen; mustShow lists what in the photograph carries the slide's idea. When a photo must show one specific place, artefact, person or specimen, its named field gives that thing's proper name; otherwise named is null.
A diagram slot's diagram is the kind of drawing that shows what the slide's text says, and it marks what the text names (a graph whose text names its peak marks the peak). Each label names a different real part, once, and sits on or points at the shape it names.
Pictures are for whoever finds or draws them: the slide's text never repeats a brief. On a photo slide the photograph is the case: the first chunk points pupils at what to notice in it and what that shows ("The carved number: it tells a soldier how far it is to the next fort."), and the general rule follows.
An explain-callout's callout states the misconception as wrong, with "not" ("Evaporation is not the same as boiling.").
The notes on every slide are what you say aloud as it is shown, with no timings. On a teach slide they tell the slide in your words (an analogy, the question you ask the class); everything a question tests is on a slide itself. On a question slide they open with the answer and why it is right, then what each wrong answer shows and what to do next. On a practise slide they give every item's answer with its working, or the points a good written answer makes, then one harder challenge for pupils who finish early, with its answer.
A subject specialist checks every slide before the lesson is taught: give each date, number, name and rule as this year group's specification states it.`;

const SYSTEM = `You are an experienced UK teacher writing the slides of a planned lesson. The plan fixes each slide's role, form, layout and what it teaches; you write the slides you are given, each in its form and layout. A row gives its slide's aim in a few words; the detail, the examples and any picture's description are yours. Nothing rewrites your words, so what you write is the slide.\n\n${HOUSE_RULES}\n${WRITE_RULES}`;

const list = (xs: readonly (string | number)[]) => xs.join(", ");

/** One plan row as the writers read it; empty fields are left out. */
function rowLine(s: PlanSlide, n: number): string {
  if (n === 1) return "1 title";
  if (n === 2 && s.form === "objectives") return "2 objectives";
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
    const { slide, field, failure, current, reason } = input.rewrite;
    lines.push(
      `Write slide ${slide.number}.`,
      "",
      targetBlock(slide, input.table),
      "",
      `Your slide ${slide.number} as written:`,
      JSON.stringify(current),
      reason === "check"
        ? `Checking slide ${slide.number} found this in its ${field}:\n${failure}\nWrite ${field} again with that put right, as its contract line says, so it agrees with the rest of the slide, which stays as it is.`
        : `It does not fit its slide: ${failure}. Write ${field} again as its contract line says. The rest of the slide stays as it is.`,
    );
    return { system: SYSTEM, user: lines.join("\n") };
  }
  if (input.recheck) {
    const { slide, failure, current, kinds } = input.recheck;
    lines.push(
      `Write slide ${slide.number} again.`,
      "",
      targetBlock(slide, input.table),
      "",
      `Your slide ${slide.number} as written:`,
      JSON.stringify(current),
      `It does not fit its slide: ${failure}. Its options are ideas, too long for a hinge. Write slide ${slide.number} again as another check on the same idea, as one of these kinds:`,
      ...kinds.map((k) => k.contract),
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
