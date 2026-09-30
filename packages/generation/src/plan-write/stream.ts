import { z } from "zod";
import { type PlanMenuEntry, planLessonSchema } from "../prompts/plan-lesson";
import { slideWriterSchema } from "./menu";

/*
 * Plan-write's single stream (PLAN_WRITE_MODE=stream): one call writes the plan header and then
 * every slide. Each slide is an item of the per-form writer schemas, told apart by `kind` (the
 * palette's own name for a form and layout: "hinge", "hinge (stacked)").
 */

export type PlanWriteMode = "plan-write" | "stream";

/** The default: the single stream (the plan-write final round, 30 Sep 2026). */
export const PLAN_WRITE_MODE_DEFAULT: PlanWriteMode = "stream";

/** The mode: `asked` first, then PLAN_WRITE_MODE; the stream unless it says plan-write. */
export function planWriteMode(asked?: string): PlanWriteMode {
  return (asked ?? process.env.PLAN_WRITE_MODE) === "plan-write"
    ? "plan-write"
    : PLAN_WRITE_MODE_DEFAULT;
}

export const kindOf = (form: string, layout: string): string =>
  layout === "default" ? form : `${form} (${layout})`;

/** A streamed slide's kind as a menu form and layout; undefined when it names none. */
export function formOfKind(
  kind: unknown,
  menu: readonly PlanMenuEntry[],
): { form: string; layout: string } | undefined {
  if (typeof kind !== "string") return undefined;
  const k = kind.trim().toLowerCase();
  const m = menu.find((e) => kindOf(e.form, e.layout) === k);
  return m ? { form: m.form, layout: m.layout } : undefined;
}

/** One streamed slide: a discriminated union of every menu entry's writer schema. */
export function streamSlideSchema(menu: readonly PlanMenuEntry[]) {
  const members = menu.map((m) =>
    z
      .object({ kind: z.literal(kindOf(m.form, m.layout)) })
      .extend(slideWriterSchema(m.form, m.layout).shape),
  );
  return z.discriminatedUnion("kind", members as unknown as [z.ZodObject, ...z.ZodObject[]]);
}

/** The schema the model is given: the plan header, then the slides. */
export function streamLessonSchema(menu: readonly PlanMenuEntry[]) {
  return z.object({
    misconception: planLessonSchema.shape.misconception,
    objectives: planLessonSchema.shape.objectives,
    runningExample: planLessonSchema.shape.runningExample,
    titlePicture: planLessonSchema.shape.titlePicture,
    plan: planLessonSchema.shape.slides,
    slides: z.array(streamSlideSchema(menu)),
  });
}

/** What the call accepts: the header whole; each slide is checked by code as it closes. */
export const streamLessonLenient = z.object({
  misconception: z.string(),
  objectives: z.array(z.string()).min(1),
  runningExample: z.string(),
  titlePicture: z
    .object({
      subject: z.string(),
      named: z.string().nullish().catch(null),
      mustShow: z.array(z.string()).catch([]),
    })
    .nullish()
    .catch(null),
  plan: z.array(z.string()),
  slides: z.array(z.record(z.string(), z.unknown())),
});
export type StreamLessonWire = z.infer<typeof streamLessonLenient>;

/**
 * One streamed slide checked against its kind's writer schema: the form, layout and fields, or
 * why it cannot be drawn.
 */
export function checkStreamed(
  raw: Record<string, unknown>,
  menu: readonly PlanMenuEntry[],
): { form: string; layout: string; out?: Record<string, unknown>; problem?: string } | undefined {
  const { kind, ...fields } = raw;
  const at = formOfKind(kind, menu);
  if (!at) return undefined;
  const parsed = slideWriterSchema(at.form, at.layout).safeParse(fields);
  return parsed.success
    ? { ...at, out: parsed.data as Record<string, unknown> }
    : {
        ...at,
        problem: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      };
}
