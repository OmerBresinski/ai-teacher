import { type Answer, type Evaluator, keyStageOf, type Question, yearOf } from "./lab-structure";

/*
 * structure-questions.v3 (TEACH-179, decision loop; lab only). Changes from v2 (Greg, 2 Oct: "I don't
 * like a hard variety rule I want what fits best"):
 * - No quota or variety code: no picture share, no forced worked example, no "not the same form twice".
 *   Visuality is part of every slot's state, not a quota. Code keeps only ruling-level constraints (exam
 *   style from Year 10, rulings 146/147), the fixed slide count, and a drawable mapping per choice.
 * - A rich state: year, key stage, age, subject, topic, difficulty, minutes, the confirmed objectives
 *   with their key ideas, the misconception and prior knowledge, plus optional steering fields (empty
 *   for now: teacher response mode, exit on slides, visuality adjustment, past choices).
 * - Round 2 asks per slot with the idea that slot teaches or checks.
 * - A wider menu of intents, each with a when-to-use line; intents with no form yet map to the nearest
 *   drawable form and are flagged (`wanted`), so the plan shows demand for new forms.
 * - New decisions: teaching slides per objective, where the misconception is confronted, interleaved
 *   practice, a response mode per activity.
 */

/*
 * structure-questions.v4 (from v3; J8 v3 beat v2 12-0). Changes, all through descriptions and context,
 * no quotas: per-idea slide decisions (share, one, two) replace per-objective slide scores, so no slot
 * repeats an idea and objectives that need room get it; "interleave" (true 12/12) becomes a graded
 * "revisit" score; worked example is described as a procedure pupils carry out (history reasoning goes
 * to artefact or text-extract, English to model-text); guided practice for a second slide on a method;
 * exam context and visuality named in the state and in every slot question; the hook's idea is the
 * lesson's question, not the prior-knowledge list.
 */
/*
 * structure-questions.v5 (from v4; J8 v4 6 - v3 3 - 3 ties, v3 winning the method topics). Changes,
 * through descriptions and context, no quotas: each objective's teaching room comes from a "how much
 * teaching and modelling" score that names difficulty and dependency (foundational objectives get
 * more), and the per-idea answers fit inside it; "share" says two separate methods never share a slide;
 * short lessons ask Jev what gives way first (opening, hinge, or two linked objectives sharing a
 * teaching slide), with practice kept and every objective taught (ruling-level, Greg 30 Sep).
 */
export const STRUCTURE_V3_VERSION = "structure-questions.v5";

export type Steering = {
  /** The teacher's lesson response mode (ruling 143), when set. */
  responseMode?: "whiteboards" | "books" | "devices" | "talk";
  /** Ruling 141: the exit ticket on slides as well as the worksheet. */
  exitOnSlides?: boolean;
  /** A teacher's "more visual" / "less visual" request: -1, 0 or +1. */
  visualityAdjust?: -1 | 0 | 1;
  /** Past choices for this teacher, as short lines. */
  pastChoices?: string[];
};

export type ObjectiveIn = { text: string; keyIdeas: string[] };

export type ContextV3 = {
  topic: string;
  subject: string;
  yearGroup: string;
  minutes: number;
  difficulty?: string;
  objectives: ObjectiveIn[];
  misconception: string;
  priorKnowledge: string[];
  /** Rows to plan after the title and objectives slides (and before the code-built closing slide). */
  rows: number;
  steering?: Steering;
};

/* --------------------------------------------------------------- menu */

/** An intent: what the slot does, when to use it, and the palette form that draws it today. */
type Intent = {
  when: string;
  form: string;
  wanted?: string;
  pictured?: boolean;
  minYear?: number;
  subjects?: RegExp;
};

export const TEACH_INTENTS: Record<string, Intent> = {
  explain: {
    when: "one claim or definition said plainly, with its case, when nothing about it is better shown, modelled or set side by side",
    form: "explain",
  },
  "explain-mistake": {
    when: "an idea pupils commonly get wrong, with the mistake named beside it",
    form: "explain-callout",
  },
  list: {
    when: "a set of parallel things: parts, types, causes, effects or factors",
    form: "list",
  },
  compare: { when: "two things, groups, periods or views set side by side", form: "compare" },
  sequence: {
    when: "a process, method or chain of events whose order matters, as written steps",
    form: "sequence",
  },
  "worked-example": {
    when: "the first time pupils meet a method they will carry out themselves (a calculation, applying a rule to predict an outcome, a grammar rule), modelled step by step with the reasoning for each step; its working can include a bar model, number line or diagram",
    form: "worked-example",
  },
  photo: {
    when: "a real thing, place, specimen or event pupils need to see to understand the idea",
    form: "photo",
    pictured: true,
  },
  diagram: {
    when: "an idea with a physical or visual shape: a process, cycle, structure, cross-section, timeline, graph or map",
    form: "diagram-slot",
    pictured: true,
  },
  figure: {
    when: "a maths or chemistry structure a template draws: bar model, number line, particle or bonding diagram",
    form: "figure",
    pictured: true,
    subjects: /math|chem/i,
  },
  vocabulary: {
    when: "several key terms the rest of the lesson depends on, introduced together",
    form: "vocabulary",
  },
  artefact: {
    when: "an object, remains, building or site from the past, or a real specimen, pupils examine as evidence and reason from",
    form: "photo",
    pictured: true,
  },
  "text-extract": {
    when: "a quotation, poem or play extract, or written source pupils read closely and reason from",
    form: "explain",
    wanted: "text extract slide",
  },
  "model-text": {
    when: "an annotated model answer, paragraph or speech extract showing the technique pupils will then use in their own writing",
    form: "explain",
    wanted: "annotated model text",
  },
  "guided-practice": {
    when: "pupils try the method just modelled with the teacher, one or two questions answered together, before working alone",
    form: "list",
    wanted: "guided practice (we do)",
  },
  discussion: {
    when: "pupils reason together about the idea before it is stated, from a question or case",
    form: "discussion",
  },
};

export const CHECK_INTENTS: Record<string, Intent> = {
  "quick-questions": {
    when: "two or three short recall questions on what was just taught",
    form: "check-set",
  },
  "multiple-choice": {
    when: "one question whose wrong options are the mistakes pupils really make",
    form: "hinge",
  },
  "true-false": {
    when: "statements to judge, confronting a misconception head on",
    form: "true-false",
  },
  "match-terms": { when: "linking terms to their meanings or examples", form: "matching" },
  "match-pictures": {
    when: "matching pictures to names or meanings, for young pupils or content that can be pictured",
    form: "matching",
    wanted: "picture matching",
  },
  "label-diagram": {
    when: "labelling the parts of a diagram or picture just taught",
    form: "fill-gap",
    wanted: "label a diagram",
  },
  "fill-gap": { when: "recalling a key term inside a sentence that uses it", form: "fill-gap" },
  order: { when: "putting the steps or events just taught in order", form: "sort" },
  "spot-mistake": {
    when: "a worked answer or claim with an error pupils find and correct",
    form: "open-response",
    wanted: "spot the mistake",
  },
  "odd-one-out": {
    when: "choosing the item that does not belong and saying why",
    form: "open-response",
    wanted: "odd one out",
  },
  "short-answer": {
    when: "one question answered in the pupils' own sentences",
    form: "open-response",
  },
  "exam-question": {
    when: "an exam-style question with its command word and marks",
    form: "open-response",
    wanted: "exam question with marks",
    minYear: 10,
  },
  discussion: {
    when: "a question with more than one defensible answer, argued in pairs",
    form: "discussion",
  },
};

export const OPENING_INTENTS: Record<string, Intent> = {
  "quick-questions": {
    when: "short recall questions on earlier learning this lesson builds on",
    form: "starter-set",
  },
  "match-terms": { when: "linking earlier terms to their meanings", form: "matching" },
  "odd-one-out": {
    when: "spotting which earlier item does not belong, and why",
    form: "open-response",
    wanted: "odd one out",
  },
  "picture-hook": {
    when: "a striking real image with a question about it, for a topic new to the class",
    form: "photo",
    pictured: true,
  },
  "question-hook": {
    when: "a puzzling question or case pupils argue about before they are taught",
    form: "discussion",
  },
  prediction: {
    when: "pupils write a prediction or first answer they revisit at the end",
    form: "open-response",
  },
};

export const PRACTICE_INTENTS: Record<string, Intent> = {
  items: {
    when: "a set of new questions that step up in difficulty, answered alone (for a class sitting an exam in this subject, exam-questions usually fit better)",
    form: "list",
  },
  "exam-questions": {
    when: "exam-style questions with command words and marks, answered alone",
    form: "list",
    wanted: "marks shown",
    minYear: 10,
  },
  extended: {
    when: "one longer written answer, such as a paragraph or an essay plan",
    form: "open-response",
  },
  discussion: {
    when: "a question with more than one defensible answer, argued in pairs or as a class",
    form: "discussion",
  },
  "label-or-sort": {
    when: "pupils in Years 1 to 6 sort, match or label pictures on their own",
    form: "matching",
    wanted: "picture matching",
  },
};

const RESPONSE: Record<string, string> = {
  whiteboards: "mini whiteboards: short answers held up at once so the teacher sees every pupil",
  books: "books: written answers kept, for working or full sentences",
  talk: "talk: spoken answers to a partner or the class",
};

const usable = (menu: Record<string, Intent>, c: ContextV3) => {
  const y = yearOf(c.yearGroup);
  return Object.fromEntries(
    Object.entries(menu)
      .filter(([, i]) => (i.minYear ?? 0) <= y && (!i.subjects || i.subjects.test(c.subject)))
      .map(([k, i]) => [k, `${k}: ${i.when}`]),
  );
};

/* --------------------------------------------------------------- state */

export function stateV3(c: ContextV3): string {
  const y = yearOf(c.yearGroup);
  const lines = [
    `A ${c.minutes}-minute lesson in a UK school for ${c.yearGroup} pupils (${keyStageOf(y)}, aged ${y + 4} to ${y + 5}), in ${c.subject}, on: ${c.topic}.`,
    c.difficulty ? `Difficulty: ${c.difficulty}.` : "",
    `Pupils already know: ${c.priorKnowledge.length ? c.priorKnowledge.join("; ") : "not stated"}.`,
    "Objectives and their key ideas:",
    ...c.objectives.map(
      (o, i) =>
        `${i + 1}. ${o.text} Key ideas: ${o.keyIdeas.join("; ") || "as the objective states"}.`,
    ),
    `The misconception that matters most: ${c.misconception}`,
    y >= 12
      ? `These pupils sit A level in ${c.subject}; exam practice uses its command words and marks.`
      : y >= 10
        ? `These pupils sit GCSE in ${c.subject}; exam practice uses its command words and marks.`
        : "These pupils sit no public exam this year.",
    `There are ${c.rows} slides to plan after the title and objectives slides.`,
  ];
  const s = c.steering ?? {};
  if (s.responseMode) lines.push(`The teacher has set the response mode: ${s.responseMode}.`);
  if (s.exitOnSlides !== undefined)
    lines.push(`Exit ticket on the slides: ${s.exitOnSlides ? "yes" : "no"}.`);
  if (s.visualityAdjust)
    lines.push(
      `The teacher asked for ${s.visualityAdjust > 0 ? "more" : "fewer"} pictures than usual.`,
    );
  if (s.pastChoices?.length)
    lines.push(`This teacher's past choices: ${s.pastChoices.join("; ")}.`);
  return lines.filter(Boolean).join("\n");
}

/* --------------------------------------------------------------- round 1 */

export function round1V3(c: ContextV3): Record<string, Question> {
  const y = yearOf(c.yearGroup);
  const q: Record<string, Question> = {
    visuality: {
      type: "score",
      instructions:
        "How much should this lesson's teaching lean on photographs and diagrams, for this age, subject and these ideas?",
      criteria: [
        "low: the ideas are arguments, texts or abstract rules; words carry them",
        "medium: some ideas are things, places or structures worth showing",
        "high: most ideas are concrete things, processes or structures that are clearer when shown",
        "very high: young pupils, and nearly everything taught can be shown",
      ],
    },
    opening: {
      type: "choice",
      instructions: "How should this lesson open?",
      criteria: {
        retrieve: "retrieve: recall of the earlier learning listed, which this lesson builds on",
        hook: "hook: a puzzling question, case or picture, because the topic is new and builds on little",
      },
    },
    misconception: {
      type: "choice",
      instructions: "Where should the lesson confront the misconception?",
      criteria: {
        opening: "opening: raise it at the start so pupils commit to it, then overturn it",
        ...Object.fromEntries(
          c.objectives.map((o, i) => [
            `o${i + 1}`,
            `o${i + 1}: while teaching objective ${i + 1} (${o.text})`,
          ]),
        ),
        hinge: "hinge: test it in the hinge question before pupils work alone",
      },
    },
    revisit: {
      type: "score",
      instructions:
        "How much of the practice should revisit learning from earlier lessons, rather than this lesson's new ideas?",
      criteria: [
        "none: today's ideas are new and not yet secure, so practice consolidates them only",
        "a little: one item links back to earlier learning this lesson builds on",
        "a lot: pupils already partly know this and mixing earlier methods or topics builds fluency",
      ],
    },
    practice: {
      type: "choice",
      instructions: "What should pupils do in the practice, where they work without the teacher?",
      criteria: usable(PRACTICE_INTENTS, c),
    },
    responseMode: {
      type: "choice",
      instructions: "How should pupils of this age usually answer during this lesson?",
      criteria: RESPONSE,
    },
  };
  if (y >= 10) {
    q.examStyle = {
      type: "boolean",
      instructions:
        "Is this topic examined at GCSE or A level with marked questions, so practice should look like the exam?",
      criteria: {
        true: "examined with marked, command-word questions",
        false: "not examined that way",
      },
    };
    q.marks = {
      type: "score",
      instructions: "How many marks would a typical exam question on these objectives carry?",
      criteria: ["1 to 2 marks", "3 to 4 marks", "6 marks", "8 to 12 marks"],
    };
  }
  const k = c.objectives.length;
  c.objectives.forEach((o, i) => {
    q[`o${i + 1}_need`] = {
      type: "score",
      instructions: `How much teaching and modelling does objective ${i + 1} need in this lesson: ${o.text}?`,
      criteria: [
        "light: familiar or simple for these pupils; a short explanation is enough",
        "standard: new but straightforward; teach it with its case",
        "heavy: hard for these pupils, or foundational: later objectives in this lesson build on it, so it needs teaching and a model",
        "heaviest: the lesson's core method or idea, hard and foundational; it needs teaching, a worked model and a second case",
      ],
    };
  });
  if (c.rows - 3 < k)
    q.short = {
      type: "choice",
      instructions: `This lesson has only ${c.rows} slides between the objectives slide and the exit ticket for ${k} objectives and a practice. What should give way first? The practice stays and every objective is still taught.`,
      criteria: {
        opening: "opening: start straight into teaching, with no opening slide",
        hinge: "hinge: no hinge question; the practice checks the last objective",
        ...Object.fromEntries(
          c.objectives
            .slice(1)
            .map((_, i) => [
              `o${i + 1}+o${i + 2}`,
              `o${i + 1}+o${i + 2}: objectives ${i + 1} and ${i + 2} are closely linked, so one teaching slide covers both`,
            ]),
        ),
      },
    };
  c.objectives.forEach((o, i) => {
    const ideas = o.keyIdeas.length ? o.keyIdeas : [o.text];
    ideas.forEach((idea, j) => {
      q[`i${i + 1}_${j + 1}`] = {
        type: "choice",
        instructions: `Objective ${i + 1} (${o.text}), idea ${j + 1} of ${ideas.length}: ${idea}. How much slide room does this idea need?`,
        criteria: {
          ...(j > 0
            ? {
                share:
                  "share: a small step that follows directly from the idea before and is not a separate method, so the two share one slide (two separate methods never fit on one slide)",
              }
            : {}),
          one: "one: one slide teaches it",
          two: "two: it needs a second slide, because pupils must carry out a method or reason through it after it is taught",
        },
      };
    });
  });
  return q;
}

export type R1V3 = {
  answers: Record<string, Answer>;
  visuality: string;
  opening: "retrieve" | "hook";
  misconception: string;
  revisit: string;
  practice: string;
  responseMode: string;
  examStyle: boolean;
  marks: number | null;
  ideas: { objective: number; text: string; want: number; p: Record<string, number> }[];
  /** Teaching need per objective, 0 (light) to 3 (heaviest). */
  needs: number[];
  /** Short lessons: what gives way, in Jev's order of preference. */
  cuts: string[];
};

const choice = (a: Answer | undefined, f: string) => (a?.type === "choice" ? a.choice : f);
const score = (a: Answer | undefined, top: number, f: number) =>
  a?.type === "score" && Number.isFinite(a.score) ? Math.max(0, Math.min(top, a.score)) : f;

export function readR1V3(a: Record<string, Answer>, c: ContextV3): R1V3 {
  const y = yearOf(c.yearGroup);
  const vis = ["low", "medium", "high", "very high"];
  const exam = y >= 10 && a.examStyle?.type === "boolean" && a.examStyle.probability >= 0.5;
  return {
    answers: a,
    visuality: vis[Math.round(score(a.visuality, 3, 1.5))] ?? "medium",
    opening: choice(a.opening, "retrieve") as R1V3["opening"],
    misconception: choice(a.misconception, "o1"),
    revisit: ["none", "a little", "a lot"][Math.round(score(a.revisit, 2, 0))] ?? "none",
    practice: choice(a.practice, "items"),
    responseMode: c.steering?.responseMode ?? choice(a.responseMode, "books"),
    examStyle: exam,
    marks: exam ? ([2, 4, 6, 9][Math.round(score(a.marks, 3, 1))] ?? 4) : null,
    needs: c.objectives.map((_, i) => score(a[`o${i + 1}_need`], 3, 1)),
    cuts: (() => {
      const sh = a.short;
      const pairs = c.objectives.slice(1).map((_, i) => `o${i + 1}+o${i + 2}`);
      const ranked =
        sh?.type === "choice"
          ? Object.entries(sh.probabilities)
              .sort((x, y) => y[1] - x[1])
              .map(([key]) => key)
          : [];
      return [...new Set([...ranked, "opening", "hinge", ...pairs])];
    })(),
    ideas: c.objectives.flatMap((o, i) =>
      (o.keyIdeas.length ? o.keyIdeas : [o.text]).map((text, j) => {
        const ans = a[`i${i + 1}_${j + 1}`];
        const p = ans?.type === "choice" ? ans.probabilities : { one: 1 };
        const ch = ans?.type === "choice" ? ans.choice : "one";
        return { objective: i + 1, text, want: ch === "share" ? 0 : ch === "two" ? 2 : 1, p };
      }),
    ),
  };
}

/* --------------------------------------------------------------- skeleton (fixed slide count only) */

export type SlotV3 = {
  slide: number;
  role: "retrieve" | "hook" | "teach" | "check" | "hinge" | "practise";
  objective: number | null;
  /** The idea the slot teaches or checks, from the objective's key ideas. */
  idea: string;
};

/**
 * Non-teaching slots: the practice, the hinge, an opening, and a check after every objective but the
 * last (the hinge checks the last); they give way in reverse order when slides are short. The teaching
 * slides left are shared out in proportion to Jev's slides-per-objective answers (largest remainder,
 * at least one each). This is arithmetic on the fixed slide count, not a quota on forms.
 */
export function skeletonV3(c: ContextV3, r1: R1V3): SlotV3[] {
  const k = c.objectives.length;
  // The checks after each objective but the last are extra slides, as the candidate's code inserts
  // them (checksToInsert); the fixed rows hold the opening, the teaching, the hinge and the practice.
  const extras = { practise: 1, hinge: 1, opening: 1, checks: Math.max(0, k - 1) };
  // Short lessons: what gives way follows Jev's own order (opening, hinge, or two linked objectives
  // sharing a teaching slide); the practice always stays and every objective is still taught.
  const merged = new Map<number, number>();
  const fixed = () => extras.practise + extras.hinge + extras.opening;
  for (const cut of r1.cuts) {
    if (c.rows - fixed() >= k - merged.size) break;
    if (cut === "opening") extras.opening = 0;
    else if (cut === "hinge") extras.hinge = 0;
    else {
      const m = /^o(\d+)\+o(\d+)$/.exec(cut);
      const a = Number(m?.[1]);
      const b = Number(m?.[2]);
      if (m && !merged.has(b)) merged.set(b, merged.get(a) ?? a);
    }
  }
  const lead = c.objectives.map((_, i) => i + 1).filter((o) => !merged.has(o));
  extras.checks = Math.max(0, lead.length - 1);
  const teach = Math.max(lead.length, c.rows - fixed());
  // Teaching room per objective from Jev's need score (difficulty and dependency), shared by largest
  // remainder, at least one each; then each objective's ideas fit inside its room by their own
  // share / one / two probabilities.
  const weight = (o: number) => 1 + (r1.needs[o - 1] ?? 1);
  const w = lead.map(
    (o) =>
      weight(o) +
      [...merged].filter(([, to]) => to === o).reduce((t, [from]) => t + weight(from), 0),
  );
  const tot = w.reduce((x, y) => x + y, 0);
  const raw = w.map((x) => (x / tot) * teach);
  const budget = raw.map((x) => Math.max(1, Math.floor(x)));
  let left = teach - budget.reduce((x, y) => x + y, 0);
  const order = raw.map((x, i) => [x - Math.floor(x), i] as const).sort((x, y) => y[0] - x[0]);
  for (let j = 0; left > 0; j = (j + 1) % order.length, left--) {
    const at = order[j]?.[1] ?? 0;
    budget[at] = (budget[at] ?? 0) + 1;
  }
  while (budget.reduce((x, y) => x + y, 0) > teach) {
    const i = budget.indexOf(Math.max(...budget));
    budget[i] = (budget[i] ?? 1) - 1;
  }
  const ideas = r1.ideas.map((x, n) => ({
    ...x,
    n,
    slides: x.want,
    group: merged.get(x.objective) ?? x.objective,
  }));
  lead.forEach((g, gi) => {
    const own = ideas.filter((x) => x.group === g);
    if (own[0] && own[0].slides === 0) own[0].slides = 1;
    const room = budget[gi] ?? 1;
    const sum = () => own.reduce((t, x) => t + x.slides, 0);
    while (sum() > room) {
      const cut = own
        .filter((x, i) => x.slides > (i === 0 ? 1 : 0))
        .sort(
          (a, b) =>
            b.slides - a.slides ||
            (b.p.share ?? 0) - (a.p.share ?? 0) ||
            (a.p.two ?? 0) - (b.p.two ?? 0),
        )[0];
      if (!cut) break;
      cut.slides--;
    }
    while (sum() < room) {
      const add = [...own].sort(
        (a, b) => a.slides - b.slides || (b.p.two ?? 0) - (a.p.two ?? 0),
      )[0];
      if (!add) break;
      add.slides++;
    }
  });
  const slots: Omit<SlotV3, "slide">[] = [];
  if (extras.opening)
    slots.push({
      role: r1.opening,
      objective: null,
      idea:
        r1.opening === "hook"
          ? `the lesson's question about ${c.topic}`
          : c.priorKnowledge.join("; ") || "earlier learning",
    });
  lead.forEach((g, gi) => {
    const own = ideas.filter((x) => x.group === g);
    let last: Omit<SlotV3, "slide"> | undefined;
    for (const x0 of own) {
      const x = {
        ...x0,
        text: x0.objective === g ? x0.text : `objective ${x0.objective}: ${x0.text}`,
      };
      if (x.slides === 0 && last) {
        last.idea = `${last.idea}; ${x.text}`;
        continue;
      }
      for (let r = 0; r < x.slides; r++) {
        last = {
          role: "teach",
          objective: g,
          idea:
            r === 0
              ? x.text
              : `${x.text} (slide ${r + 1} on this idea: pupils carry it out or reason through it)`,
        };
        slots.push(last);
      }
    }
    if (gi < lead.length - 1)
      slots.push({ role: "check", objective: g, idea: own.map((x) => x.text).join("; ") });
  });
  if (extras.hinge)
    slots.push({
      role: "hinge",
      objective: k,
      idea: c.objectives[k - 1]?.keyIdeas.join("; ") ?? "",
    });
  if (extras.practise)
    slots.push({
      role: "practise",
      objective: k,
      idea: `all the objectives${r1.revisit === "none" ? "" : `, revisiting earlier learning (${r1.revisit})`}`,
    });
  return slots.slice(0, c.rows + extras.checks).map((s, i) => ({ ...s, slide: i + 3 }));
}

/* --------------------------------------------------------------- round 2 */

/** A second slide on one idea has its own job: pupils carry the idea out, or meet a harder case. */
const SECOND_SLIDE = [
  "guided-practice",
  "worked-example",
  "compare",
  "explain-mistake",
  "diagram",
  "figure",
  "discussion",
];

export function round2V3(
  c: ContextV3,
  slots: SlotV3[],
  visuality = "medium",
): Record<string, Question> {
  const q: Record<string, Question> = {};
  for (const s of slots) {
    const obj = s.objective ? c.objectives[s.objective - 1]?.text : "";
    if (s.role === "teach")
      q[`s${s.slide}`] = {
        type: "choice",
        instructions: `Slide ${s.slide} teaches objective ${s.objective} (${obj}). Its idea: ${s.idea}. This class's visuality is ${visuality}: where the idea can be shown, showing it helps. Which form fits this idea best for these pupils?`,
        criteria: s.idea.includes("(slide 2 on this idea")
          ? Object.fromEntries(
              Object.entries(usable(TEACH_INTENTS, c))
                .filter(([k]) => SECOND_SLIDE.includes(k))
                .map(([k, v]) => [
                  k,
                  k === "worked-example"
                    ? "worked-example: a second, harder case of the method modelled step by step"
                    : v,
                ]),
            )
          : usable(TEACH_INTENTS, c),
      };
    if (s.role === "check")
      q[`s${s.slide}`] = {
        type: "choice",
        instructions: `Slide ${s.slide} checks objective ${s.objective} (${obj}) straight after it is taught: ${s.idea}. Which kind of check fits best?`,
        criteria: usable(CHECK_INTENTS, c),
      };
    if (s.role === "retrieve" || s.role === "hook")
      q[`s${s.slide}`] = {
        type: "choice",
        instructions: `Slide ${s.slide} opens the lesson (${s.role}${s.role === "retrieve" ? `, on: ${s.idea}` : ""}). Which opening fits best?`,
        criteria: Object.fromEntries(
          Object.entries(usable(OPENING_INTENTS, c)).filter(([k]) =>
            s.role === "retrieve"
              ? !k.endsWith("hook") && k !== "prediction"
              : k.endsWith("hook") || k === "prediction",
          ),
        ),
      };
    if (["check", "hinge", "practise", "retrieve"].includes(s.role) && !c.steering?.responseMode)
      q[`s${s.slide}_resp`] = {
        type: "choice",
        instructions: `How should pupils answer slide ${s.slide} (${s.role}${s.objective ? `, objective ${s.objective}` : ""})?`,
        criteria: RESPONSE,
      };
  }
  return q;
}

/* --------------------------------------------------------------- plan */

export type PlanSlotV3 = SlotV3 & {
  intent: string;
  form: string;
  wanted?: string;
  top2: [string, number][];
  response?: string;
  respTop2?: [string, number][];
  misconceptionHere: boolean;
};

export type PlanV3 = {
  version: typeof STRUCTURE_V3_VERSION;
  model: string;
  r1: R1V3;
  slots: PlanSlotV3[];
  ms: number;
  costUsd: number;
};

const top2 = (a: Answer | undefined): [string, number][] =>
  a && a.type !== "boolean"
    ? Object.entries(a.probabilities)
        .sort((x, y) => y[1] - x[1])
        .slice(0, 2)
        .map(([k, p]) => [k, Math.round(p * 100) / 100])
    : [];

export async function decideV3(c: ContextV3, evaluate: Evaluator, model: string): Promise<PlanV3> {
  const t0 = Date.now();
  const state = stateV3(c);
  const a1 = await evaluate(state, round1V3(c));
  const r1 = readR1V3(a1.answers, c);
  const slots = skeletonV3(c, r1);
  const state2 = `${state}\nDecided: ${r1.visuality} visuality; opens with a ${r1.opening}; ${r1.examStyle ? `exam-style practice (${r1.marks} marks)` : "no exam questions"}; practice: ${r1.practice}${r1.revisit === "none" ? "" : `, revisiting earlier learning (${r1.revisit})`}.\nThe slides in order: ${slots
    .map((s) => `slide ${s.slide} ${s.role}${s.objective ? ` objective ${s.objective}` : ""}`)
    .join("; ")}.`;
  const a2 = await evaluate(state2, round2V3(c, slots, r1.visuality));
  const menuFor = (s: SlotV3) =>
    s.role === "teach"
      ? TEACH_INTENTS
      : s.role === "check"
        ? CHECK_INTENTS
        : s.role === "practise"
          ? PRACTICE_INTENTS
          : OPENING_INTENTS;
  const plan: PlanSlotV3[] = slots.map((s) => {
    const a = a2.answers[`s${s.slide}`];
    const intent =
      s.role === "hinge"
        ? "multiple-choice"
        : s.role === "practise"
          ? r1.practice
          : a?.type === "choice"
            ? a.choice
            : "explain";
    const def =
      s.role === "hinge" ? { form: "hinge" } : (menuFor(s)[intent] ?? { form: "explain" });
    const resp = a2.answers[`s${s.slide}_resp`];
    const confronted =
      (r1.misconception === "opening" && (s.role === "retrieve" || s.role === "hook")) ||
      (r1.misconception === "hinge" && s.role === "hinge") ||
      (r1.misconception === `o${s.objective}` &&
        s.role === "teach" &&
        slots.find((x) => x.role === "teach" && x.objective === s.objective) === s);
    return {
      ...s,
      intent,
      form: def.form,
      ...("wanted" in def && def.wanted ? { wanted: def.wanted } : {}),
      top2:
        s.role === "hinge"
          ? [["multiple-choice", 1]]
          : s.role === "practise"
            ? top2(r1.answers.practice)
            : top2(a),
      ...(["check", "hinge", "practise", "retrieve"].includes(s.role)
        ? {
            response:
              c.steering?.responseMode ?? (resp?.type === "choice" ? resp.choice : r1.responseMode),
            respTop2: top2(resp),
          }
        : {}),
      misconceptionHere: confronted,
    };
  });
  return {
    version: STRUCTURE_V3_VERSION,
    model,
    r1,
    slots: plan,
    ms: Date.now() - t0,
    costUsd: (a1.costUsd ?? 0) + (a2.costUsd ?? 0),
  };
}
