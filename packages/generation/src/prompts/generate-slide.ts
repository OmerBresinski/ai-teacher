import type {
  FigureRef,
  ImagePurpose,
  LessonFacts,
  LessonPhase,
  OutlineEntry,
} from "@tj/domain/documents";
import { COMPOSITION_BUDGETS, CONTENT_SHAPES, type ContentShape, SPEC_LIMITS } from "@tj/slides";
import { figureBlock, figureShownBlock } from "./figures";
import {
  type Audience,
  audienceBlock,
  example,
  factsBlock,
  HOUSE_RULES,
  limitsBlock,
  verbBlock,
  type WritingShape,
} from "./shared";

/*
 * Generate — one slide (ADR 0025 §8; Generation quality §3, TEACH-213): the outline entry becomes
 * a per-kind spec; geometry is the recipe's business. Coherence comes from the plan, not from the
 * previous slide's text: the slide is given its own brief (what it adds, what it must not repeat),
 * its neighbours' briefs, the facts it references in full, every misconception, and the stems
 * reserved for other slides and the worksheet — so slides can be written in parallel. Since
 * TEACH-230 it is also told the lesson's objective verb (`verbBlock`): what a content, worked-example,
 * open-response or exit-ticket slide is *for* under Recall, Explain, Apply or Evaluate. UX ruling
 * 82: an outline entry has no minutes, so the slide line gives kind, phase and facts only. UX
 * ruling 81: an `instructions` slide whose facts are questions is the shared practise slide; its
 * steps are those stems verbatim and its answers go in `notes`. Quality PRD G3: when the outline
 * assigns the entry a callout, the slide line names its kind and fact ids and the writer fills
 * `callout` from them; `withAssignedCallout` (specs.ts) checks presence and kind.
 *
 * v20 (23 Sep 2026, minimalism rubric): dropped the geometry sentence (a per-kind schema admits no
 * such field), the `factRefs` echo (HOUSE_RULES says it), two "never a reserved stem" (the user turn
 * lists them), the forty-words line (the limits block) and "answers correct, distractors plausible"
 * (questions are copied verbatim; no bench failure it fixed).
 *
 * v22 (23 Sep 2026, np1 root cause RC1 follow-up): `outline-from-facts` now puts up to two key
 * ideas on one content slide, and v21's content rule spoke of "the key idea" only. A content slide
 * whose facts include two key ideas teaches both: the heading says what joins them, the body is
 * two short paragraphs, one per idea, in up to 60 words (the one-idea body stays 40). The number
 * lives in the content shape only; `SPEC_LIMITS.body` (400 characters) already holds 60 words, so
 * no schema change. Renderer: a body over forty words is laid out `two-column` (`chooseVariant`);
 * `splitAtFullStop` (`@tj/slides`) now splits at the first line break when there is one, so each
 * column carries one idea (a first draft asked for "the first in one sentence": Luna wrote the
 * first idea across two sentences on 3 of 3 long bodies, so a full-stop split cut it in half).
 *
 * v23 (24 Sep 2026, lab r3, checks.md §3 / judge B testedNotTaught): the questions that later
 * test a teaching slide's key ideas reach its writer (`laterQuestions`, read-only, lab only).
 * Round-1/2 exit and check items asked for a quotation, a name, a reason, an example or a step
 * the facts held and the slide compressed away ("I'll break my staff", Duke of Milan, why not
 * every child was evacuated, a named defence mechanism, PED from percentage changes). The user
 * turn lists them with their answers and one instruction: teach here what each answer rests on,
 * within the slide's limits. System text unchanged; the production render (no field) is
 * byte-identical, so the pinned hash did not move.
 *
 * v24 (24 Sept 2026 audit, FIX-PLAN B4): a slide whose facts include vocabulary is told, in the
 * user turn, to define each term where it is first used or in `notes` (the outline puts terms on
 * content slides and no rule said to define them). The later-questions line no longer says "or
 * repeating their answer text": the question writer answers from the taught text, so no slide
 * could teach what an answer rests on without repeating it. Reserved stems go only to the kinds
 * that compose a stem or task (`STEM_KINDS`); a content, worked-example or copied-question slide
 * writes none, and the list was up to 700 characters of noise on each. Not done: a per-kind system
 * text. The system text is the same on every call, so the provider caches it; moving the shapes and
 * examples into the user turn would shrink the call but lose that cache, costing more per slide.
 *
 * v25 (25 Sept 2026, luna-direct DIAGNOSIS FM3): "asserted, not explained" was the commonest
 * explanation fault (29 whys in 57 decks, every cell), and no deck reached the 5 anchor ("an
 * example, and the misconception it heads off is named"). The content rule now orders the body as
 * a build-up: the claim in the heading, the reason it holds, then the example showing that reason.
 * The outline often puts the WATCH OUT callout on another slide (02f34f: the groyne watch-out on
 * the erosion slide), so a teaching slide without its own watch-out is told, by a code-built line
 * (`ownMisconceptions`), to name its objective's misconception in one closing sentence.
 *
 * v26 (TEACH-89, ADR 0032): `diagram` is generatable. A diagram slide's call carries a figure block
 * in the user turn (`figureBlock`, `./figures`): the template its `figureBrief` names, its values in
 * words, what the figure is for, and that the labels carry the numbers of the worked example or
 * question the slide covers. The system text is unchanged (it is at its word budget and cached),
 * so the pinned hash of the non-diagram sample did not move.
 *
 * v27 (TEACH-94): the figure block describes the `energy-profile` template's values, and its
 * numbers line is per template (`FIGURE_NUMBERS`): an energy profile's numbers are its two
 * energies, and its labels name the substances. The right-triangle block reads as before, and the
 * system text and the pinned hash are unchanged again.
 *
 * v29 (TEACH-253, ADR 0034 decision 5): a diagram slide whose fact carries the figure gets the
 * "shows" block instead (`figureShownBlock`): the figure's template and values, the unknown's value
 * left out, and a text-only answer shape. Diagram calls only, so the pinned hash is unchanged.
 *
 * look v26–v28 (26 Sept 2026, look uplift, `quality-prd/look/GENERATION-PROPOSAL.md` §1, §2, §5): shorter
 * bodies and a diagram instruction. The examples Greg approved carry 15–35 words per teaching slide
 * as a lead sentence plus a short card; ours ran 40–75 in one paragraph. The body is now ≤ 30 words
 * (≤ 45 with two key ideas), its first sentence the idea a pupil could copy down (the look renders
 * it as the lead, `look.ts` `leadAndCard`), the rest the reason and one example, everything else in
 * `notes`. Headings are unchanged (label vs claim is Greg's open decision) apart from the aim.
 * The shorter aims (`SLIDE_AIMS`) are advertised here only: `SPEC_LIMITS.heading/item/body` also
 * size the facts, worksheet blocks, planner briefs and evaluate evidence, so changing them would
 * reach eight other prompts; the slide schema keeps its ceilings and the fit engine catches the rest.
 * A content slide may carry `diagram`: a drawing instruction the editor shows beside the body. The
 * slide call decides it, not the planner: it is the call that writes the body the drawing sits
 * beside, and the diagram's labels have to be that body's words; a planner flag would need a new
 * fact field, outline plumbing and a second call's paraphrase (CORE 2026-08-04). The gate is a
 * two-sided test on the idea's shape (stages, cycle, parts, comparison, axis vs definition, reason,
 * event, judgement), because a slot in the sketch is otherwise filled every time (openai.md
 * 2026-09-23). Only the content shape has the field, so question, objectives and title slides
 * cannot carry one. "none" is a named value, so the empty case has a positive description, the
 * instruction opens with a closed type list, and code (`keptDiagram`) keeps only an instruction
 * that opens with one of those types: the type is the gate, checked structurally. Demo (look
 * GENERATION-RESULTS.md): with "a definition, reason, …" on the none side, 2 of 11 content slides
 * got a diagram and none of the three photosynthesis slides did (a rate slide wrote "none"). A
 * reason is usually drawable as cause → effect, and a method as steps or a bar model, so the none
 * side now lists only what no drawing shows, and "Bar model" joins the types. That gave 8 of 8
 * on a single-slide re-run, too eager: "can be drawn" is true of everything. The trigger is now
 * what the drawing shows that the words cannot (position, order, a changing value), and the none
 * side names a definition, a word equation or formula (the structure pass draws those as a key
 * card, `structure.ts` `inferStructure`) and a single claim with its reason. v27 demo: 1 of 19
 * content slides across six lessons (most teaching slides are a claim with its reason). v28 drops
 * that case and names the real over-fill instead, a drawing that "would only put the body's
 * sentences in boxes": 5 of 11 re-run slides (coasts 3/3, ratio 1/2, Romans 1/3, photosynthesis
 * 0/3), in the proposal's third-to-half range. v26–v28 share the look/generation branch only.
 *
 * look v29 (26 Sept 2026, look/headings; Greg: "still not good enough" beside the homepage examples):
 * the examples' teaching slides carry a 2–5-word label as the heading ("Limiting factors"), the
 * claim as the body's first sentence, and a set of parallel things as 2–4 bullets. The content
 * heading is now a label and the claim moves to the lead (≤ 20 words); a new optional `points`
 * (`@tj/slides` specs, 2–4 items) carries the parallel set, which `bodyWithPoints` lays under the
 * body and the look's `leadAndCard` puts under the lead. The gate for `points` names the shape of
 * the idea on one side ("a set of parallel things") and what follows the lead on the other, so the
 * slot is not filled everywhere (openai.md 2026-09-23). The label examples are from topics outside
 * the benched briefs. Counts live in the shape line only. The diagram none case adds "or points",
 * so a set already on the slide as bullets is not boxed again. Objectives, title and question
 * headings are unchanged.
 *
 * look v30 (same day, look GENERATION-RESULTS-3.md): v29's five lessons gave label headings (1–4 words)
 * but longer bodies (median 47 words against v28's 37) and `points` on 1 of 13 slides, duplicating
 * its lead. The shape line lost "≤ 30 words" and gained "then at most two short sentences", which
 * Luna read as room. v30 restores the 30-word body with the lead ≤ 20 inside it. The `points` gate
 * "a set of parallel things" gave 0 of 13 on a re-run: every idea reads as a claim. It is now a
 * test on the text, "the lead names three or more things of one kind", with the body then the lead
 * alone (no duplicate list), and each point says a few words on its thing, not a bare noun.
 *
 * look v31 (26 Sept 2026, look/shape-prompt, `quality-prd/look/GENERATION-RESULTS-4.md`): the writer
 * no longer decides a content slide's shape or drawing. The plan's teach call (v4) tags each key
 * idea with a `shape` and an optional `visual`; the slide line names this slide's shape and only
 * that shape's fields, their word budgets read from `CONTENT_BUDGETS` (`@tj/slides`, measured per
 * composition), and code keeps only those fields and sets `diagram` from the plan
 * (`withPlannedShape`). The v30 `points` gate and the v28 diagram gate leave the system text; the
 * diagram types stay here for `keptDiagram`. A slide with two key ideas is an explain slide. A
 * vocabulary term on a content slide is shown with its definition in the side panel
 * (`structure.ts` glossary), so the body uses the term without defining it (Tempest 04 and
 * photosynthesis 08 said the definition twice).
 *
 * look v32 (26 Sept 2026, look/shape-fixes, `quality-prd/look/GENERATION-RESULTS-5.md` rounds 1–2,
 * not benched): larger re-measured word budgets in the shape line. Superseded the same day by v33.
 *
 * look v33 (same day, Greg's direction after E49 lost 5–15 to master, 12 losses "telegraphic fragments,
 * too thin to teach from"): the writer is back to master's v25 behaviour, a body that builds the
 * idea up in full sentences (how or why it holds, then the example, any analogy), with v29's label
 * heading and `points` only where the plan says the idea is a list. The per-slot word budgets leave
 * the prompt: one soft target in the content sketch ("about 40–60 words: one idea, explained, with
 * an example") and the schema's ceiling (`SPEC_LIMITS.body`) in the limits block. The shape line is
 * a layout hint naming the fields and what each holds, in full sentences, with the schema's counts
 * and no word caps; "Fill exactly these content fields" is gone. Splitting is the planner's job
 * (plan-teach-objective v6: one idea a slide) and fitting the renderer's (`CONTENT_BUDGETS` stays
 * as its capacity data, for the fallback, not the writer). The misconception sentence is v25's.
 *
 * look v34 (27 Sept 2026, look/image-plan, `quality-prd/look/GENERATION-RESULTS-8.md`): a content slide
 * with a planned photograph (its entry's `imageBrief`) or drawing (the plan's `visual`) keeps the
 * right half for it, and the writer still wrote for the full width: the image-slot run gave 2–9
 * "(continued)" slides a lesson (rivers 9 of 19). The slide line now says what sits beside it and
 * gives the half-column target, read from the renderer's measured panel budgets
 * (`COMPOSITION_BUDGETS[shape].panel`, `@tj/slides`; `budgetFor` returns the full budget for an
 * explain, which takes a key-term panel only when it fits, but a slot is always there): an explain
 * body of lead + body words (about 30–45), a list's lead and 2–3 "Label: short sentence" points of
 * the panel's point length. It still asks for one idea explained with its example in full
 * sentences, saying less rather than writing fragments (E49: 3–4-word points lost to real
 * sentences). A slotted slide shows no glossary panel (`structure.ts` `structureDiagram`), so its
 * vocabulary is defined in a few words or in `notes`, not left to the panel. Full-width slides and
 * the system text are unchanged; repair gets the same line through `plannedShapeOf`/`shapeLine`.
 * Probe (8 photo slides, generate-slide only): lists 22–34 words (v33 45–77), 7 of 8 draws inside
 * the panel budget; explains 37–50 (v33 48–66). "No more (the column holds 45)" beat "about";
 * splitting the cap into lead + rest made bodies longer (median 47.5 against 44.5).
 *
 * v30 (27 Sept 2026, look/pr2-generation; numbered v35 on look/slides-pr): master's v26–v29 (the diagram kind's figure
 * and shows blocks, above)
 * and the look branch's v26–v34 (also above, numbered on that branch before it met master) together.
 * They touch different parts: the figure block is a diagram slide's user turn, the look entries
 * are the content slide's shape line and the system text. A content slide whose planned `visual`
 * one of the Figure templates draws is planned as a `diagram` slide instead (`outline-from-facts`
 * `figureBriefOf`), so a slide gets either a figure block or a drawing instruction, never both.
 */

/** The drawing types a `diagram` instruction opens with; anything else is dropped (`keptDiagram`). */
export const DIAGRAM_TYPES = [
  "Sequence",
  "Cycle",
  "Parts",
  "Comparison",
  "Bar model",
  "Graph",
  "Number line",
] as const;

const DIAGRAM_OPENING = new RegExp(`^(${DIAGRAM_TYPES.join("|")})\\s*:\\s*\\S`, "i");

/**
 * v26: a content spec keeps its `diagram` only when it opens with a listed type ("Cycle: …"); "none",
 * "None" and any untyped text are removed, so the editor never shows "Diagram to add: none".
 */
export function keptDiagram<T extends { kind: string; diagram?: string | undefined }>(spec: T): T {
  if (spec.kind !== "content" || spec.diagram === undefined) return spec;
  if (DIAGRAM_OPENING.test(spec.diagram.trim())) return { ...spec, diagram: spec.diagram.trim() };
  const { diagram: _dropped, ...rest } = spec;
  return rest as T;
}

/**
 * The one-line aims the slide writer is shown for heading, list item and body (look proposal §1).
 * Below `SPEC_LIMITS` on purpose: those also size facts and worksheets. Aims, not walls: the schema
 * still accepts up to `ceilingOf(SPEC_LIMITS.*)`.
 */
export const SLIDE_AIMS = { heading: 60, item: 110 } as const;

export type GenerateSlideInput = {
  /**
   * The facts this slide draws on: only those its entry's `factRefs` name, plus every
   * misconception and the pitch (`factsBlock` renders it). Never the whole lesson.
   */
  referenced: LessonFacts;
  entry: OutlineEntry;
  /** The lesson's objective verb and the class's prior confidence (`lessonShapeOf`, TEACH-230). */
  shape: WritingShape;
  /** 1-based position and the total, for the model's sense of pacing. */
  position: { index: number; total: number };
  /** The `adds` line of the neighbouring entries, so this slide does not repeat them. */
  neighbours: { previous?: string | undefined; next?: string | undefined };
  /** Stems assigned to other slides or to the worksheet; never used here. */
  reservedStems: string[];
  phase?: LessonPhase | undefined;
  /**
   * For an `image-text` entry (TEACH-220): what the chosen photograph shows, so the text is written
   * to it — or `"none"` when no photograph passed the gate, so the text mentions no picture.
   */
  photo?: SlidePhoto | "none" | undefined;
  audience: Audience;
  /**
   * Lab only (r3, `laterQuestionsFor`): on a teaching slide, the questions later in the lesson that
   * test its key ideas, stem and answer, read-only; at most 4, shortest first. Absent in
   * production and when no later slide asks about this slide's key ideas.
   */
  laterQuestions?: { stem: string; answer: string }[] | undefined;
  /**
   * For a `diagram` entry whose fact carries the figure (TEACH-253, `figureOfEntry`): the figure
   * the slide shows, so the call writes the text around it and not the values.
   */
  figure?: FigureRef | undefined;
  /** How many vocabulary entries the theme's grid shows (`vocabularySlots`). */
  vocabularySlots: number;
  lessonTitle: string;
};

export type SlidePhoto = {
  alt: string;
  /** The brief's `mustShow` items the judge could see in the photo. */
  visible: string[];
  /** The brief's `mustShow` items it could not. */
  notVisible: string[];
  count: "one" | "several";
  purpose: ImagePurpose;
};

/** The evidence block an `image-text` slide's writer (Generate or Repair) is given. */
export function photoBlock(photo: SlidePhoto | "none"): string[] {
  if (photo === "none") {
    return ["There is no photograph on this slide: write it as plain content."];
  }
  return [
    `The photograph on this slide shows: ${photo.alt || "(no caption)"} (${photo.count === "one" ? "one" : "several"}).`,
    `Visible: ${photo.visible.length > 0 ? photo.visible.join("; ") : "(none of the required items)"}`,
    `Not visible: ${photo.notVisible.length > 0 ? photo.notVisible.join("; ") : "(nothing missing)"}`,
    `Purpose: ${photo.purpose}`,
  ];
}

/** The rule the writer follows for an `image-text` slide; shared with Repair. */
export const IMAGE_TEXT_RULE =
  "An `image-text` slide is written to its photograph. Say 'the photograph' (singular when there is one). A task — spot, find, count, point to, look for, identify, circle, label — may name only items listed as visible. Describe only what the caption and the visible list say is there; never name a kind of animal, plant, object or place the caption does not name. If the purpose is identify-parts and something required is not visible, describe what is there and tell the teacher in `notes` what the picture cannot show. If there is no photograph, do not mention a picture at all.";

/** What the plan says a content slide sets out (`plannedShapeOf`). */
export type PlannedShape = {
  shape: ContentShape;
  ideas: number;
  visual?: string | undefined;
  /** v34: what takes the right half beside the words (an explain or a list only). */
  beside?: "photograph" | "diagram" | undefined;
};

/** v34: the shapes that keep the right half for a slot; compare and sequence drop it. */
const SLOTTED: ReadonlySet<ContentShape> = new Set(["explain", "list"]);

const isContentShape = (value: unknown): value is ContentShape =>
  (CONTENT_SHAPES as readonly unknown[]).includes(value);

/**
 * v31: a content slide's shape and drawing, from the key ideas it covers. One key idea: its own
 * shape. Two: explain, one paragraph each. The drawing is the first `visual` among them.
 * Undefined for every other kind, and when no key idea it covers carries a shape: the legacy
 * planner (the production default) and facts planned before shapes plan none, so nothing is cut
 * from what the writer gives and the renderer infers the layout as before.
 */
export function plannedShapeOf(
  referenced: LessonFacts,
  entry: OutlineEntry,
): PlannedShape | undefined {
  if (entry.kind !== "content") return undefined;
  const ideas = (referenced.keyIdeas ?? []).filter((k) => entry.factRefs.includes(k.id));
  if (!ideas.some((k) => isContentShape(k.shape))) return undefined;
  const own = ideas[0]?.shape;
  const visual = ideas.find((k) => k.visual)?.visual;
  const shape = ideas.length === 1 && isContentShape(own) ? own : "explain";
  const beside = visual ? "diagram" : entry.imageBrief ? "photograph" : undefined;
  return {
    shape,
    ideas: ideas.length,
    ...(visual ? { visual } : {}),
    ...(beside && SLOTTED.has(shape) ? { beside } : {}),
  };
}

/** The field each shape adds to the lead; explain adds none. */
const SHAPE_FIELD = {
  explain: undefined,
  list: "points",
  compare: "compare",
  sequence: "steps",
} as const;
const SHAPE_FIELDS = ["points", "compare", "steps"] as const;

/**
 * v33: the slide line naming this content slide's layout and what each of its fields holds, in
 * full sentences. No word caps: the content sketch carries the one soft target and the schema the
 * ceiling; the counts are the schema's (`specs.ts` content `points`, `compare`, `steps`).
 */
export function shapeLine(planned: PlannedShape): string {
  if (planned.beside) return besideLine(planned.shape, planned.beside);
  const fields = (() => {
    switch (planned.shape) {
      case "list":
        return `"body" is one sentence introducing the set; "points" holds its members, 2–4 strings, each "Label: one full sentence" saying what that member does or why it matters ("Shield volcano: Runny lava flows a long way, building wide, gentle slopes."), or a plain sentence where that reads better.`;
      case "compare":
        return `"body" is one sentence on what the two differ in; "compare" is { "left": { "label", "points" }, "right": the same }, each side's "points" 2–3 full sentences: how that thing works, then an example of it (a quotation, case or number from the facts).`;
      case "sequence":
        return `"body" is one sentence on what the process does; "steps" holds 2–4 full sentences in order, each saying what happens and what it leads to (in a calculation, the working with its numbers).`;
      default:
        return `"body" carries the whole explanation.`;
    }
  })();
  return `Layout: ${planned.shape}. ${fields}`;
}

/**
 * v34: the slide line for an explain or a list beside a photograph or diagram, its word targets
 * the renderer's half-column budget (`COMPOSITION_BUDGETS[shape].panel`). An explain's range runs
 * from two thirds of lead + body up to it (32 + 13: about 30–45).
 */
function besideLine(shape: ContentShape, beside: "photograph" | "diagram"): string {
  const panel = COMPOSITION_BUDGETS[shape].panel;
  if (!panel) throw new Error(`generate-slide: no half-column budget for "${shape}"`);
  const opening = `A ${beside} takes the right half of this slide, so the words sit in the left half: write for that half, not the 40–60 words of a full-width slide.`;
  const closing =
    "Still one idea explained with its example, in full sentences: say less rather than write fragments, and put the rest in `notes`.";
  if (shape === "list" && panel.points) {
    const [min, max] = panel.points.count ?? [2, 3];
    return `Layout: list. ${opening} "body" is one sentence introducing the set, up to ${panel.lead.max} words; "points" holds its members, ${min}–${max} strings, each "Label: short sentence" of up to ${panel.points.max} words in all ("Shield volcano: runny lava spreads far."). ${closing}`;
  }
  const most = panel.lead.max + (panel.body?.max ?? 0);
  const least = Math.round((most * 2) / 3 / 5) * 5;
  return `Layout: explain. ${opening} "body" carries the whole explanation in ${least}–${most} words, no more (the column holds ${most}), its opening sentence up to ${panel.lead.max} words. ${closing}`;
}

/**
 * v31: a content spec cut to its planned shape: the other shapes' fields removed, `diagram` the
 * plan's visual (typed, `keptDiagram`) or none. `filled` says whether the writer gave the shape's
 * own field; `extra` names the fields it added that the shape does not have.
 */
export function withPlannedShape<T extends { kind: string }>(
  spec: T,
  planned: PlannedShape | undefined,
): { spec: T; filled: boolean; extra: string[] } {
  if (spec.kind !== "content" || planned === undefined) return { spec, filled: true, extra: [] };
  const own = SHAPE_FIELD[planned.shape];
  const record = spec as Record<string, unknown>;
  const extra = SHAPE_FIELDS.filter((f) => f !== own && record[f] !== undefined);
  const dropped = new Set<string>(["diagram", ...SHAPE_FIELDS.filter((f) => f !== own)]);
  const kept = Object.fromEntries(Object.entries(record).filter(([key]) => !dropped.has(key)));
  const withVisual = keptDiagram({
    ...kept,
    ...(planned.visual ? { diagram: planned.visual } : {}),
  } as unknown as T & { diagram?: string });
  return { spec: withVisual as T, filled: own === undefined || record[own] !== undefined, extra };
}

const SHAPES = {
  title: '{ "kind": "title", "title", "subtitle", "factRefs", "notes"? }',
  objectives: '{ "kind": "objectives", "items": [1–4 strings], "factRefs", "notes"? }',
  starter:
    '{ "kind": "starter", "heading"?, "items": [1–3 strings], "footnote"?, "factRefs", "notes"? }',
  vocabulary:
    '{ "kind": "vocabulary", "entries": [{ "term", "definition" }] (1–slots), "factRefs", "notes"? }',
  content:
    '{ "kind": "content", "heading", "body", then "points" [strings], "compare": { "left": { "label", "points" }, "right": { "label", "points" } } or "steps" [strings] as the slide line says (about 40–60 words on the slide in all: one idea, explained, with an example), "callout"?: { "kind", "text" }, "factRefs", "notes"? }',
  "image-text":
    '{ "kind": "image-text", "heading", "body" (≤ 30 words), "callout"?: { "kind", "text" }, "factRefs", "notes"? }',
  "worked-example":
    '{ "kind": "worked-example", "heading"?, "question" (one or two lines), "steps": [1–4 strings, each one short line of about 56 characters], "callout"?: { "kind", "text" }, "factRefs", "notes"? }',
  instructions:
    '{ "kind": "instructions", "heading"?, "steps": [1–4 strings], "footnote"?, "factRefs", "notes"? }',
  discussion: '{ "kind": "discussion", "prompt", "footnote"?, "factRefs", "notes"? }',
  "true-false":
    '{ "kind": "true-false", "statement", "correct": boolean, "explanation"?, "factRefs", "notes"? }',
  "multiple-choice":
    '{ "kind": "multiple-choice", "stem", "options": [exactly 4 { "text", "correct" }, exactly one correct], "explanation"?, "factRefs", "notes"? }',
  matching:
    '{ "kind": "matching", "stem", "pairs": [exactly 3 { "left", "right" }], "factRefs", "notes"? }',
  "fill-gap":
    '{ "kind": "fill-gap", "stem", "sentence" (with one ___ per answer), "answers": [1–3 strings], "factRefs", "notes"? }',
  sort: '{ "kind": "sort", "stem", "steps": [exactly 4 strings in the correct order], "factRefs", "notes"? }',
  "open-response": '{ "kind": "open-response", "stem", "modelAnswer"?, "factRefs", "notes"? }',
  "exit-ticket":
    '{ "kind": "exit-ticket", "heading"?, "items": [exactly 3 strings], "footnote"?, "factRefs", "notes"? }',
  plenary: '{ "kind": "plenary", "heading"?, "items": [1–3 strings], "factRefs", "notes"? }',
} as const;

/**
 * v26: the JSON shape Generate asks for on this kind, for Repair's user turn, so a repaired slide
 * keeps the body's word aim and the `diagram` field (the look demo's repairs rewrote 30-word bodies
 * to 60–87 words and dropped every diagram when the shape was only "a content slide spec").
 */
export function slideShapeOf(kind: string): string | undefined {
  return (SHAPES as Record<string, string>)[kind];
}

/** The kinds that compose a stem, prompt or task of their own, so the reserved stems apply. */
const STEM_KINDS: ReadonlySet<string> = new Set([
  "starter",
  "instructions",
  "discussion",
  "matching",
  "fill-gap",
  "sort",
  "exit-ticket",
  "plenary",
]);

/**
 * v25: the misconceptions a teaching slide names itself. A `content` or `image-text` slide whose
 * key ideas share an objective with a misconception names it in the body, unless this slide's own
 * watch-out callout carries it. Code decides, so the line is bare (CORE 2026-09-22: an exception
 * on a packet line is decided in code). Empty for every other slide, which keeps their text as v24.
 */
export function ownMisconceptions(input: GenerateSlideInput): string[] {
  if (input.entry.kind !== "content" && input.entry.kind !== "image-text") return [];
  if (input.entry.callout?.kind === "watch-out") return [];
  const objectives = new Set(
    (input.referenced.keyIdeas ?? [])
      .filter((k) => input.entry.factRefs.includes(k.id))
      .flatMap((k) => k.objectiveRefs ?? []),
  );
  return input.referenced.misconceptions
    .filter((m) => (m.objectiveRefs ?? []).some((o) => objectives.has(o)))
    .map((m) => m.id);
}

export const generateSlidePrompt = {
  version: "generate-slide.v30",
  system: [
    "You write one slide of a classroom lesson from the lesson's facts.",
    "",
    "Rules:",
    HOUSE_RULES,
    "Write what the slide line says this slide adds, from the facts it names; do not repeat its neighbours.",
    'Follow the supplied objective verb. A content slide\'s `heading` is a label naming the idea ("The water cycle", "Types of volcano"). Its body opens with the idea in a sentence a pupil could copy down, then builds it up in full sentences: how or why it holds, then the example showing it, and any useful analogy, so a teacher can teach from the slide alone. The slide line may name a layout (list, compare, sequence) and the fields it uses; they hold the same full sentences. With two key ideas, teach both: the heading names what joins them, the body is two short paragraphs, one per idea. Question slides use the supplied question, answer and distractors verbatim.',
    'When an `instructions` slide\'s facts include questions, it is shared practise: `heading` "Your turn"; each step is one of those questions\' stems verbatim, in the order this slide\'s facts name them, with no number (the layout numbers them). `notes` gives each answer on its own line ("1. <answer>"), then the misconception to watch for. `footnote` may say how pupils answer (mini-whiteboards or books).',
    "For a `worked-example`, merge neighbouring steps into at most four short lines; keep the conclusion, never drop it. Put fuller working in `notes`.",
    "`notes`: what to say, the misconception in words rather than ids, and a question whose answer is not already on the slide.",
    "`footnote` is one short line pupils read — how long they have, where to write, what to do when finished. Anything addressed to the teacher goes in `notes`; leave `footnote` out rather than fill it.",
    IMAGE_TEXT_RULE,
    limitsBlock({
      title: SPEC_LIMITS.title,
      "heading/subtitle": SLIDE_AIMS.heading,
      "each item": SLIDE_AIMS.item,
      "worked-example question": SPEC_LIMITS.question,
      "each worked-example step": SPEC_LIMITS.step,
      body: SPEC_LIMITS.body,
      stem: SPEC_LIMITS.stem,
      option: SPEC_LIMITS.option,
      term: SPEC_LIMITS.term,
      definition: SPEC_LIMITS.definition,
      footnote: SPEC_LIMITS.footnote,
      answer: SPEC_LIMITS.answer,
      "callout text": SPEC_LIMITS.callout,
      notes: SPEC_LIMITS.notes,
    }),
    "",
    "The JSON shape per kind (`callout`, where shown, only when the slide line assigns one):",
    ...Object.entries(SHAPES).map(([kind, shape]) => `- ${kind}: ${shape}`),
    "",
    "Example for a true-false slide:",
    example({
      kind: "true-false",
      statement: "Particles in a gas are close together.",
      correct: false,
      explanation: "Gas particles are far apart and move freely.",
      factRefs: ["q1", "o1"],
      notes:
        "Ask for a show of hands before revealing. Watch for pupils who imagine a gas as a crowd of particles pressed together. Ask: What would happen to the balloon if the particles inside were as close as in a liquid?",
    }),
    "",
    "Example for a worked-example slide: five source steps compressed into four short lines, retaining the conclusion.",
    "Source working: Split 84 into 80 and 4. Divide 80 by 4 to get 20. Divide 4 by 4 to get 1. Add 20 and 1 to get 21. Conclude that 84 divided by 4 is 21.",
    example({
      kind: "worked-example",
      heading: "Divide by partitioning",
      question: "What is 84 ÷ 4?",
      steps: ["84 = 80 + 4.", "80 ÷ 4 = 20; 4 ÷ 4 = 1.", "20 + 1 = 21.", "So 84 ÷ 4 = 21."],
      factRefs: ["x1", "o2"],
      notes:
        "Reveal each line after pupils predict it. Check they divide both parts, not just 80. Ask: How could you check using multiplication?",
    }),
    "",
    "Example for a fill-gap slide (one three-underscore marker, even inside a word):",
    example({
      kind: "fill-gap",
      stem: "Complete the word shell.",
      sentence: "___ell",
      answers: ["sh"],
      factRefs: ["q1", "o1"],
    }),
  ].join("\n"),
  user(input: GenerateSlideInput): string {
    const parts = [
      `Lesson: ${input.lessonTitle}`,
      audienceBlock(input.audience),
      verbBlock(input.shape),
      "",
      factsBlock(input.referenced),
      "",
      `Slide ${input.position.index} of ${input.position.total}: kind "${input.entry.kind}"${input.phase ? `, ${input.phase} phase` : ""}, covering facts ${input.entry.factRefs.join(", ") || "(none named)"}.`,
    ];
    if (input.entry.brief) {
      parts.push(`This slide adds: ${input.entry.brief.adds}`);
      if (input.entry.brief.avoids) parts.push(`It must not: ${input.entry.brief.avoids}`);
    }
    if (input.neighbours.previous)
      parts.push(`The slide before adds: ${input.neighbours.previous}`);
    if (input.neighbours.next) parts.push(`The slide after adds: ${input.neighbours.next}`);
    if (input.entry.callout) {
      const { kind, factRefs } = input.entry.callout;
      parts.push(
        `This slide carries a "${kind}" callout: set \`callout\` to kind "${kind}" with \`text\` one line for pupils, from ${factRefs.join(", ")} only.`,
      );
    }
    const planned = plannedShapeOf(input.referenced, input.entry);
    if (planned) parts.push(shapeLine(planned));
    const misconceptions = planned && planned.shape !== "explain" ? [] : ownMisconceptions(input);
    if (misconceptions.length > 0) {
      parts.push(
        `Its misconception (${misconceptions.join(", ")}): end the body with one sentence on what some pupils think and why it is wrong.`,
      );
    }
    if (input.photo !== undefined) parts.push(...photoBlock(input.photo));
    if (input.entry.kind === "diagram" && input.figure) {
      parts.push(...figureShownBlock(input.figure));
    } else if (input.entry.kind === "diagram" && input.entry.figureBrief) {
      parts.push(...figureBlock(input.entry.figureBrief));
    }
    if (input.entry.kind === "vocabulary") {
      parts.push(
        `This theme shows at most ${input.vocabularySlots} vocabulary entries. When there are more terms than that, keep every term another shown definition uses, then the terms the objectives name; put the rest in \`notes\` with their definitions.`,
      );
    }
    if (
      input.entry.kind === "content" &&
      !planned?.beside &&
      input.referenced.vocabulary.length > 0
    ) {
      parts.push(
        "The side panel shows a vocabulary term's definition beside the body: use the term without defining it.",
      );
    } else if (input.entry.kind !== "vocabulary" && input.referenced.vocabulary.length > 0) {
      parts.push(
        "Define each vocabulary term in a few words where the slide first uses it, or in `notes` if that will not fit.",
      );
    }
    if (input.reservedStems.length > 0 && STEM_KINDS.has(input.entry.kind)) {
      parts.push("", "Reserved for other slides or the worksheet — do not use these stems:");
      for (const stem of input.reservedStems) parts.push(`  - ${stem}`);
    }
    if (input.laterQuestions?.length) {
      parts.push("", "Asked of pupils later in the lesson, on later slides (shown for reference):");
      for (const q of input.laterQuestions) parts.push(`  - ${q.stem} — answer: ${q.answer}`);
      parts.push(
        "Teach here, within this slide's limits, what each answer rests on — the name, quotation, reason, example or step a pupil needs — without naming these questions.",
      );
    }
    parts.push("", `Answer with the JSON for a "${input.entry.kind}" slide.`);
    return parts.join("\n");
  },
} as const;
