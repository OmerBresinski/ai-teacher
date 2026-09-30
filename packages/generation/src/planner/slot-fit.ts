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
};

export type SlotFitOptions = {
  seed: string;
  themeId: string;
  factRefs?: string[];
  /** Rung 4: one design-cycle call for this slot in `form`. Absent: the rung is skipped. */
  refill?: (slot: DesignSlot, form: SlotForm) => Promise<DesignSlot | undefined>;
};

const META = { promptVersion: "fit", model: "fit", at: "1970-01-01T00:00:00.000Z" };

/**
 * Whether a laid-out slot fits every theme at `stepDown`, and, for a form with a named part (the
 * callout card, a compare card), still places it in the lesson's theme: a variant that drops the
 * callout has not fitted it.
 */
export function slotFits(render: SlotRender, themeId: string, stepDown: 0 | 1): boolean {
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

/** Rung 2: the sibling forms that hold the same units, converted in code, nearest first. */
export function siblingsOf(slot: DesignSlot): DesignSlot[] {
  const notes = slot.notes;
  const withNotes = <T extends DesignSlot>(s: T, extra?: string): T => {
    const joined = [notes, extra].filter(Boolean).join("\n");
    return joined ? { ...s, notes: joined } : s;
  };
  switch (slot.form) {
    case "hinge": {
      const right = slot.options.find((o) => o.correct) ?? slot.options[0];
      const wrong = slot.options.find((o) => !o.correct);
      const out: DesignSlot[] = [];
      if (right)
        out.push(
          withNotes(
            { form: "open-response", stem: slot.stem, modelAnswer: right.text },
            `${slot.explanation}${
              wrong
                ? ` Wrong answers to listen for: ${slot.options
                    .filter((o) => !o.correct)
                    .map((o) => o.text)
                    .join("; ")}`
                : ""
            }`,
          ),
        );
      if (wrong)
        out.push(
          withNotes({
            form: "true-false",
            statement: wrong.text,
            correct: false,
            explanation: slot.explanation,
          }),
        );
      return out;
    }
    case "explain": {
      const [lead, ...rest] = sentences(slot.body);
      if (!lead || rest.length === 0) return [];
      return [
        withNotes({ form: "list", heading: slot.heading, body: lead, points: rest.slice(0, 2) }),
        withNotes({ form: "sequence", heading: slot.heading, body: lead, steps: rest.slice(0, 3) }),
      ].filter((s) => (s.form === "list" ? s.points.length === 2 : s.steps.length >= 2));
    }
    case "explain-callout":
      return [
        withNotes({
          form: "explain",
          heading: slot.heading,
          body: `${slot.body} ${slot.callout.text}`.trim(),
        }),
      ];
    case "list":
      return [
        withNotes({ form: "sequence", heading: slot.heading, body: slot.body, steps: slot.points }),
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
      return [
        withNotes({
          form: "open-response",
          stem: `True or false? ${slot.statement}`,
          modelAnswer: `${slot.correct ? "True" : "False"}. ${slot.explanation}`,
        }),
      ];
    case "fill-gap":
      return [
        withNotes(
          {
            form: "open-response",
            stem: slot.stem,
            modelAnswer: slot.answers.join("; "),
          },
          slot.sentence,
        ),
      ];
    case "sort":
      return [
        withNotes(
          { form: "sequence", heading: slot.stem, body: slot.stem, steps: slot.steps.slice(0, 3) },
          slot.steps.length > 3 ? slot.steps.slice(3).join("; ") : undefined,
        ),
      ];
    case "matching":
      return [
        withNotes({
          form: "vocabulary",
          entries: slot.pairs.map((p) => ({ term: p.left, definition: p.right })),
        }),
      ];
    default:
      return [];
  }
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
  return out;
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

/**
 * Fit one slot: the gate, then the ladder. Always returns a slot to render: the one that fitted,
 * or, when nothing did, the original flagged (its words kept; the flag says it may step twice).
 */
export async function fitSlot(slot: DesignSlot, opts: SlotFitOptions): Promise<SlotFit> {
  const { seed, themeId } = opts;
  const refs = opts.factRefs ?? [];
  const tried: RungLog[] = [];
  const render = (s: DesignSlot) => slotRender(s, seed, refs);
  const first = render(slot);
  if (slotFits(first, themeId, 0)) return { slot, render: first, rung: "fits", tried };

  // 1. another variant of the same form
  for (const variant of variantsOf(first)) {
    const r = { ...first, variant };
    const ok = slotFits(r, themeId, 0);
    tried.push({ rung: "variant", form: slot.form, ok, detail: variant });
    if (ok) return { slot, render: r, rung: "variant", tried };
  }
  // 2. a sibling form that holds the same units
  for (const sibling of siblingsOf(slot)) {
    const r = render(sibling);
    const ok = slotFits(r, themeId, 0);
    tried.push({ rung: "sibling", form: sibling.form, ok });
    if (ok) return { slot: sibling, render: r, rung: "sibling", tried };
  }
  // 3. whole units to the notes, word for word
  for (const { slot: moved, moved: what } of unitsToNotes(slot)) {
    const r = render(moved);
    const ok = slotFits(r, themeId, 0);
    tried.push({ rung: "notes", form: moved.form, ok, detail: what });
    if (ok) return { slot: moved, render: r, rung: "notes", tried };
  }
  // 4. one re-fill into the next form down
  const down = FORM_DOWN[slot.form];
  let refilled: DesignSlot | undefined;
  if (down && opts.refill) {
    refilled = await opts.refill(slot, down).catch(() => undefined);
    const ok = refilled ? slotFits(render(refilled), themeId, 0) : false;
    tried.push({ rung: "refill", form: down, ok, ...(refilled ? {} : { detail: "no answer" }) });
    if (ok && refilled) return { slot: refilled, render: render(refilled), rung: "refill", tried };
  }
  // 5. one type step down, then flag
  for (const candidate of [refilled, slot]) {
    if (!candidate) continue;
    const r = render(candidate);
    const ok = slotFits(r, themeId, 1);
    tried.push({ rung: "step-down", form: candidate.form, ok });
    if (ok) return { slot: candidate, render: r, rung: "step-down", tried };
  }
  tried.push({ rung: "flagged", form: slot.form, ok: false });
  return { slot, render: first, rung: "flagged", tried };
}
