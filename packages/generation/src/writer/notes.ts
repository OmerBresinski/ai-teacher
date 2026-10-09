// The writer stage's objective coverage and notes:
// objective coverage from the flow's `teaches`, one targeted objective repair, and one notes call
// per lesson on the slides as rendered.
import { teachesSchema } from "./contract";
import { type ChatReq, nonFatal, whenNonFatal } from "./services";

/** Templates whose slide checks pupils rather than teaching them. */
export const CHECK_TEMPLATES = new Set([
  "hinge",
  "question-set",
  "practice",
  "exit-ticket",
  "discussion",
]);

export type FlowEntry = { slide: number; does?: string; teaches?: number[] };
export type Coverage = { untaught: number[]; unchecked: number[]; missing: number[] };

/** Coverage rules behind the checker flags (`checker-flags.ts`); all off is master's rule. */
export type CoverageRules = {
  /** coverageCountsPictureTasks: a task on a picture or diagram slide is a check. */
  pictureTasks?: boolean;
  /** coverageExcludesDiscussion (D36): a discussion slide is not a check. */
  noDiscussion?: boolean;
  /** coverageExcludesPrediction: a check counts only after the objective's first teaching slide. */
  afterTeaching?: boolean;
  /** The written slide for flow slide k (title = 1), for `pictureTasks`. */
  slideOf?: (slide: number) => Record<string, unknown> | undefined;
};

/**
 * Each objective needs at least one teaching slide and one checking slide naming it in `teaches`
 *. Flow slide numbers count from 1 with the title as 1 and the objectives slide
 * as 2; `templateOf(slideNumber)` gives the written slide's template, or undefined when the flow
 * entry has no written slide yet (then it counts by what the flow says it does).
 */
export function coverage(
  flow: FlowEntry[],
  objectives: number,
  templateOf: (slide: number) => string | undefined,
  rules: CoverageRules = {},
): Coverage {
  const taught = new Set<number>();
  const checked = new Set<number>();
  const isCheck = (f: FlowEntry) => {
    const t = templateOf(f.slide);
    if (t === "discussion" && rules.noDiscussion) return false;
    if (t && CHECK_TEMPLATES.has(t)) return true;
    return t ? false : /\b(check|quiz|practi[cs]e|question|exit)/i.test(f.does ?? "");
  };
  const body = flow.filter((f) => f.slide > 2);
  const firstTaught = new Map<number, number>();
  for (const f of body)
    if (!isCheck(f))
      for (const k of f.teaches ?? []) {
        taught.add(k);
        firstTaught.set(k, Math.min(firstTaught.get(k) ?? Infinity, f.slide));
      }
  for (const f of body)
    if (isCheck(f))
      for (const k of f.teaches ?? [])
        if (!rules.afterTeaching || f.slide > (firstTaught.get(k) ?? Infinity)) checked.add(k);
  const all = Array.from({ length: objectives }, (_, i) => i + 1);
  const untaught = all.filter((k) => !taught.has(k));
  const unchecked = all.filter((k) => !checked.has(k));
  return { untaught, unchecked, missing: all.filter((k) => !taught.has(k) || !checked.has(k)) };
}

/** The objective-repair schema: `{changes: [{n, teaches, slide}]}` over the arm's teaching union. */
export function objectiveRepairSchema(repairSchema: {
  properties: { slide: unknown };
  $defs: Record<string, unknown>;
}) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["changes"],
    properties: {
      changes: {
        type: "array",
        minItems: 1,
        maxItems: 4,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["n", "teaches", "slide"],
          properties: {
            n: { type: "integer" },
            teaches: { type: "array", items: { type: "integer" } },
            slide: repairSchema.properties.slide,
          },
        },
      },
    },
    $defs: repairSchema.$defs,
  };
}

type Plan = { flow: FlowEntry[]; slides: Record<string, unknown>[] };
type Chat = (r: ChatReq) => Promise<{ out?: unknown; usd: number; ms: number }>;

/**
 * One targeted repair call when an objective is missing: slides are replaced one for one (count
 * unchanged, never the title or objectives slide), then coverage is checked once more. A repair
 * that still leaves an objective missing is discarded and the original plan kept.
 * `plan.slides` is deck-indexed as in the stage: flow slide k is `plan.slides[k - 1]` (title, objectives first).
 */
export async function repairObjectives(o: {
  plan: Plan;
  objectives: string[];
  context: string;
  system: string;
  schema: unknown;
  chat: Chat;
  log: (e: object) => void;
  onUsd: (usd: number) => void;
  /** The checker flags' coverage rules; absent: master's rule. */
  rules?: CoverageRules;
}): Promise<{ plan: Plan; repaired: boolean; before: Coverage; after?: Coverage }> {
  const cover = (p: Plan) =>
    coverage(
      p.flow,
      o.objectives.length,
      (slide) => (p.slides[slide - 1]?.template as string | undefined) ?? undefined,
      { ...o.rules, slideOf: (slide) => p.slides[slide - 1] },
    );
  const before = cover(o.plan);
  if (!before.missing.length) return { plan: o.plan, repaired: false, before };
  const user = [
    o.context,
    "",
    "Objectives:",
    ...o.objectives.map((t, k) => `${k + 1}. ${t}`),
    "",
    "Lesson:",
    JSON.stringify({ flow: o.plan.flow, slides: o.plan.slides.slice(2) }),
    "",
    `Missing objectives: ${before.missing.join(", ")}`,
    // Each missing objective with what it lacks, so the repair targets that slide kind.
    ...before.missing.map(
      (k) =>
        `- ${k}: ${[
          before.untaught.includes(k) ? "no slide teaches it" : "",
          before.unchecked.includes(k)
            ? "no hinge, question-set, practice, exit-ticket or discussion slide checks it"
            : "",
        ]
          .filter(Boolean)
          .join("; ")}`,
    ),
  ].join("\n");
  const r = await o
    .chat({
      model: "gpt-6-luna",
      effort: "low",
      system: o.system,
      user,
      schema: withObjectiveNumbers(o.schema, o.objectives.length) as ChatReq["schema"],
      name: "objective_repair",
      strict: false,
    } as ChatReq)
    .catch(
      whenNonFatal((e) => {
        o.log({ ev: "objective-repair-error", err: String(e).slice(0, 200) });
        return undefined;
      }),
    );
  if (!r) return { plan: o.plan, repaired: false, before };
  o.onUsd(r.usd);
  const changes = ((r.out as { changes?: unknown })?.changes ?? []) as {
    n: number;
    teaches: number[];
    slide: Record<string, unknown>;
  }[];
  const next: Plan = { flow: o.plan.flow.map((f) => ({ ...f })), slides: [...o.plan.slides] };
  const changed: number[] = [];
  for (const c of changes) {
    const i = c.n - 1;
    if (c.n <= 2 || i >= next.slides.length || !c.slide) continue;
    next.slides[i] = c.slide;
    const f = next.flow.find((x) => x.slide === c.n);
    if (f) f.teaches = c.teaches;
    changed.push(c.n);
  }
  const after = cover(next);
  // A repair that covers some missing objectives and loses none is kept (it used to be discarded
  // unless every objective was covered); what is still missing is logged as `stillMissing`.
  const ok =
    changed.length > 0 &&
    after.missing.length < before.missing.length &&
    after.missing.every((k) => before.missing.includes(k));
  o.log({
    ev: "objective-repair",
    missing: before.missing,
    changed,
    stillMissing: after.missing,
    kept: ok ? "repair" : "original",
    usd: r.usd,
    ms: r.ms,
  });
  return ok
    ? { plan: next, repaired: true, before, after }
    : { plan: o.plan, repaired: false, before, after };
}

/** The repair schema with `changes[].teaches` held to the approved objectives' numbers. */
export function withObjectiveNumbers(schema: unknown, objectives: number): unknown {
  const s = schema as { properties?: { changes?: { items?: { properties?: object } } } };
  const item = s?.properties?.changes?.items;
  if (!item?.properties || objectives < 1) return schema;
  return {
    ...s,
    properties: {
      ...s.properties,
      changes: {
        ...s.properties?.changes,
        items: { ...item, properties: { ...item.properties, teaches: teachesSchema(objectives) } },
      },
    },
  };
}

/* ── notes, one call per lesson ─────────────────── */

type El = {
  type: string;
  name?: string;
  alt?: string;
  doc?: { content?: { content?: { text?: string }[] }[] };
};
const textOf = (e: El) =>
  (e.doc?.content ?? [])
    .map((p) => (p.content ?? []).map((t) => t.text ?? "").join(""))
    .filter(Boolean)
    .join(" ")
    .trim();

/**
 * A slide's lines as a pupil sees them, in drawing order: a lone list number or option letter
 * (a badge) is joined to the text after it ("B. There is lots of space"). Visuals are given by the
 * caller, only those actually placed.
 */
export function renderedLines(n: number, elements: El[], visuals: string[]): string {
  const lines: string[] = [];
  let badge = "";
  let heading = "";
  for (const e of elements) {
    if (e.type !== "text") continue;
    const t = textOf(e);
    if (!t) continue;
    if (!heading && (e.name === "Heading" || e.name === "Title")) {
      heading = t;
      continue;
    }
    if (/^[A-Z0-9]{1,2}[.)]?$/.test(t)) {
      badge = t.replace(/[.)]$/, "");
      continue;
    }
    lines.push(badge ? `${badge}. ${t}` : t);
    badge = "";
  }
  return [`Slide ${n}: ${heading}`, ...lines, ...visuals].join("\n");
}

export type SlideNotes = {
  n: number;
  /** one answer per question, in order (an old notes file has one string). */
  answers: string[] | string | null;
  misconceptions: string | null;
  background: string | null;
  /** how the teacher runs the slide and for how long (the writer defers this to notes). */
  run?: string | null;
};

/** The notes as the teacher reads them, under the three headings; empty parts are left out. */
export function notesText(s: SlideNotes | undefined): string {
  if (!s) return "";
  return (
    [
      ["Running", s.run ?? null],
      [
        "Answers",
        Array.isArray(s.answers)
          ? s.answers
              .map((a, i) => (s.answers && s.answers.length > 1 ? `${i + 1}. ${a}` : a))
              .join("\n")
          : s.answers,
      ],
      ["Misconceptions", s.misconceptions],
      ["Background", s.background],
    ] as const
  )
    .filter(([, v]) => v?.trim())
    .map(([h, v]) => `${h}\n${v?.trim()}`)
    .join("\n\n");
}

/**
 * The lesson's notes in one call (after repair, on the final slides): retried once on an error
 * or a schema failure, each try under a deadline; every slide number gets an entry (missing ones
 * empty). Never throws: a lesson whose notes fail ships with empty notes, and the failure is logged.
 */
/** The line after the lesson that asks the notes call for some slides only (code wording). */
export const notesOnlyLine = (slides: number[]) =>
  `Write the notes for these slides only: ${slides.join(", ")}.`;

export async function lessonNotes(o: {
  slides: number;
  system: string;
  user: string;
  schema: unknown;
  chat: Chat;
  log: (e: object) => void;
  onUsd: (usd: number) => void;
  timeoutMs?: number;
  /** The first slide that gets notes (3: title and objectives are left out). */
  first?: number;
}): Promise<Map<number, SlideNotes>> {
  const got = new Map<number, SlideNotes>();
  for (let attempt = 0; attempt < 2 && !got.size; attempt++) {
    await nonFatal(
      async () => {
        const r = await o.chat({
          model: "gpt-6-luna",
          effort: "low",
          system: o.system,
          user: o.user,
          schema: o.schema as ChatReq["schema"],
          name: "notes",
          // Strict JSON, as base4f-p123 ran it (TEACH-110 part f): the notes schema lists every key.
          strict: true,
          timeoutMs: o.timeoutMs ?? 60_000,
        } as ChatReq);
        o.onUsd(r.usd);
        const rows = (r.out as { slides?: SlideNotes[] })?.slides;
        if (!Array.isArray(rows)) throw new Error("notes: no slides array");
        for (const s of rows) if (Number.isInteger(s?.n) && !got.has(s.n)) got.set(s.n, s);
        o.log({ ev: "notes", attempt, slides: got.size, of: o.slides, usd: r.usd, ms: r.ms });
      },
      (e) => {
        o.log({ ev: "notes-error", attempt, err: String(e).slice(0, 200) });
      },
    );
  }
  // the missing slides get one more call,
  // named in a line after the lesson (code wording; the prompt-engineer may own it).
  const missing = Array.from({ length: o.slides }, (_, k) => k + 1).filter(
    (n) => n >= (o.first ?? 1) && !got.has(n),
  );
  if (got.size && missing.length) {
    await nonFatal(
      async () => {
        const r = await o.chat({
          model: "gpt-6-luna",
          effort: "low",
          system: o.system,
          user: `${o.user}\n\n${notesOnlyLine(missing)}`,
          schema: o.schema as ChatReq["schema"],
          name: "notes",
          // Strict JSON, as base4f-p123 ran it (TEACH-110 part f): the notes schema lists every key.
          strict: true,
          timeoutMs: o.timeoutMs ?? 60_000,
        } as ChatReq);
        o.onUsd(r.usd);
        const rows = (r.out as { slides?: SlideNotes[] })?.slides ?? [];
        for (const s of rows) if (missing.includes(s?.n) && !got.has(s.n)) got.set(s.n, s);
        o.log({ ev: "notes-missing", asked: missing, got: rows.length, usd: r.usd, ms: r.ms });
      },
      (e) => {
        o.log({ ev: "notes-missing-error", asked: missing, err: String(e).slice(0, 200) });
      },
    );
  }
  for (let n = o.first ?? 1; n <= o.slides; n++)
    if (!got.has(n)) got.set(n, { n, answers: null, misconceptions: null, background: null });
  return got;
}
