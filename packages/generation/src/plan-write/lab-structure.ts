import { z } from "zod";

/*
 * TEACH-179 lab arm (lab/jev-structure, not production): a decision model (Jev or Laya on the
 * Vercel AI Gateway, POST /v1/evaluate) makes the lesson's typed structure decisions before the
 * Sol stream writes it. The model writes no text; it picks from closed option sets and code builds
 * `LessonStructure` from its answers, so the structure is valid by construction.
 *
 * Coherence: answers inside one evaluate call cannot see each other. Two sequential calls plus code:
 *   round 1 (lesson level): objectives count, opening, method topic, visuality, exam style and marks,
 *     response mode, practice style;
 *   code: the slot skeleton (roles in order, objective per slot) from round 1 and the row count;
 *   round 2 (per slot, the skeleton and round 1's answers in the state): the form of every teach,
 *     check and opening slot;
 *   code: picture share from visuality (pictured slots ranked by their picture probability), one
 *     worked example per objective on a method topic, no check form twice running, no three teach
 *     forms the same in a row.
 * The probabilities, not only the argmax, drive the code rules.
 */

export const STRUCTURE_QUESTIONS_VERSION = "structure-questions.v1";
export const STREAM_STRUCTURE_VERSION = "stream-structure.v1";

/* --------------------------------------------------------------- evaluate API */

export type Question =
  | { type: "boolean"; instructions: string; criteria?: { true: string; false: string } }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] };

export type Answer =
  | { type: "boolean"; probability: number }
  | { type: "choice"; choice: string; probabilities: Record<string, number> }
  | { type: "score"; score: number; probabilities: Record<string, number> };

export type EvalCall = {
  answers: Record<string, Answer>;
  ms: number;
  costUsd: number | null;
  inputTokens: number | null;
};

export type Evaluator = (state: unknown, questions: Record<string, Question>) => Promise<EvalCall>;

const GATEWAY = "https://ai-gateway.vercel.sh/v1/evaluate";

/** Plain fetch to the gateway's evaluate endpoint (no AI SDK bump needed). */
export function gatewayEvaluator(model: string, apiKey: string, timeoutMs = 20_000): Evaluator {
  return async (state, questions) => {
    const t0 = Date.now();
    const res = await fetch(GATEWAY, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, state, questions }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    const ms = Date.now() - t0;
    if (!res.ok) throw new Error(`evaluate ${model} HTTP ${res.status}: ${text.slice(0, 300)}`);
    const body = JSON.parse(text) as {
      answers: Record<string, Answer>;
      usage?: { inputTokens?: number };
      providerMetadata?: { gateway?: { cost?: string } };
    };
    const cost = body.providerMetadata?.gateway?.cost;
    return {
      answers: body.answers,
      ms,
      costUsd: cost === undefined ? null : Number(cost),
      inputTokens: body.usage?.inputTokens ?? null,
    };
  };
}

/** A deterministic stand-in for tests and dry runs: probabilities from a hash of the key. */
export function stubEvaluator(): Evaluator {
  const h = (s: string) => {
    let x = 2166136261;
    for (const c of s) x = Math.imul(x ^ c.charCodeAt(0), 16777619);
    return ((x >>> 0) % 1000) / 1000;
  };
  return async (_state, questions) => {
    const answers: Record<string, Answer> = {};
    for (const [k, q] of Object.entries(questions)) {
      if (q.type === "boolean") answers[k] = { type: "boolean", probability: h(k) };
      else if (q.type === "choice") {
        const opts = Object.keys(q.criteria);
        const raw = opts.map((o) => 0.1 + h(k + o));
        const sum = raw.reduce((a, b) => a + b, 0);
        const probabilities = Object.fromEntries(opts.map((o, i) => [o, (raw[i] ?? 0) / sum]));
        const choice = opts.reduce((a, b) =>
          (probabilities[b] ?? 0) > (probabilities[a] ?? 0) ? b : a,
        );
        answers[k] = { type: "choice", choice, probabilities };
      } else {
        const p = h(k);
        const n = q.criteria.length;
        const top = Math.min(n - 1, Math.floor(p * n));
        answers[k] = {
          type: "score",
          score: top,
          probabilities: Object.fromEntries(
            q.criteria.map((_, i) => [String(i), i === top ? 1 : 0]),
          ),
        };
      }
    }
    return { answers, ms: 0, costUsd: 0, inputTokens: 0 };
  };
}

/* --------------------------------------------------------------- context */

export type StructureContext = {
  topic: string;
  subject: string;
  /** "Year 9" */
  yearGroup: string;
  /** Rows the stream plans after the title and objectives slides. */
  rows: number;
  /** The menu's form names, so no answer names a form the stream cannot draw. */
  forms: readonly string[];
  /** The brief's difficulty or prior knowledge, when it gives one. */
  difficulty?: string;
};

export const yearOf = (yearGroup: string): number => {
  const m = /(\d+)/.exec(yearGroup);
  return m ? Number(m[1]) : 7;
};

export const keyStageOf = (year: number): string =>
  year <= 2 ? "KS1" : year <= 6 ? "KS2" : year <= 9 ? "KS3" : year <= 11 ? "KS4" : "KS5";

const stateOf = (c: StructureContext) => ({
  lesson: {
    topic: c.topic,
    subject: c.subject,
    yearGroup: c.yearGroup,
    keyStage: keyStageOf(yearOf(c.yearGroup)),
    slidesToPlan: c.rows,
    ...(c.difficulty ? { difficulty: c.difficulty } : {}),
  },
});

/* --------------------------------------------------------------- round 1 */

export const VISUALITY = ["low", "medium", "high", "very high"] as const;
/** Share of teach slots that carry a photo or diagram, per visuality rung (ruling 147). */
const PICTURE_SHARE = [0.25, 0.5, 0.75, 1] as const;
export const MARKS = [2, 4, 6, 9] as const;

export function round1Questions(): Record<string, Question> {
  return {
    objectives: {
      type: "choice",
      instructions:
        "How many learning objectives does a full lesson on this topic need for these pupils?",
      criteria: {
        one: "one: the topic is a single method or skill, taught and practised as one idea",
        two: "two: two distinct ideas, or one idea and then applying it",
        three: "three: three distinct ideas, the usual for a full topic lesson",
      },
    },
    opening: {
      type: "choice",
      instructions: "How should this lesson open, before the first teaching slide?",
      criteria: {
        retrieve:
          "retrieve: quick questions on earlier learning this topic builds on, which these pupils have met before",
        hook: "hook: a puzzling question, case or picture, because the topic is new and builds on little the class has been taught",
      },
    },
    method: {
      type: "boolean",
      instructions:
        "Is the core of this lesson a method pupils carry out (a calculation or procedure) or an explanation they build step by step from evidence or a model?",
      criteria: {
        true: "pupils must learn to carry out a method or build a chained explanation, so a worked example helps",
        false:
          "the lesson is mostly about knowing and describing things, so no worked example is needed",
      },
    },
    visuality: {
      type: "score",
      instructions:
        "How visual should the teaching slides be for this age, subject and topic: what share of them should carry a photograph or a diagram?",
      criteria: [
        "low: the ideas are abstract or textual (an argument, a text, grammar, an interpretation); pictures only where an idea has a shape",
        "medium: about half the ideas are things, places or structures that can be shown",
        "high: most ideas are concrete things, places, processes or structures that can be shown",
        "very high: young pupils, and nearly everything taught can be pictured",
      ],
    },
    examStyle: {
      type: "boolean",
      instructions:
        "Do these pupils sit a public exam (GCSE or A level) that asks about this topic with command words and marks?",
      criteria: {
        true: "Year 10 to 13 pupils, and this topic is examined with marked questions",
        false: "younger pupils, or a topic not examined with marked questions",
      },
    },
    examMarks: {
      type: "score",
      instructions:
        "How many marks does a typical exam practice question on this topic carry, for these pupils?",
      criteria: [
        "1 to 2 marks: recall or a short calculation",
        "3 to 4 marks: describe or explain one point",
        "6 marks: an extended explanation",
        "8 to 12 marks: evaluate or an essay",
      ],
    },
    responseMode: {
      type: "choice",
      instructions: "How do pupils of this age most usefully answer this lesson's quick checks?",
      criteria: {
        whiteboards: "whiteboards: short answers held up at once, so the teacher sees every pupil",
        books: "books: written answers kept in exercise books, for working or full sentences",
        talk: "talk: spoken answers to a partner, for young pupils or questions with more than one answer",
      },
    },
    practice: {
      type: "choice",
      instructions:
        "What should pupils do on the lesson's practice slide, where they work without the teacher?",
      criteria: {
        items: "items: a set of new questions that step up in difficulty, answered alone",
        discussion:
          "discussion: a question with more than one defensible answer, argued in pairs or as a class",
        extended: "extended: one longer written answer, such as an exam question or a paragraph",
      },
    },
  };
}

export type Round1 = {
  objectives: 1 | 2 | 3;
  opening: "retrieve" | "hook";
  method: boolean;
  visualityScore: number;
  visuality: (typeof VISUALITY)[number];
  examStyle: boolean;
  marks: number;
  responseMode: "whiteboards" | "books" | "talk";
  practice: "items" | "discussion" | "extended";
  /** P(chosen option) per question, for the report. */
  confidence: Record<string, number>;
};

const choiceOf = (a: Answer | undefined, fallback: string) =>
  a?.type === "choice" && a.choice ? a.choice : fallback;
const confidenceOf = (a: Answer | undefined): number =>
  !a
    ? 0
    : a.type === "boolean"
      ? Math.max(a.probability, 1 - a.probability)
      : Math.max(...Object.values(a.probabilities));
const scoreOf = (a: Answer | undefined, top: number) =>
  a?.type === "score" && Number.isFinite(a.score) ? Math.min(top, Math.max(0, a.score)) : top / 2;

export function readRound1(answers: Record<string, Answer>, ctx: StructureContext): Round1 {
  const year = yearOf(ctx.yearGroup);
  const objectives = { one: 1, two: 2, three: 3 }[choiceOf(answers.objectives, "three")] as
    | 1
    | 2
    | 3;
  const vs = scoreOf(answers.visuality, VISUALITY.length - 1);
  const ms = scoreOf(answers.examMarks, MARKS.length - 1);
  const exam = answers.examStyle?.type === "boolean" && answers.examStyle.probability >= 0.5;
  return {
    objectives: objectives ?? 3,
    opening: choiceOf(answers.opening, "retrieve") as Round1["opening"],
    method: answers.method?.type === "boolean" && answers.method.probability >= 0.5,
    visualityScore: vs,
    visuality: VISUALITY[Math.round(vs)] ?? "medium",
    // Ruling 146: exam-style only at KS4 and KS5, whatever the model says.
    examStyle: exam && year >= 10,
    marks: MARKS[Math.round(ms)] ?? 4,
    responseMode: choiceOf(answers.responseMode, "books") as Round1["responseMode"],
    practice: choiceOf(answers.practice, "items") as Round1["practice"],
    confidence: Object.fromEntries(Object.entries(answers).map(([k, a]) => [k, confidenceOf(a)])),
  };
}

/* --------------------------------------------------------------- skeleton (code) */

export const ROLES = ["retrieve", "hook", "teach", "check", "hinge", "practise"] as const;
export type Role = (typeof ROLES)[number];
export type SkeletonSlot = { slide: number; role: Role; objective: number | null };

/** About two thirds of the rows teach: plan-lesson's `teachRange` low end. */
export const teachCount = (rows: number) => Math.max(1, Math.floor((rows * 2) / 3));

/**
 * The slots in order. Teach slots first (about two thirds, at least one per objective, spread
 * evenly, earlier objectives take any extra); the rest go, in this order of priority, to the
 * practise slide, the hinge, the opening, then a check after each objective but the last (the
 * hinge checks the last). Checks that do not fit are left to code (`checksToInsert`), as in the
 * baseline.
 */
export function skeleton(rows: number, r1: Pick<Round1, "objectives" | "opening">): SkeletonSlot[] {
  const k = Math.min(r1.objectives, rows);
  const teach = Math.max(k, Math.min(rows, teachCount(rows)));
  let spare = rows - teach;
  const take = () => (spare > 0 ? (spare--, true) : false);
  const practise = take();
  const hinge = take();
  const opening = take();
  const checks = Array.from({ length: k }, (_, i) => i < k - 1 && take());
  const perObjective = Array.from(
    { length: k },
    (_, i) => Math.floor(teach / k) + (i < teach % k ? 1 : 0),
  );
  const roles: Omit<SkeletonSlot, "slide">[] = [];
  if (opening) roles.push({ role: r1.opening, objective: null });
  perObjective.forEach((t, i) => {
    for (let j = 0; j < t; j++) roles.push({ role: "teach", objective: i + 1 });
    if (checks[i]) roles.push({ role: "check", objective: i + 1 });
  });
  if (hinge) roles.push({ role: "hinge", objective: k });
  if (practise) roles.push({ role: "practise", objective: k });
  // Spare rows left over (none with the counts above) teach the last objective.
  while (roles.length < rows)
    roles.splice(roles.length - (practise ? 1 : 0) - (hinge ? 1 : 0), 0, {
      role: "teach",
      objective: k,
    });
  return roles.slice(0, rows).map((r, i) => ({ ...r, slide: i + 3 }));
}

/* --------------------------------------------------------------- round 2 */

const TEACH_FORMS: Record<string, string> = {
  explain: "explain: one claim or definition, said plainly",
  "explain-callout":
    "explain with a callout: a claim pupils commonly get wrong, with the mistake named beside it",
  list: "list: a set of parallel things: parts, types, causes or factors",
  compare: "compare: two things set side by side to show how they differ",
  sequence: "sequence: a process or method whose order matters, as written steps",
  "worked-example":
    "worked example: a procedure or chain of reasoning shown once, step by step, before pupils try it",
  photo: "photo: a real, concrete thing, place, specimen or event pupils may never have seen",
  "diagram-slot":
    "diagram: an idea with a shape: a process, cycle, structure, cross-section, timeline, graph or layout",
  figure:
    "figure: a maths or chemistry structure drawn from a template (bar model, number line, particle diagram)",
};
const PICTURED = new Set(["photo", "diagram-slot", "figure"]);

const CHECK_FORMS: Record<string, string> = {
  "check-set":
    "quick questions: two or three short questions on what was just taught, answers revealed",
  hinge: "multiple choice: one question whose wrong options each reveal a known misconception",
  "true-false": "true or false: confronting one misconception head on",
  matching: "matching: linking terms, pictures or examples to their meanings",
  "fill-gap": "fill the gap: recalling a key term inside a sentence that uses it",
  sort: "sort into order: putting the steps of a sequence just taught in order",
  "open-response": "open response: one question answered in the pupils' own sentences",
};

const OPENING_FORMS: Record<Role, Record<string, string>> = {
  retrieve: {
    "starter-set":
      "quick questions: three short recall questions on earlier learning, answers revealed",
    matching: "matching: linking earlier terms to their meanings",
    "true-false": "true or false: statements about earlier learning to judge",
    "fill-gap": "fill the gap: earlier key terms recalled inside sentences",
  },
  hook: {
    photo: "photo: a striking real image with a question about it",
    discussion: "discussion: an open question pupils can argue about before they are taught",
    "open-response":
      "open response: a puzzle or prediction pupils write down before they are taught",
  },
  teach: {},
  check: {},
  hinge: {},
  practise: {},
};

const pick = (criteria: Record<string, string>, forms: readonly string[]) =>
  Object.fromEntries(Object.entries(criteria).filter(([f]) => forms.includes(f)));

export const describeSkeleton = (slots: SkeletonSlot[], r1: Round1) =>
  slots
    .map((s) => {
      if (s.role === "teach") {
        const same = slots.filter((x) => x.role === "teach" && x.objective === s.objective);
        return `slide ${s.slide}: teach objective ${s.objective} (${same.indexOf(s) + 1} of ${same.length})`;
      }
      if (s.role === "practise") return `slide ${s.slide}: practise (${r1.practice})`;
      return `slide ${s.slide}: ${s.role}${s.objective ? ` objective ${s.objective}` : ""}`;
    })
    .join("; ");

export function round2Questions(
  ctx: StructureContext,
  slots: SkeletonSlot[],
  r1: Round1,
): Record<string, Question> {
  const q: Record<string, Question> = {};
  const isMaths = /math|chem/i.test(ctx.subject);
  const teachForms = pick(
    TEACH_FORMS,
    ctx.forms.filter((f) => f !== "figure" || isMaths),
  );
  for (const s of slots) {
    if (s.role === "teach") {
      const same = slots.filter((x) => x.role === "teach" && x.objective === s.objective);
      q[`s${s.slide}`] = {
        type: "choice",
        instructions: `Slide ${s.slide} is teach slide ${same.indexOf(s) + 1} of ${same.length} for objective ${s.objective} of ${r1.objectives}, in a lesson on "${ctx.topic}". Which form shows its idea best?`,
        criteria: teachForms,
      };
    } else if (s.role === "check") {
      q[`s${s.slide}`] = {
        type: "choice",
        instructions: `Slide ${s.slide} checks objective ${s.objective} just after its teaching. Which form of check suits these pupils and this content?`,
        criteria: pick(CHECK_FORMS, [...ctx.forms, "check-set"]),
      };
    } else if (s.role === "retrieve" || s.role === "hook") {
      q[`s${s.slide}`] = {
        type: "choice",
        instructions: `Slide ${s.slide} opens the lesson as a ${s.role}. Which form suits these pupils?`,
        criteria: pick(OPENING_FORMS[s.role], [...ctx.forms, "starter-set"]),
      };
    }
  }
  return q;
}

/* --------------------------------------------------------------- assemble (code) */

export const LessonStructureSchema = z.object({
  version: z.literal(STRUCTURE_QUESTIONS_VERSION),
  model: z.string(),
  objectives: z.number().int().min(1).max(3),
  visuality: z.object({ level: z.enum(VISUALITY), score: z.number(), pictureShare: z.number() }),
  examStyle: z.boolean(),
  marks: z.number().int().nullable(),
  responseMode: z.enum(["whiteboards", "books", "talk"]),
  practice: z.enum(["items", "discussion", "extended"]),
  method: z.boolean(),
  slots: z
    .array(
      z.object({
        slide: z.number().int().min(3),
        role: z.enum(ROLES),
        objective: z.number().int().min(1).nullable(),
        form: z.string(),
        pictured: z.boolean(),
        examItem: z.object({ marks: z.number().int() }).optional(),
      }),
    )
    .min(1),
});
export type LessonStructure = z.infer<typeof LessonStructureSchema>;

const ranked = (a: Answer | undefined, allowed: readonly string[]): string[] => {
  const p = a?.type === "choice" ? a.probabilities : {};
  return [...allowed].sort((x, y) => (p[y] ?? 0) - (p[x] ?? 0));
};

const PRACTICE_FORM = {
  items: "list",
  discussion: "discussion",
  extended: "open-response",
} as const;

export function assemble(
  ctx: StructureContext,
  slots: SkeletonSlot[],
  r1: Round1,
  a2: Record<string, Answer>,
  model: string,
): LessonStructure {
  const isMaths = /math|chem/i.test(ctx.subject);
  const teachAllowed = Object.keys(
    pick(
      TEACH_FORMS,
      ctx.forms.filter((f) => f !== "figure" || isMaths),
    ),
  );
  const share = PICTURE_SHARE[Math.round(r1.visualityScore)] ?? 0.5;
  const teach = slots.filter((s) => s.role === "teach");
  const pPic = (s: SkeletonSlot) => {
    const a = a2[`s${s.slide}`];
    return a?.type === "choice"
      ? [...PICTURED].reduce((t, f) => t + (a.probabilities[f] ?? 0), 0)
      : 0;
  };
  // Picture share from visuality: the teach slots most likely to be pictured take the pictures.
  const nPic = Math.round(share * teach.length);
  const pictured = new Set(
    [...teach]
      .sort((x, y) => pPic(y) - pPic(x))
      .slice(0, nPic)
      .map((s) => s.slide),
  );
  const form = new Map<number, string>();
  for (const s of teach) {
    const order = ranked(a2[`s${s.slide}`], teachAllowed);
    const want = pictured.has(s.slide);
    form.set(
      s.slide,
      order.find((f) => PICTURED.has(f) === want && f !== "worked-example") ??
        order[0] ??
        "explain",
    );
  }
  // A method topic: one worked example per objective, on its likeliest unpictured teach slot (the
  // last one when none is unpictured).
  if (r1.method)
    for (let k = 1; k <= r1.objectives; k++) {
      const own = teach.filter((s) => s.objective === k);
      if (own.length === 0 || own.some((s) => form.get(s.slide) === "worked-example")) continue;
      const pWx = (s: SkeletonSlot) => {
        const a = a2[`s${s.slide}`];
        return a?.type === "choice" ? (a.probabilities["worked-example"] ?? 0) : 0;
      };
      const plain = own.filter((s) => !pictured.has(s.slide));
      const at = (plain.length ? plain : own.slice(-1)).sort((x, y) => pWx(y) - pWx(x))[0];
      if (at && teachAllowed.includes("worked-example")) {
        form.set(at.slide, "worked-example");
        pictured.delete(at.slide);
      }
    }
  // No three teach slides of one form in a row: the third takes its next likeliest of the same kind.
  for (let i = 2; i < teach.length; i++) {
    const a = teach[i - 2];
    const b = teach[i - 1];
    const c = teach[i];
    if (!a || !b || !c) continue;
    const f = form.get(c.slide);
    if (f && f === form.get(a.slide) && f === form.get(b.slide) && f !== "worked-example") {
      const alt = ranked(a2[`s${c.slide}`], teachAllowed).find(
        (x) => x !== f && x !== "worked-example" && PICTURED.has(x) === pictured.has(c.slide),
      );
      if (alt) form.set(c.slide, alt);
    }
  }
  // Checks and the opening: likeliest form, never the previous check's form.
  let lastCheck = "";
  for (const s of slots) {
    if (s.role === "check" || s.role === "retrieve" || s.role === "hook") {
      const allowed = Object.keys(
        s.role === "check"
          ? pick(CHECK_FORMS, [...ctx.forms, "check-set"])
          : pick(OPENING_FORMS[s.role], [...ctx.forms, "starter-set"]),
      );
      const order = ranked(a2[`s${s.slide}`], allowed);
      const f =
        (s.role === "check" ? order.find((x) => x !== lastCheck) : order[0]) ??
        order[0] ??
        "check-set";
      form.set(s.slide, f);
      if (s.role === "check") lastCheck = f;
    }
    if (s.role === "hinge") form.set(s.slide, "hinge");
    if (s.role === "practise") form.set(s.slide, PRACTICE_FORM[r1.practice]);
  }
  return LessonStructureSchema.parse({
    version: STRUCTURE_QUESTIONS_VERSION,
    model,
    objectives: r1.objectives,
    visuality: { level: r1.visuality, score: r1.visualityScore, pictureShare: share },
    examStyle: r1.examStyle,
    marks: r1.examStyle ? r1.marks : null,
    responseMode: r1.responseMode,
    practice: r1.practice,
    method: r1.method,
    slots: slots.map((s) => {
      const f = form.get(s.slide) ?? "explain";
      return {
        ...s,
        form: f,
        pictured: PICTURED.has(f) || (s.role === "hook" && f === "photo"),
        ...(r1.examStyle && s.role === "practise" && r1.practice !== "discussion"
          ? { examItem: { marks: r1.marks } }
          : {}),
      };
    }),
  });
}

/* --------------------------------------------------------------- run */

export type StructureRun = {
  structure: LessonStructure;
  /** Wall time of both rounds, the code between them included. */
  ms: number;
  calls: {
    round: 1 | 2;
    ms: number;
    costUsd: number | null;
    inputTokens: number | null;
    questions: number;
  }[];
  costUsd: number;
  round1: Round1;
};

export async function decideStructure(
  ctx: StructureContext,
  evaluate: Evaluator,
  model: string,
): Promise<StructureRun> {
  const t0 = Date.now();
  const state = stateOf(ctx);
  const q1 = round1Questions();
  const c1 = await evaluate(state, q1);
  const r1 = readRound1(c1.answers, ctx);
  const slots = skeleton(ctx.rows, r1);
  const q2 = round2Questions(ctx, slots, r1);
  const state2 = {
    ...state,
    decided: {
      objectives: r1.objectives,
      visuality: r1.visuality,
      method: r1.method,
      examStyle: r1.examStyle,
      practice: r1.practice,
    },
    slides: describeSkeleton(slots, r1),
  };
  const c2 = await evaluate(state2, q2);
  const structure = assemble(ctx, slots, r1, c2.answers, model);
  return {
    structure,
    ms: Date.now() - t0,
    calls: [
      {
        round: 1,
        ms: c1.ms,
        costUsd: c1.costUsd,
        inputTokens: c1.inputTokens,
        questions: Object.keys(q1).length,
      },
      {
        round: 2,
        ms: c2.ms,
        costUsd: c2.costUsd,
        inputTokens: c2.inputTokens,
        questions: Object.keys(q2).length,
      },
    ],
    costUsd: (c1.costUsd ?? 0) + (c2.costUsd ?? 0),
    round1: r1,
  };
}

/* --------------------------------------------------------------- the writer's block (prompt) */

const HOW = {
  whiteboards: "on their mini whiteboards",
  books: "in their books",
  talk: "by talking to a partner",
} as const;

/**
 * stream-structure.v1: appended to the stream's user turn. It names the decisions as fixed and
 * says which of the plan rules' own choices it replaces, so the two do not contradict; the rest of
 * each row stays the writer's.
 */
export function structureBlock(s: LessonStructure, yearGroup: string): string {
  const year = yearOf(yearGroup);
  const lines = [
    "",
    "Structure, decided before you plan. It replaces your own choice of the number of objectives and of each row's role, objective and form; every other rule holds.",
    `Objectives: exactly ${s.objectives}.`,
    "Rows, in order (slide: role, objective, form):",
    ...s.slots.map((r) => `${r.slide}: ${r.role}, ${r.objective ?? "-"}, ${r.form}`),
    "Keep each row's role, objective and form; its layout, parts, aim, teaches and tests are yours.",
  ];
  if (s.examStyle && s.marks)
    lines.push(
      `Exam-style: the practise slide's items are exam questions in the exam's command words, each ending with its marks in brackets, such as "[${s.marks} marks]"; its notes give the mark scheme.`,
    );
  lines.push(
    `A check or practise slide's task line says how pupils answer: ${HOW[s.responseMode]}.`,
  );
  if (year <= 4) lines.push("Every multiple-choice question has 3 options.");
  return lines.join("\n");
}
