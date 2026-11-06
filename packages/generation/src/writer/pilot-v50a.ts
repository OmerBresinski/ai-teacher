import { assembleWriterSystem } from "./layout-menu";
import type { WriterStage } from "./schema";

/*
 * Pilot pack v5.0a (3 Nov 2026, test runs only): back to basics. The code-built menu lines keep the
 * `Fits:` text code generates (every word limit code checks), and the routing prose before it is
 * replaced by one short line per layout: what the layout is and what its fields hold. Each line
 * must be found exactly once with exactly one " Fits: ", so a menu change in code fails loudly here.
 *
 * Length budget: the assembled text, these lines included, has a ceiling per key stage in
 * `prompt-budget.json` (`prompt-budget.test.ts`). Any growth needs a reasoned step there.
 */
export const V50A_MENU_LINES: Readonly<Record<string, string>> = {
  "items-row":
    "named parts of one whole that work together (shape parts of a whole), in a row on a connecting line, each a name pupils learn and its job in one short line. motif: vessel for circulation, stem for a plant, else null.",
  "panel-list":
    "a set of kinds, examples or rules of one group (shape a set of kinds or examples), as a list beside a title panel, each item a name and one fact. When each member is a thing pupils need to see, every item gets a picture of it alone with no labels, and the panel is null; otherwise the panel holds a pie when the items are shares of one whole, else a photo of the group when a camera can show it, else null.",
  "split-compare":
    "2 or 3 true things set against each other when the contrast is the point (shape a contrast), each side a title of up to 3 words and how it differs; what they share goes in the heading. A side carries a picture when a camera can show it, a diagram when the difference is in how each is built or works, or, for people's viewpoints, a quote in their voice (2 sides only).",
  worked:
    "one problem solved one move at a time (shape worked example), one row per click: the move in words, then the equation it gives, with answer true on the row that reaches the answer. check is null or one line putting the answer back into the problem, the value put back between asterisks. panel is null, or a bar model beside the rows: algebra-bar (a, b, c) for an equation, percent-bar (amount, percent) for a percentage of an amount.",
  stages:
    "named stages of one process that runs one way (shape sequence), joined by arrows, each a name, one line on what happens there (empty only where the name says it all) and its closest listed icon; every stage has a picture or none does.",
  reasons:
    "why or how something happened or is so (shape reasons or causes): the heading asks the question, answered on this slide by reasons, one per click, each a head, one line and its closest listed icon, or every icon null when the icons do not cover them all; kind chain is a chain of consequences, each link leading to the next. lead is null or one line under the question. picture is null or one photo of what the question asks about; no diagram.",
  "figure-slide":
    "one figure filling the slide that carries its idea, a model from the Models list or a photo pupils study like one, with a one-line caption saying what to take from it and the topic's closest listed icon, shown if the figure fails. At most one per lesson; a chart or diagram drawn from your data goes to big-visual.",
  myth: "the misconception slide, only when pupils of this age commonly hold a belief about what the objectives teach; plan none rather than make one up. The claim in plain words, its verdict (myth, or true for a true claim pupils commonly doubt), the fact that settles it, factEm null or one exact span of the fact to show in colour, and proof null or one short line with 1 to 3 listed icons or one picture. opening vote asks the class first; straight starts at the verdict and is only for a myth. It asks no question and holds no diagram.",
  "visual-text key-card-fig":
    "a picture beside a lead, points and key cards, for one named idea pupils need to see, plus the closest listed icon, shown if the picture fails. Each card is a word or rule (label, term and meaning), examples (label and pairs) or a fact (label, number and unit); fields a card does not use are null.",
  hinge:
    "one multiple-choice question on the idea just taught (shape check). The heading is the question; the correct option comes first (code shuffles them), then each wrong option, a belief pupils plausibly hold, with that belief in its why (teacher notes only; the correct option's why is null). A wrong option with working carries the mistaken step and every later step done correctly. When every option is a thing a listed icon shows, each takes that icon and a name; otherwise every icon is null.",
  "question-set":
    "a quick check (shape recall or check): short questions pupils answer at once, aloud or on whiteboards, each with an answer of a number, a word or a short phrase, revealed one click at a time.",
  practice:
    "tasks pupils work on alone in their books (shape check), each with the answer a pupil should reach, and a picture or diagram when the tasks work from one.",
  "exit-ticket":
    "questions pupils answer alone at the end of the lesson (shape check), where the context puts the exit ticket, each with its answer, together checking the objectives.",
};

/** v5.0a's menu lines: each code-built line's prose replaced, its generated Fits kept. */
export function v50aMenus(assembled: string, stage: WriterStage): string {
  let text = assembled;
  for (const [layout, line] of Object.entries(V50A_MENU_LINES)) {
    const head = `\n- ${layout}: `;
    if (text.split(head).length !== 2)
      throw new Error(`pilot pack v5.0a (${stage}): no single ${layout} menu line`);
    const start = text.indexOf(head) + head.length;
    const endAt = text.indexOf("\n", start);
    const end = endAt < 0 ? text.length : endAt;
    const old = text.slice(start, end);
    const fits = old.split(" Fits: ");
    if (fits.length !== 2)
      throw new Error(`pilot pack v5.0a (${stage}): ${layout} needs one Fits clause`);
    text = `${text.slice(0, start)}${line} Fits: ${fits[1]}${text.slice(end)}`;
  }
  return text;
}

/** v5.0a's system text from its template: assembled as v4.17's (reasons picture on), then its menu lines. */
export function v50aSystem(template: string, stage: WriterStage): string {
  return v50aMenus(assembleWriterSystem(template, stage, { reasonsPicture: true }), stage);
}
