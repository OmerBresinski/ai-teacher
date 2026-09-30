import {
  contractText,
  layoutsOf,
  type PaletteFormId,
  type SlotContract,
  writerSchema,
} from "@tj/slides";
import { z } from "zod";
import { slotFormsFor } from "../prompts/design-cycle";
import type { PlanMenuEntry } from "../prompts/plan-lesson";

/*
 * Plan-write's menu (spike/plan-write): every palette form drawn on a slide, each layout with its
 * contract text and part capacity, plus the three question sets (starter, check, exit ticket),
 * which the palette prints in code elsewhere and which here the writer fills like any form.
 */

export const SET_FORMS = ["starter-set", "check-set", "exit-ticket"] as const;
export type SetForm = (typeof SET_FORMS)[number];
export type PlanForm = PaletteFormId | SetForm;

export const isSetForm = (form: string): form is SetForm =>
  (SET_FORMS as readonly string[]).includes(form);

/**
 * A question set's questions. Not measured by the drift test: the render step judges each set with
 * its answers revealed (`setFits`), and a failing set gets the one re-write every slide gets.
 */
export const SET_MAX = 3;
const SET_WHEN: Record<SetForm, string> = {
  "starter-set": "retrieval questions to open the lesson, answers revealed",
  "check-set": "quick questions on what was just taught, answers revealed",
  "exit-ticket": "the closing questions, answers revealed",
};

/** How long a set's question is: a quick check asks short questions. */
const questionKind = (form: SetForm) =>
  form === "check-set" ? "one question on one line" : "one question, at most two lines";

export function setSchema(form: SetForm) {
  return z.object({
    questions: z
      .array(
        z.object({
          question: z.string().trim().min(1).describe(questionKind(form)),
          answer: z.string().trim().min(1).describe("a short answer, half a line"),
        }),
      )
      .min(1)
      .max(SET_MAX)
      .describe(
        `questions: 1–${SET_MAX} items, each with question: ${questionKind(form)}; answer: a short answer, half a line (shown after the reveal)`,
      ),
  });
}

export function setContractText(form: SetForm): string {
  return [
    `${form}:`,
    `- questions: 1–${SET_MAX} items, each with question: ${questionKind(form)}; answer: a short answer, half a line, shown after the reveal`,
  ].join("\n");
}

/** The field a form's parts are counted in: its largest counted slot other than the heading. */
export function partsField(contract: SlotContract): string | undefined {
  const counted = contract.slots.filter(
    (s) => s.field !== "heading" && s.max !== undefined && s.place !== "off-slide",
  );
  const listed = counted.filter((s) => s.field !== "body" && (s.max ?? 0) > 1);
  const pick = (listed.length ? listed : counted).reduce<(typeof counted)[number] | undefined>(
    (best, s) => (!best || (s.max ?? 0) > (best.max ?? 0) ? s : best),
    undefined,
  );
  return pick?.field;
}

/** The most parts a layout holds (the max of its parts field), or undefined when uncounted. */
export function capacityOf(contract: SlotContract): number | undefined {
  const field = partsField(contract);
  return contract.slots.find((s) => s.field === field)?.max;
}

export function layoutCapacity(form: string, layout: string): number | undefined {
  if (isSetForm(form)) return SET_MAX;
  const c = layoutsOf(form as PaletteFormId).find((x) => x.layout === layout);
  return c ? capacityOf(c) : undefined;
}

/** The planner's menu for a subject: forms on a slide, every layout, then the question sets. */
export function planMenu(subject?: string): PlanMenuEntry[] {
  const forms = slotFormsFor(subject) as PaletteFormId[];
  const entries: PlanMenuEntry[] = forms.flatMap((form) =>
    layoutsOf(form).map((c) => {
      const capacity = capacityOf(c);
      return {
        form,
        layout: c.layout,
        ...(c.when ? { when: c.when } : {}),
        ...(capacity !== undefined ? { capacity } : {}),
        contract: contractText(form, c.layout),
      };
    }),
  );
  for (const form of SET_FORMS) {
    entries.push({
      form,
      layout: "default",
      when: SET_WHEN[form],
      capacity: SET_MAX,
      contract: setContractText(form),
    });
  }
  return entries;
}

/** The contract text a writer sees for one slide. */
export function contractFor(form: string, layout: string): string {
  return isSetForm(form) ? setContractText(form) : contractText(form as PaletteFormId, layout);
}

/** The writer's schema for one slide: the contract's fields plus the teacher notes. */
export function slideWriterSchema(form: string, layout: string) {
  const base = isSetForm(form) ? setSchema(form) : writerSchema(form as PaletteFormId, layout);
  // Notes first: said aloud, answer first on a question slide (write-slides.v1).
  return z
    .object({ notes: z.string().describe("what the teacher says and does with this slide") })
    .extend(base.shape);
}
