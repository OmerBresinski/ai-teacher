import { asksForUnlistedOptions } from "@tj/domain/documents";
import { CALLOUT_NAMES, fitsPlanned, materialiseSlide, paletteForm } from "@tj/slides";
import type { DesignSlot, SlotForm } from "../prompts/design-cycle";
import { type SlotRender, slotRender } from "./coded-slides";

/*
 * The fit gate and the fallback order for one designer slot (the lesson designer plan, "Fit
 * guarantees and fallback order"; TEACH-208). A slot is planned with headroom: it must fit with
 * every text at its own size on all 10 themes (`fitsPlanned`, stepDown 0). A slot that does not
 * goes down the ladder, whole units only, each rung logged:
 *   1. another variant of the same form;
 *   2. a sibling form that holds the same units, converted in code;
 *   3. whole units (a callout, the last sentence, the last step, an explanation) moved to the
 *      notes, word for word;
 *   4. one re-fill of the slot into the next form down (the caller's single small design-cycle
 *      call; never "shorter");
 *      Then, when neither landed, rung 2's siblings go down rungs 2-3 themselves (4c);
 *   5. one type step down (the save gate's headroom), then a flag.
 * No rung splits a slide or asks a model to shorten; the count was fixed at allocation.
 */

export type Rung = "fits" | "variant" | "sibling" | "notes" | "refill" | "step-down" | "flagged";

export type RungLog = { rung: Rung; form: SlotForm; ok: boolean; detail?: string };

export type SlotFit = {
  slot: DesignSlot;
  render: SlotRender;
  /** The rung that landed the slot. */
  rung: Rung;
  /** Every rung tried, in order (the fit block's `rungs`). */
  tried: RungLog[];
  /** Set when flagged: why the slot fails the save gate (`flagReason`). */
  reason?: string;
};

export type SlotFitOptions = {
  seed: string;
  themeId: string;
  factRefs?: string[];
  /**
   * Rung 4: one design-cycle call for this slot in `form`, shown the slot it replaces and why it
   * did not fit (`refillReason`). Absent: the rung is skipped.
   */
  refill?: (slot: DesignSlot, form: SlotForm, reason: string) => Promise<DesignSlot | undefined>;
  /**
   * Designer r6 (Greg, 30 Sep: fit everything within the slide, never rely on the notes): `false`
   * takes teaching content off rung 3 and rung 4c — only teacher-only asides (a discussion's
   * footnote, a check's "Why?" reason) may go to the notes. A slot that does not fit goes to a
   * sibling form that holds its units, then the re-fill. Default `true` (the r5 ladder).
   */
  teachingToNotes?: boolean;
};

/** Units rung 3 may move under `teachingToNotes: false`: what the teacher says, not what is taught. */
export const ASIDE_UNITS: ReadonlySet<string> = new Set(["footnote", "explanation"]);

/**
 * Rung 3 with teaching content kept on the slide (r6): only the asides of `unitsToNotes` — a
 * discussion's footnote and a hinge's "Why?" reason — each applied on its own to the slot as
 * written, never after a teaching unit has moved.
 */
export function asidesToNotes(slot: DesignSlot): { slot: DesignSlot; moved: string }[] {
  const out: { slot: DesignSlot; moved: string }[] = [];
  if (slot.form === "discussion" && slot.footnote) {
    const { footnote, ...rest } = slot;
    out.push({
      slot: { ...rest, notes: [slot.notes, footnote].filter(Boolean).join("\n") } as DesignSlot,
      moved: "footnote",
    });
  }
  if (slot.form === "hinge") {
    const moved = unitsToNotes(slot).find((u) => u.moved === "explanation");
    if (moved) out.push(moved);
  }
  return out;
}

type ToNotes = (slot: DesignSlot) => { slot: DesignSlot; moved: string }[];

const META = { promptVersion: "fit", model: "fit", at: "1970-01-01T00:00:00.000Z" };

/**
 * Whether a laid-out slot fits every theme at `stepDown`, and, for a form with a named part (the
 * callout card, a compare card), still places it in the lesson's theme: a variant that drops the
 * callout has not fitted it.
 */
export function slotFits(render: SlotRender, themeId: string, stepDown: 0 | 1): boolean {
  if (namesOtherForm(render.form, askedText(render.spec)) !== undefined) return false;
  const planned = fitsPlanned(render.spec, {
    stepDown,
    ...(render.variant ? { variant: render.variant } : {}),
    structure: render.structure,
  });
  if (!planned.ok) return false;
  const placed = placedName(render);
  if (!placed) return true;
  const slide = materialiseSlide(
    render.spec,
    themeId,
    META,
    undefined,
    render.variant,
    render.structure,
  );
  return slide.elements.some((e) => e.name === placed);
}

/** What a check slide asks, as printed: its stem, statement or prompt. */
function askedText(spec: SlotRender["spec"]): string | undefined {
  const s = spec as { stem?: unknown; statement?: unknown; prompt?: unknown };
  const text = s.stem ?? s.statement ?? s.prompt;
  return typeof text === "string" ? text : undefined;
}

/** The words that name a way of answering, and the forms that answer that way. */
const FORM_NAMES: readonly { names: RegExp; forms: readonly SlotForm[] }[] = [
  { names: /\btrue\s+or\s+false\b|\bfalse\s+or\s+true\b/i, forms: ["true-false"] },
  {
    names:
      /\b(choose|select|pick|tick|circle)\b[^.?!]*\b(options?|letters?)\b|\bfrom the (options|choices)\b|\bwhich (option|letter)\b/i,
    forms: ["hinge"],
  },
  { names: /\bfill\s+(in\s+)?the\s+(gaps?|blanks?)\b/i, forms: ["fill-gap"] },
  { names: /\bmatch\s+(each|the|these)\b/i, forms: ["matching"] },
  { names: /\b(sort|put)\s+(these|the|each)\b[^.?!]*\b(order|groups?)\b/i, forms: ["sort"] },
];

/**
 * The form a slot's question names when that is not the slot's own form: an open question that
 * reads "True or false? ..." (r6 smoke, y9-weimar: a hinge re-filled as true-false landed as an
 * open response still asking "True or false?"). Such a slot never passes the gate, on any rung.
 */
export function namesOtherForm(form: SlotForm, asked: string | undefined): SlotForm | undefined {
  if (!asked) return undefined;
  for (const { names, forms } of FORM_NAMES) {
    if (names.test(asked) && !forms.includes(form)) return forms[0];
  }
  return undefined;
}

function placedName(render: SlotRender): string | undefined {
  if (render.spec.kind === "content" && render.spec.callout) return CALLOUT_NAMES.card;
  const r = paletteForm(render.form).renderer;
  return r.on === "slide" && render.form !== "explain-callout" ? r.placed : undefined;
}

/** Rung 1: the other variants a form's kind offers that keep all of its parts. */
function variantsOf(render: SlotRender): string[] {
  if (render.spec.kind === "content") {
    const all = render.spec.callout
      ? ["callout-row", "headed", "two-column"]
      : ["headed", "two-column"];
    return all.filter((v) => v !== (render.variant ?? "headed"));
  }
  if (render.spec.kind === "diagram")
    return ["figure-left", "figure-wide"].filter((v) => v !== render.variant);
  return [];
}

const sentences = (text: string): string[] =>
  (text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [text]).map((s) => s.trim()).filter(Boolean);

/**
 * Rung 2: the sibling forms that hold the same units, converted in code, nearest first. A sibling
 * must be a whole, valid slide of its own form, every word of the original kept on the slide or in
 * the notes, and a check stays a check. Pairs that cannot be converted in structure alone have no
 * sibling and go on to the re-fill (rung 4), which writes the new form (designer eval r1: a hinge
 * turned open response kept "Which statement best…" with no options on the slide and notes naming
 * "Option B"):
 *  - hinge: its stem asks to choose between options; an option alone is a phrase, not a statement
 *    to judge true or false. None here: the re-fill writes the next form down, and only when that
 *    fails is it asked open (`hingeAsked`).
 *  - fill-gap (the gapped sentence is the question), sort (a sequence prints the answer order) and
 *    matching (a vocabulary slide shows the matched pairs, and a check becomes teaching): none.
 *  - explain: a list only when the body is exactly a lead and two sentences (nothing left over);
 *    never a sequence (sentences of an explanation are not ordered steps).
 *  - list: never a sequence (points carry no order).
 *  - explain-callout -> explain (the callout joins the body), sequence of 2 -> list, compare ->
 *    list (one point per side), worked example -> sequence (the question is its body, the working
 *    its steps), true-false -> open response (the statement asked as true or false, the verdict
 *    and its reason the model answer).
 */
/**
 * What the notes of a slot talk about that only its own form has on the slide (designer eval r2:
 * notes "using the four labels as prompts" on a slide with no labels). A sentence naming one of
 * these is left behind when code converts the slot to another form; the rest carry over.
 */
const FORM_PARTS: Partial<Record<SlotForm, RegExp>> = {
  hinge:
    /\b(options?|choose|choices?|distractors?|reveal|(?:option|answer) [A-D])\b|\b[A-D]\)|\(\s*[A-D]\s*\)/i,
  "true-false": /\b(true or false|true\/false|reveal|cards?)\b/i,
  "explain-callout": /\b(callout|watch[- ]out|card)\b/i,
  compare: /\b(columns?|sides?|cards?)\b/i,
  sequence: /\b(steps?|arrows?|cards?|stages? in order)\b/i,
  sort: /\b(order|cards?|labels?|sort)\b/i,
  matching: /\b(match|pairs?|columns?)\b/i,
  "worked-example": /\b(working card|card)\b/i,
};

/** The notes carried to `into` from `from`: the sentences that do not name `from`'s own parts. */
export function notesAcross(
  notes: string | undefined,
  from: SlotForm,
  into: SlotForm,
): string | undefined {
  if (!notes || from === into) return notes;
  const parts = FORM_PARTS[from];
  if (!parts) return notes;
  const kept = notes
    .split("\n")
    .map((line) =>
      sentences(line)
        .filter((sentence) => !parts.test(sentence))
        .join(" "),
    )
    .filter((line) => line.trim() !== "")
    .join("\n");
  return kept || undefined;
}

export function siblingsOf(slot: DesignSlot): DesignSlot[] {
  const withNotes = <T extends DesignSlot>(s: T): T => {
    const notes = notesAcross(slot.notes, slot.form, s.form);
    return notes ? { ...s, notes } : s;
  };
  switch (slot.form) {
    case "explain": {
      const [lead, ...rest] = sentences(slot.body);
      if (!lead || rest.length !== 2) return [];
      return [withNotes({ form: "list", heading: slot.heading, body: lead, points: rest })];
    }
    case "explain-callout":
      return [
        withNotes({
          form: "explain",
          heading: slot.heading,
          body: `${slot.body} ${slot.callout.text}`.trim(),
        }),
      ];
    case "sequence":
      return slot.steps.length === 2
        ? [withNotes({ form: "list", heading: slot.heading, body: slot.body, points: slot.steps })]
        : [];
    case "compare":
      return [
        withNotes({
          form: "list",
          heading: slot.heading,
          body: slot.body,
          points: [
            `${slot.compare.left.label}: ${slot.compare.left.points.join("; ")}`,
            `${slot.compare.right.label}: ${slot.compare.right.points.join("; ")}`,
          ],
        }),
      ];
    case "worked-example":
      return slot.steps.length >= 2
        ? [
            withNotes({
              form: "sequence",
              heading: slot.heading,
              body: slot.question,
              steps: slot.steps,
            }),
          ]
        : [];
    case "true-false":
      // Asked open in the open response's own shape: the statement to explain, never "True or
      // false?" over a writing space (`namesOtherForm`); the reason is the model answer.
      return [
        withNotes({
          form: "open-response",
          stem: slot.correct
            ? `Explain why this is right: ${slot.statement}`
            : `Explain what is wrong with this claim: ${slot.statement}`,
          modelAnswer: slot.explanation,
        }),
      ];
    default:
      return [];
  }
}

/**
 * A hinge asked open, the fallback after its re-fill (eval r2: a hinge whose four stacked options
 * stand in the "Why?" panel's lane has no variant and no sibling, and a re-fill that came back
 * invalid left it flagged and overflowing on every theme). Only when neither the stem nor the
 * explanation reads the options; the answer and its reason are the model answer, word for word.
 */
export function hingeAsked(slot: DesignSlot): DesignSlot | undefined {
  if (slot.form !== "hinge") return undefined;
  const correct = slot.options.find((o) => o.correct)?.text.trim();
  const readsOptions = (t: string) =>
    /\b(option|options|these|the following|statement|statements)\b|\b[A-D]\)|\(\s*[A-D]\s*\)|\b[A-D] is\b/i.test(
      t,
    );
  if (
    !correct ||
    readsOptions(slot.stem) ||
    readsOptions(slot.explanation) ||
    asksForUnlistedOptions({ stem: slot.stem })
  )
    return undefined;
  const notes = notesAcross(slot.notes, "hinge", "open-response");
  return {
    form: "open-response",
    stem: slot.stem,
    modelAnswer: `${correct.replace(/[.!?]+$/, "")}. ${slot.explanation}`.trim(),
    ...(notes ? { notes } : {}),
  };
}

/**
 * Rung 3: the slot with whole units moved to its notes, word for word, one more each time: the
 * callout, then the body's last sentence, then the last step or point past the form's minimum,
 * then an answer's explanation. Each entry names what moved.
 */
export function unitsToNotes(slot: DesignSlot): { slot: DesignSlot; moved: string }[] {
  const out: { slot: DesignSlot; moved: string }[] = [];
  let current: DesignSlot = slot;
  const move = (next: DesignSlot, text: string, moved: string) => {
    current = { ...next, notes: [next.notes, text].filter(Boolean).join("\n") } as DesignSlot;
    out.push({ slot: current, moved });
  };
  if (current.form === "explain-callout") {
    const { callout, ...rest } = current;
    move({ ...rest, form: "explain" }, callout.text, "callout");
  }
  if ("body" in current && typeof current.body === "string") {
    const parts = sentences(current.body);
    if (parts.length >= 2) {
      const last = parts[parts.length - 1] as string;
      move({ ...current, body: parts.slice(0, -1).join(" ") } as DesignSlot, last, "last sentence");
    }
  }
  if (current.form === "worked-example" && current.steps.length > 1) {
    const last = current.steps[current.steps.length - 1] as string;
    move({ ...current, steps: current.steps.slice(0, -1) }, last, "last step");
  }
  if (current.form === "sequence" && current.steps.length > 2) {
    const last = current.steps[current.steps.length - 1] as string;
    move({ ...current, steps: current.steps.slice(0, -1) }, last, "last step");
  }
  if (current.form === "discussion" && current.footnote) {
    const { footnote, ...rest } = current;
    move(rest as DesignSlot, footnote, "footnote");
  }
  // A hinge's "Why?" panel owes a lane at the foot that four wrapped options need (designer r2:
  // 20 of 21 overflowing slide-themes). Its explanation goes to the notes word for word, once, and
  // the slide shows no panel (`owesExplanationLane`).
  if (current.form === "hinge" && current.explanation.trim()) {
    const { explanation, ...rest } = current;
    const said = (current.notes ?? "").includes(explanation.trim());
    const next = { ...rest, explanation: "" } as DesignSlot;
    if (said) {
      current = next;
      out.push({ slot: current, moved: "explanation" });
    } else move(next, `Why: ${explanation.trim()}`, "explanation");
  }
  return out;
}

/** A unit written as a sentence (or more) where the form lays out a phrase. */
const isSentence = (t: string): boolean =>
  /[.!?]["')\]]*\s*$/.test(t.trim()) || t.trim().split(/\s+/).length > 8;
const moreThanOneSentence = (t: string): boolean => sentences(t).length > 1;

/** The most sentences the palette lets a form's `body` hold. */
function bodyMax(form: SlotForm): number | undefined {
  const unit = paletteForm(form).holds.find((u) => u.slot === "body" && u.unit === "sentence");
  return unit?.max;
}

/**
 * Why a slot did not fit, as structure the re-fill can act on: which of its units is written in a
 * bigger kind of text than the form lays out ("the options are sentences; this form needs
 * phrases"), or which part does not fit beside the rest. Never a length to cut to, and never
 * "shorter" (ruling 132; the plan's rung 4).
 */
export function refillReason(slot: DesignSlot): string {
  const phrases = (what: string, units: readonly string[]) =>
    units.some(isSentence) ? `the ${what} are sentences; this form needs phrases` : undefined;
  const oneEach = (what: string, units: readonly string[]) =>
    units.some(moreThanOneSentence)
      ? `a ${what} is more than one sentence; this form takes one sentence each`
      : undefined;
  const reasons: (string | undefined)[] = [];
  switch (slot.form) {
    case "hinge":
      reasons.push(
        phrases(
          "options",
          slot.options.map((o) => o.text),
        ),
      );
      break;
    case "matching":
      reasons.push(
        phrases(
          "pair sides",
          slot.pairs.flatMap((p) => [p.left, p.right]),
        ),
      );
      break;
    case "list":
      reasons.push(phrases("points", slot.points));
      break;
    case "compare":
      reasons.push(
        phrases("compare points", [...slot.compare.left.points, ...slot.compare.right.points]),
      );
      break;
    case "sequence":
    case "sort":
      reasons.push(oneEach("step", slot.steps));
      break;
    case "worked-example": {
      const n = sentences(slot.question).length;
      // Worded so it carries to the form the re-fill writes (r6 fix smoke: "this form needs
      // phrases" read as the worked example's rule, and the sequence came back in sentences).
      if (n > 1)
        reasons.push(
          `the question is ${n} sentences; one sentence fits over the steps, in any form`,
        );
      if (slot.steps.some(isSentence))
        reasons.push(
          "the lines of working are sentences; each step fits as a phrase or a calculation, in any form",
        );
      break;
    }
    case "vocabulary":
      reasons.push(
        oneEach(
          "definition",
          slot.entries.map((e) => e.definition),
        ),
      );
      break;
    case "fill-gap":
      reasons.push(phrases("answers", slot.answers));
      break;
    default:
      break;
  }
  if ("body" in slot && typeof slot.body === "string") {
    const max = bodyMax(slot.form);
    const n = sentences(slot.body).length;
    if (max !== undefined && n > max)
      reasons.push(
        `the body is ${n} sentences; this form holds ${max === 1 ? "one" : `up to ${max}`}`,
      );
  }
  if (slot.form === "explain-callout")
    reasons.push("the callout card does not fit beside the body and heading");
  if ("heading" in slot && typeof slot.heading === "string" && isSentence(slot.heading))
    reasons.push("the heading is a full sentence; it must read as one line");
  const found = reasons.filter((r): r is string => r !== undefined);
  return found.length > 0
    ? found.join("; ")
    : "its units do not fit the slide at full size on every theme";
}

/** Rung 4: the form a re-fill asks for, one down from the slot's. */
export const FORM_DOWN: Partial<Record<SlotForm, SlotForm>> = {
  "explain-callout": "explain",
  compare: "list",
  list: "explain",
  sequence: "list",
  "worked-example": "sequence",
  hinge: "true-false",
  matching: "fill-gap",
  sort: "open-response",
  "fill-gap": "open-response",
  "true-false": "open-response",
  photo: "explain",
  "diagram-slot": "explain",
  figure: "explain",
  vocabulary: "list",
};

/** A slot and its render: a candidate the step-down rung may fall back to. */
type Candidate = { slot: DesignSlot; render: SlotRender };

/** How many sibling conversions rung 4c chains (worked example -> sequence -> list). */
const CONVERSION_DEPTH = 2;

/**
 * Rung 4c's candidates, nearest first: each sibling's own units moved to the notes, then the
 * siblings of what that leaves, down to `CONVERSION_DEPTH` conversions. The slot itself, its
 * direct siblings and its own units (rungs 2 and 3) are not repeated. `path` names every step,
 * `moved` whether any unit went to the notes.
 */
function conversions(
  slot: DesignSlot,
  toNotes: ToNotes = unitsToNotes,
): { slot: DesignSlot; path: string; moved: boolean }[] {
  const out: { slot: DesignSlot; path: string; moved: boolean }[] = [];
  const seen = new Set<string>([JSON.stringify(slot)]);
  for (const s of siblingsOf(slot)) seen.add(JSON.stringify(s));
  for (const u of toNotes(slot)) seen.add(JSON.stringify(u.slot));
  const add = (next: DesignSlot, path: string, moved: boolean) => {
    const key = JSON.stringify(next);
    if (seen.has(key)) return false;
    seen.add(key);
    out.push({ slot: next, path, moved });
    return true;
  };
  const walk = (from: DesignSlot, path: string, moved: boolean, depth: number) => {
    if (depth >= CONVERSION_DEPTH) return;
    for (const sibling of siblingsOf(from)) {
      const at = [path, sibling.form].filter(Boolean).join(" > ");
      if (depth > 0) add(sibling, at, moved);
      walk(sibling, at, moved, depth + 1);
      for (const u of toNotes(sibling)) {
        const there = `${at} ${u.moved}`;
        add(u.slot, there, true);
        walk(u.slot, there, true, depth + 1);
      }
    }
  };
  walk(slot, "", false, 0);
  return out;
}

/**
 * Rungs 1-3 on one slot (variants, siblings, units to the notes), each logged under `prefix`.
 * Returns the landing and every candidate tried, in order, for the step-down rung.
 */
function lowerRungs(
  slot: DesignSlot,
  render: (s: DesignSlot) => SlotRender,
  themeId: string,
  tried: RungLog[],
  prefix = "",
  toNotes: ToNotes = unitsToNotes,
): { landed?: { cand: Candidate; rung: Rung }; candidates: Candidate[] } {
  const first = render(slot);
  const candidates: Candidate[] = [];
  const log = (rung: Rung, form: SlotForm, ok: boolean, detail?: string) => {
    const d = [prefix, detail].filter(Boolean).join(" ");
    tried.push({ rung, form, ok, ...(d ? { detail: d } : {}) });
  };
  // 1. another variant of the same form
  for (const variant of variantsOf(first)) {
    const cand = { slot, render: { ...first, variant } };
    const ok = slotFits(cand.render, themeId, 0);
    log("variant", slot.form, ok, variant);
    if (ok) return { landed: { cand, rung: "variant" }, candidates };
    candidates.push(cand);
  }
  // 2. a sibling form that holds the same units
  for (const sibling of siblingsOf(slot)) {
    const cand = { slot: sibling, render: render(sibling) };
    const ok = slotFits(cand.render, themeId, 0);
    log("sibling", sibling.form, ok);
    if (ok) return { landed: { cand, rung: "sibling" }, candidates };
    candidates.push(cand);
  }
  // 3. whole units to the notes, word for word
  for (const { slot: moved, moved: what } of toNotes(slot)) {
    const cand = { slot: moved, render: render(moved) };
    const ok = slotFits(cand.render, themeId, 0);
    log("notes", moved.form, ok, what);
    if (ok) return { landed: { cand, rung: "notes" }, candidates };
    candidates.push(cand);
  }
  return { candidates };
}

/**
 * Why a slot fails the save gate (stepDown 1), for the flag a teacher and the eval read: how many
 * themes, and what went wrong there. Never a length.
 */
export function flagReason(render: SlotRender): string {
  const planned = fitsPlanned(render.spec, {
    stepDown: 1,
    ...(render.variant ? { variant: render.variant } : {}),
    structure: render.structure,
  });
  if (planned.ok) return "its named part is not placed in the lesson's theme";
  const count = (pick: (t: (typeof planned.failing)[number]) => boolean) =>
    planned.failing.filter(pick).length;
  const parts = [
    [count((t) => t.overflow.length > 0), "text past the safe area"],
    [count((t) => t.lane.length > 0), "options in the Why? panel's lane"],
    [count((t) => t.answers.length > 0), "answers over the questions"],
    [count((t) => t.steps > 1), "text more than one size step down"],
    [count((t) => t.overlaps > 0), "overlapping boxes"],
  ] as const;
  const what = parts.filter(([n]) => n > 0).map(([n, label]) => `${label} on ${n}`);
  return `fails on ${planned.failing.length} of 10 themes: ${what.join(", ") || "lint"}`;
}

/**
 * Fit one slot: the gate, then the ladder. A re-filled slot goes down the same ladder (rungs 1-3)
 * as the slot it replaced, and the step-down rung tries every candidate either produced, so no
 * rung lands a slot that bypasses the gate. Always returns a slot to render: the one that fitted,
 * or, when nothing did, the original flagged with the reason (its words kept).
 */
export async function fitSlot(slot: DesignSlot, opts: SlotFitOptions): Promise<SlotFit> {
  const { seed, themeId } = opts;
  const refs = opts.factRefs ?? [];
  const tried: RungLog[] = [];
  const render = (s: DesignSlot) => slotRender(s, seed, refs);
  const first = render(slot);
  if (slotFits(first, themeId, 0)) return { slot, render: first, rung: "fits", tried };
  const toNotes: ToNotes = opts.teachingToNotes === false ? asidesToNotes : unitsToNotes;

  const own = lowerRungs(slot, render, themeId, tried, "", toNotes);
  if (own.landed) {
    const { cand, rung } = own.landed;
    return { slot: cand.slot, render: cand.render, rung, tried };
  }
  // 4c (below), run before the re-fill under r6: a roomier sibling chain, then the re-fill.
  const siblingsFirst = opts.teachingToNotes === false;
  const converted: Candidate[] = [];
  const convert = (): SlotFit | undefined => {
    for (const { slot: next, path, moved } of conversions(slot, toNotes)) {
      const r = render(next);
      const ok = slotFits(r, themeId, 0);
      const rung: Rung = moved ? "notes" : "sibling";
      tried.push({ rung, form: next.form, ok, detail: path });
      if (ok) return { slot: next, render: r, rung, tried };
      converted.push({ slot: next, render: r });
    }
    return undefined;
  };
  if (siblingsFirst) {
    const landed = convert();
    if (landed) return landed;
  }
  // 4. one re-fill into the next form down, then that form's own rungs 1-3
  const down = FORM_DOWN[slot.form];
  const fromRefill: Candidate[] = [];
  if (down && opts.refill) {
    const refilled = await opts.refill(slot, down, refillReason(slot)).catch(() => undefined);
    if (refilled) {
      const r = render(refilled);
      const ok = slotFits(r, themeId, 0);
      tried.push({ rung: "refill", form: refilled.form, ok });
      if (ok) return { slot: refilled, render: r, rung: "refill", tried };
      fromRefill.push({ slot: refilled, render: r });
      const again = lowerRungs(refilled, render, themeId, tried, "re-filled", toNotes);
      if (again.landed) {
        const { cand } = again.landed;
        return { slot: cand.slot, render: cand.render, rung: "refill", tried };
      }
      fromRefill.push(...again.candidates);
    } else {
      tried.push({ rung: "refill", form: down, ok: false, detail: "no answer" });
    }
  }
  // 4b. a hinge whose re-fill did not land, asked open in code
  const asked = hingeAsked(slot);
  if (asked) {
    const r = render(asked);
    const ok = slotFits(r, themeId, 0);
    tried.push({ rung: "sibling", form: asked.form, ok, detail: "hinge asked open" });
    if (ok) return { slot: asked, render: r, rung: "sibling", tried };
    fromRefill.push({ slot: asked, render: r });
  }
  // 4c. the siblings' own ladders, once nothing nearer has landed: a sibling form may hold what
  // the slot's form cannot (a worked example's working card is a fixed box that no step moved out
  // can shrink; r5 arm F, y5-rivers and y8-persuasive), so its whole units go to the notes too,
  // and a sibling of what is left is tried in turn (a sequence down to two steps is a list), each
  // word for word. Step-down tries every one of them before the slot is flagged.
  if (!siblingsFirst) {
    const landed = convert();
    if (landed) return landed;
  }
  // 5. one type step down, on every candidate in order, then flag
  const candidates: Candidate[] = [
    ...fromRefill,
    { slot, render: first },
    ...own.candidates,
    ...converted,
  ];
  for (const cand of candidates) {
    const ok = slotFits(cand.render, themeId, 1);
    tried.push({ rung: "step-down", form: cand.slot.form, ok });
    if (ok) return { slot: cand.slot, render: cand.render, rung: "step-down", tried };
  }
  const reason = flagReason(first);
  tried.push({ rung: "flagged", form: slot.form, ok: false, detail: reason });
  return { slot, render: first, rung: "flagged", tried, reason };
}
