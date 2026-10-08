// Bake-off eval prompts (gpt-6-luna, effort low, strict structured output). PROMPTS.md is generated from this
// file by `bun llm/run.ts --prompts-md`, so the two never drift. Version every edit here.
import { z } from "zod";

export const VERSIONS = {
  answerable: "bake-answerable.v3",
  objectives: "bake-objectives.v2",
  picq: "bake-picture-questions.v2",
  picvqa: "bake-picture-answer.v1",
  reader: "bake-reader-quiz.v1",
  mark: "bake-reader-mark.v1",
  visualfit: "bake-visual-fit.v2", // run agent: callStructured needs a version label for this job (label only)
} as const;

type Deck = any;
type Slide = any;

const head = (d: Deck) => `Year group: ${d.year}. Subject: ${d.subject}. Topic: ${d.title}.`;
const qLine = (q: any) =>
  `${q.id}: ${q.text}${q.options.length ? "\n" + q.options.map((o: string) => `  ${o}`).join("\n") : ""}`;

/* ---------- 1. Questions answerable from their own slide (text only, one call per lesson) ---------- */
export const answerableSystem = `You check the questions on a lesson's question slides. A pupil sees one slide at a time. For each question, decide whether the material the question tells the pupil to use is on that same slide, and whether the slide already gives its answer away.

Material is anything the pupil has to look at or read to answer: figures or data, a quotation or extract, a source, a picture, a diagram, a table, a graph, a map, or a worked example. Knowledge is not material: a question that asks pupils to recall, explain or apply an idea, fact, term or method taught earlier needs no material, even when it names that idea ("Use what you know about ...", "Using the idea of ...").

For each question, in the order given:
- material: the words in the question that point to material ("the casualty figures", "the extract", "the map"), copied from the question; "none" when it points to no material.
- onSlide: "yes" when that material is on the same slide, in its text or in a picture or diagram described there; "no" when it is not; "n/a" when material is "none".
- givenAwayBy: the words on the same slide, outside this question, that state or plainly reveal its answer, so a pupil could answer by reading them without having learned it: in another question or its options, the heading, a caption or label, or the slide's text. Copy them exactly; "none" when nothing does. Material the question asks pupils to read or use does not count: finding the answer there is the task.
- givenAway: "yes" when givenAwayBy quotes words that state the answer; otherwise "no".

Two questions on a slide that shows only a heading and the questions:
- "Using the casualty figures, explain why the Normans won at Hastings." gives material "the casualty figures", onSlide "no".
- "Explain one reason the Normans won at Hastings." gives material "none", onSlide "n/a".

Two questions on one slide: "1. Name the young horse. 2. What will it grow into?" Question 2 gives givenAwayBy "Name the young horse.", givenAway "yes": question 1 already says it is a horse.`;

export function answerableUser(d: Deck, slideText: (s: Slide) => string): string {
  const blocks = d.slides
    .filter((s: Slide) => s.questions.length)
    .map(
      (s: Slide) =>
        `Slide ${s.n}\nOn the slide:\n${slideText(s)}\nQuestions:\n${s.questions.map(qLine).join("\n")}`,
    );
  return `${head(d)}\n\n${blocks.join("\n\n")}`;
}
export const answerableSchema = z.object({
  rows: z.array(
    z.object({
      id: z.string(),
      material: z.string(),
      onSlide: z.enum(["yes", "no", "n/a"]),
      givenAwayBy: z.string(),
      givenAway: z.enum(["yes", "no"]),
    }),
  ),
});

/* ---------- 2. Objectives taught and checked (text only, one call per lesson) ---------- */
export const objectivesSystem = `You map a lesson's objectives to its slides. You are given the objectives and the on-screen text of each slide, marked as a teaching slide or a question slide. Pictures and diagrams appear as a description in square brackets.

For each objective, in the order given:
- look: the numbers of every slide whose content deals with this objective, in one line.
- taught: each teaching slide that teaches some of what the objective says pupils will learn. It must explain, show or demonstrate that content; a slide that only names the topic does not count. A slide that teaches part of the objective counts. Give the slide number and a quote of up to 12 words copied exactly from that slide.
- checked: each question slide with a question whose correct answer needs this objective's content. Give the slide number and up to 12 words of that question, copied exactly.

When no slide qualifies, the list is empty. A slide can count for more than one objective.`;

export function objectivesUser(d: Deck, slideText: (s: Slide) => string): string {
  const objs = d.objectives.map((o: any) => `${o.id}: ${o.text}`).join("\n");
  const slides = d.slides
    .filter((s: Slide) => s.role === "teach" || s.role === "question")
    .map(
      (s: Slide) =>
        `Slide ${s.n} (${s.role === "teach" ? "teaching" : "question"})\n${slideText(s)}${s.questions.length ? "\n" + s.questions.map((q: any) => q.text + (q.options.length ? " " + q.options.join(" ") : "")).join("\n") : ""}`,
    );
  return `${head(d)}\n\nObjectives:\n${objs}\n\nSlides:\n\n${slides.join("\n\n")}`;
}
const cite = z.object({ slide: z.number().int(), quote: z.string() });
export const objectivesSchema = z.object({
  objectives: z.array(
    z.object({ id: z.string(), look: z.string(), taught: z.array(cite), checked: z.array(cite) }),
  ),
});

/* ---------- 3a. Picture questions (text only, one call per lesson; TIFA / Davidsonian decomposition) ---------- */
export const picqSystem = `You write yes/no questions that check whether a picture on a lesson slide shows what the slide says it shows. Another reader will answer them looking only at the picture, without the slide, so each question must make sense on its own.

For each picture you get the slide's on-screen text and the request the picture was made or chosen from. Write questions from what the text and the request say the picture shows, of these kinds:
- subject: one question per main thing the picture must show ("Does the picture show a fire engine?"). Every picture gets at least one.
- attribute: a stated property of a subject: its colour, its state, a part it has or lacks, what it is doing.
- count: only where the text or the request states a number of things ("Are there exactly three ladders?").
- relation: a stated position or comparison between two things ("Is the fire engine in front of the house?").
- label: a word, number or label the text says is in the picture ("Is the top bar labelled 40?").

Each question holds one fact and is worded so that "yes" means the picture matches. Name things as a pupil would see them. dependsOn is the id of the subject question that an attribute, count, relation or label question is about, and null for a subject question. Ask about content only, never about style, quality, or whether it is a photo or a drawing. Write at most 6 questions per picture; when there are more facts, keep the ones the slide's text relies on.`;

export function picqUser(d: Deck, slideText: (s: Slide) => string): string {
  const blocks: string[] = [];
  for (const s of d.slides)
    for (const p of s.pictures.filter((p: any) => !p.background))
      blocks.push(
        `Picture ${p.id} (${p.kind}) on slide ${s.n}\nSlide text:\n${slideText({ ...s, pictures: [] })}\nRequest: ${p.request ?? p.alt ?? "(none)"}`.replace(
          /Request: $/,
          "Request: (none)",
        ),
      );
  return `${head(d)}\n\n${blocks.join("\n\n")}`;
}
export const picqSchema = z.object({
  pictures: z.array(
    z.object({
      id: z.string(),
      questions: z.array(
        z.object({
          id: z.string(),
          kind: z.enum(["subject", "attribute", "count", "relation", "label"]),
          question: z.string(),
          dependsOn: z.string().nullable(),
        }),
      ),
    }),
  ),
});

/* ---------- 3b. Picture answers (vision, one call per picture, the picture cropped from the render) ---------- */
export const picvqaSystem = `You answer yes/no questions about one picture. Answer from what is visible in the picture, not from what the question suggests or from what such pictures usually show.

For each question, in order:
- seen: what you see in the picture that bears on the question, in one short sentence. When the thing asked about is not visible, say so. For a count, count the things one by one here.
- answer: "yes" when the picture clearly shows it; "no" when the picture shows otherwise or does not show it; "unsure" only when the picture is too small, cropped or unclear to tell.`;

export const picvqaUser = (qs: { id: string; question: string }[]) =>
  `Questions:\n${qs.map((q) => `${q.id}: ${q.question}`).join("\n")}`;
export const picvqaSchema = z.object({
  answers: z.array(
    z.object({ id: z.string(), seen: z.string(), answer: z.enum(["yes", "no", "unsure"]) }),
  ),
});

/* ---------- 4a. Reader quiz (vision, one call per lesson: the teaching slides only) ---------- */
export const readerSystem = `You are a pupil who has been shown these lesson slides and nothing else. Answer each question using only what the slides show. Do not use anything you know from elsewhere: when no slide gives what the answer needs, say so.

For each question, in the order given:
- slide: the number of the slide that gives what you need; 0 when no slide does.
- seen: what that slide shows that you used. Copy its words, or describe the part of the picture or diagram. Leave it empty when slide is 0.
- answer: your answer as a pupil would write it, in one or two sentences, or the letter and text of the option you choose. Write "Not on the slides" when slide is 0.`;

export function readerUser(d: Deck, shown: number[], qs: any[]): string {
  return `Year group: ${d.year}. Subject: ${d.subject}.\nThe images are slides ${shown.join(", ")}, in that order.\n\nQuestions:\n${qs.map(qLine).join("\n")}`;
}
export const readerSchema = z.object({
  answers: z.array(
    z.object({ id: z.string(), slide: z.number().int(), seen: z.string(), answer: z.string() }),
  ),
});

/* ---------- 4b. Marking the reader (text only, one call per lesson) ---------- */
export const markSystem = `You mark a reader's answers to a lesson's questions. For each question you get: the question and its place on its slide, the teacher notes for that slide (they hold the intended answers), any answer the slide reveals, the reader's answer, and the content of the slide the reader cited with what the reader said they used from it.

For each question, in order:
- key: the intended answer to this question, copied from the teacher notes or the revealed answer; "none" when neither gives one.
- matchesKey: "yes" when the reader's answer agrees with the key on everything the key requires; "partly" when it gets some of it; "no" when it is wrong, misses the point, or says it is not on the slides; "n/a" when key is "none". Where the question asks for a reason, an explanation or an example, an answer the key would accept counts, in any wording.
- supported: "yes" when the cited slide's content contains what the reader needed for that answer; "no" when the answer needs something the slide does not show, or no slide was cited.`;

export function markUser(d: Deck, items: any[]): string {
  return (
    `${head(d)}\n\n` +
    items
      .map(
        (it) =>
          `Question ${it.id} (question ${it.pos} of ${it.of} on slide ${it.slide}): ${it.text}${it.options.length ? "\n  " + it.options.join("\n  ") : ""}
Teacher notes for slide ${it.slide}: ${it.notes || "(none)"}
Revealed on the slide: ${it.revealed || "(nothing)"}
Reader's answer: ${it.answer}
Cited slide: ${it.cited ? `slide ${it.cited}\n${it.citedText}\nReader says they used: ${it.seen || "(nothing)"}` : "none"}`,
      )
      .join("\n\n")
  );
}
export const markSchema = z.object({
  marks: z.array(
    z.object({
      id: z.string(),
      key: z.string(),
      matchesKey: z.enum(["yes", "partly", "no", "n/a"]),
      supported: z.enum(["yes", "no"]),
    }),
  ),
});

/* ---------- 5. Visual fit (text only, one call per lesson; reported, not a gate) ---------- */
export const VISUALFIT_VERSION = "bake-visual-fit.v2";
export const visualfitSystem = `You judge where a lesson's pictures and diagrams belong, for the pupils and subject given. How much a lesson should show depends on the subject and the age: younger pupils, and subjects about real things, places, processes, structures and evidence, need more; older pupils working on arguments, interpretations, calculations or language need fewer.

Part 1. Each teaching slide listed under "Slides with no picture":
- need: "yes" when pupils of this age would learn what this slide teaches clearly better by seeing something: what a thing looks like, its parts or structure, a process or sequence, a place, a quantity or comparison drawn to scale, data, or the source or artefact being studied. "no" when the slide's words carry it: a definition, an argument, an interpretation, a method shown step by step in writing, a text being analysed, or something pupils at this age already picture without help.
- shows: when need is "yes", what the picture or diagram would show, in one phrase; otherwise "none".

Part 2. Each picture or diagram listed under "Pictures and diagrams":
- role: "teaches" when it carries content pupils need for this slide: the thing the slide is about, its parts, a process, data, a comparison, or the source being studied. "decorative" when it only sets a mood, shows the topic in general, or repeats a word on the slide without anything pupils use.
- why: one short sentence.

Two boundary examples, on topics outside this lesson:
- Year 3 slide "A volcano erupts when magma rises through a vent" with no picture: need "yes", shows "a cut-away volcano with the magma chamber, vent and lava labelled".
- Year 11 slide "Malvolio's letter scene: the trick depends on his vanity" with a stock photo of a theatre stage: role "decorative".`;

// seen: the picture-answer probe's (3b) "seen" sentences per picture id, when it has run.
export function visualfitUser(
  d: Deck,
  slideText: (s: Slide) => string,
  seen: Record<string, string[]> = {},
): string {
  const teach = d.slides.filter((s: Slide) => s.role === "teach");
  const bare = teach.filter((s: Slide) => !s.pictures.some((p: any) => !p.background));
  const pics: string[] = [];
  for (const s of d.slides.filter((s: Slide) => s.role === "teach" || s.role === "question"))
    for (const p of s.pictures.filter((p: any) => !p.background))
      pics.push(
        `Picture ${p.id} (${p.kind}) on slide ${s.n}\nSlide text:\n${slideText({ ...s, pictures: [] })}\nAsked to show: ${p.request || "(not recorded)"}${seen[p.id]?.length ? `\nSeen in it: ${seen[p.id].join(" ")}` : ""}`,
      );
  return `${head(d)}\n\nSlides with no picture:\n\n${bare.map((s: Slide) => `Slide ${s.n}\n${slideText(s)}`).join("\n\n") || "(none)"}\n\nPictures and diagrams:\n\n${pics.join("\n\n") || "(none)"}`;
}
export const visualfitSchema = z.object({
  slides: z.array(
    z.object({ slide: z.number().int(), need: z.enum(["yes", "no"]), shows: z.string() }),
  ),
  pictures: z.array(
    z.object({ id: z.string(), why: z.string(), role: z.enum(["teaches", "decorative"]) }),
  ),
});
