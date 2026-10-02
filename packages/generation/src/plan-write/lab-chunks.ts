import { z } from "zod";
import {
  HOUSE_RULES,
  type PlanMenuEntry,
  type PlanSlide,
  titlePictureSchema,
} from "../prompts/plan-lesson";
import { type Audience, audienceBlock } from "../prompts/shared";
import { WRITE_RULES } from "../prompts/write-slides";
import type { LessonStructure } from "./lab-structure";
import { streamSlideSchema } from "./stream";

/*
 * TEACH-179 round 2 (JLc, JSc; lab only). After Jev's structure, ONE spine call (the chunk model)
 * writes the text every learning cycle shares: Jev writes no text, so the objectives, the running
 * example, the key terms and the misconception need a model. Code then builds the plan rows from
 * Jev's slots, and one chunk per objective is written in parallel, each streamed so its slides land
 * as they close. Routing: prompt versions starting "chunk-" go to LAB_CHUNK_MODEL (steps.ts).
 */

export const CHUNK_SPINE_VERSION = "chunk-spine.v1";
export const CHUNK_WRITE_VERSION = "chunk-write.v1";

/* --------------------------------------------------------------- spine */

export function spineSchema(cycles: number) {
  return z.object({
    objectives: z
      .array(z.string())
      .min(cycles)
      .max(cycles)
      .describe(
        `exactly ${cycles}, in teaching order: what pupils will be able to do by the end, each starting with a verb, pitched at what this year group's specification expects; together they cover the whole topic; objective i is learning cycle i`,
      ),
    cycles: z
      .array(
        z.object({
          covers: z
            .string()
            .describe(
              "the ideas this cycle teaches, in order, in one line; nothing another cycle teaches",
            ),
        }),
      )
      .min(cycles)
      .max(cycles),
    misconception: z
      .string()
      .describe(
        "the one wrong idea about this topic that matters most for these pupils, then the correct idea",
      ),
    runningExample: z.string().describe("one case, context or question every cycle returns to"),
    keyTerms: z
      .array(z.object({ term: z.string(), definition: z.string() }))
      .min(1)
      .describe(
        "every term the lesson teaches, each with the one definition all cycles use, worded for these pupils",
      ),
    titlePicture: titlePictureSchema,
  });
}
export type Spine = z.infer<ReturnType<typeof spineSchema>>;

export type SpineInput = {
  topic: string;
  audience: Audience;
  answers?: Record<string, string>;
  priorKnowledge?: string;
  cycles: number;
};

export function spinePrompt(input: SpineInput): { system: string; user: string } {
  const system = `You are an experienced UK teacher. Several teachers will each write one learning cycle of a lesson at the same time; you write the spine they all share, so the cycles fit together as one lesson.\n\n${HOUSE_RULES}`;
  const lines = [`Topic: ${input.topic}`, audienceBlock(input.audience)];
  if (input.priorKnowledge && !input.audience.classContext?.priorKnowledge)
    lines.push(`Prior knowledge: ${input.priorKnowledge}`);
  const answers = Object.values(input.answers ?? {}).filter((a) => a.trim());
  if (answers.length) lines.push(`The teacher's answers: ${answers.join("; ")}`);
  lines.push(`Learning cycles: ${input.cycles}, one per objective.`);
  return { system, user: lines.join("\n") };
}

/* --------------------------------------------------------------- rows (code) */

const CHECKING = new Set(["check", "hinge", "practise"]);

/** The plan rows ("role | form | layout | objectives | parts | aim | teaches | tests") from Jev's slots and the spine. */
export function rowsFrom(
  s: LessonStructure,
  spine: Spine,
  menu: readonly PlanMenuEntry[],
): string[] {
  const taught = new Map<number, string[]>();
  const count = new Map<number, number>();
  return s.slots.map((slot) => {
    const k = slot.objective;
    const cap = menu.find((m) => m.form === slot.form && m.layout === "default")?.capacity ?? 3;
    const parts = Math.min(3, cap);
    const covers = k ? (spine.cycles[k - 1]?.covers ?? "") : "";
    let teaches = "-";
    let tests = "-";
    let aim = covers;
    if (slot.role === "teach" && k) {
      const j = (count.get(k) ?? 0) + 1;
      count.set(k, j);
      teaches = `o${k}-${j}`;
      taught.set(k, [...(taught.get(k) ?? []), teaches]);
      aim = `cycle ${k}, teach slide ${j}: ${covers}`;
    } else if (CHECKING.has(slot.role) && k) {
      const keys = slot.role === "practise" ? [...taught.values()].flat() : (taught.get(k) ?? []);
      tests = keys.length ? keys.join(", ") : "-";
      aim = slot.role === "practise" ? "pupils work alone across the lesson" : `checks cycle ${k}`;
    } else aim = slot.role === "hook" ? "opens the lesson's question" : "recalls earlier learning";
    const objectives =
      slot.role === "practise" ? spine.objectives.map((_, i) => i + 1).join(", ") : (k ?? "-");
    return [slot.role, slot.form, "default", objectives, parts, aim, teaches, tests].join(" | ");
  });
}

/** Which chunk each written slide belongs to: its highest objective; openings go to chunk 1. */
export function chunkOf(row: PlanSlide): number {
  return row.objectives.length ? Math.max(...row.objectives) : 1;
}

/* --------------------------------------------------------------- chunk prompt */

const ROLE_LINE: Record<string, string> = {
  retrieve:
    "retrieve: quick questions on what earlier lessons taught that this lesson builds on, never this lesson's own terms",
  hook: "hook: a question, case or picture that opens the lesson's puzzle, from what the class already knows",
  teach: "teach: carries its idea's facts, case and explanation",
  check: "check: a quick question on what this cycle's earlier slides just taught",
  hinge: "hinge: the check the rest of the lesson depends on, before pupils work alone",
  practise:
    "practise: pupils work alone through new items that step up, across the whole lesson's objectives",
};

export function chunkSchema(menu: readonly PlanMenuEntry[]) {
  return z.object({ slides: z.array(streamSlideSchema(menu)) });
}
export const chunkLenient = z.object({ slides: z.array(z.record(z.string(), z.unknown())) });

export type ChunkInput = {
  topic: string;
  audience: Audience;
  spine: Spine;
  chunk: number;
  /** Slide numbers of every chunk, for "what the others cover". */
  ranges: { chunk: number; from: number; to: number }[];
  /** This chunk's slides: number and row. */
  slides: { n: number; row: PlanSlide }[];
  menu: readonly PlanMenuEntry[];
  /** Lesson-level lines from the structure (exam marks, how to answer, option count). */
  extras: string[];
};

export function chunkPrompt(input: ChunkInput): { system: string; user: string } {
  const system = `You are an experienced UK teacher writing one learning cycle of a lesson as slides. Other teachers write the other cycles at the same time from the same spine, so you keep to the spine's objectives, key terms and their definitions, misconception and running example. You teach only your cycle's ideas; a slide that asks about another cycle asks only about what the spine says that cycle covers, in the spine's words. Nothing rewrites your words, so what you write is the slide.\n\n${HOUSE_RULES}\n${WRITE_RULES}`;
  const { spine } = input;
  const forms = new Set(input.slides.map((s) => s.row.form));
  const menu = input.menu.filter((m) => forms.has(m.form));
  const lines = [
    "Palette (each form and layout you may use, its slots and how many parts it holds):",
    menu
      .map((m) =>
        [
          m.contract,
          m.when ? `  When: ${m.when}` : "",
          m.capacity !== undefined ? `  Parts: at most ${m.capacity}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      )
      .join("\n"),
    "",
    `Topic: ${input.topic}`,
    audienceBlock(input.audience),
    "",
    "Spine:",
    "Objectives:",
    ...spine.objectives.map((o, i) => `${i + 1}. ${o}`),
    `Misconception: ${spine.misconception}`,
    `Running example: ${spine.runningExample}`,
    "Key terms:",
    ...spine.keyTerms.map((t) => `- ${t.term}: ${t.definition}`),
    "Cycles:",
    ...input.ranges.map(
      (r) =>
        `- Cycle ${r.chunk} (slides ${r.from} to ${r.to}): ${spine.cycles[r.chunk - 1]?.covers ?? ""}${r.chunk === input.chunk ? "  <- yours" : ""}`,
    ),
    "",
    `Your slides, in order: write one item for each, its kind one layout of the slide's form (slides 1 and 2 are the title and objectives; ${input.ranges.length > 1 ? "the other cycles' slides are written by others" : "you write every other slide"}):`,
    ...input.slides.map(
      ({ n, row }) => `Slide ${n}: ${ROLE_LINE[row.role] ?? row.role}; form ${row.form}`,
    ),
    ...input.extras,
  ];
  return { system, user: lines.join("\n") };
}

/** Lesson-level lines for the chunk writers, from the structure (as stream-structure.v1 words them). */
export function chunkExtras(s: LessonStructure, year: number): string[] {
  const how = {
    whiteboards: "on their mini whiteboards",
    books: "in their books",
    talk: "by talking to a partner",
  }[s.responseMode];
  const out: string[] = [];
  if (s.examStyle && s.marks)
    out.push(
      `Exam-style: a practise slide's items are exam questions in the exam's command words, each ending with its marks in brackets, such as "[${s.marks} marks]"; its notes give the mark scheme.`,
    );
  out.push(`A check or practise slide's task line says how pupils answer: ${how}.`);
  if (year <= 4) out.push("Every multiple-choice question has 3 options.");
  return out;
}

/* --------------------------------------------------------------- cross-chunk check (code) */

const STOP = new Set(
  "the a an and or of to in on at is are was were be by for with as it its this that these those from into than then their they them which who what how why when where can not no do does did has have had will would one two each".split(
    " ",
  ),
);
const words = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));

const textOf = (out: unknown): string => {
  const acc: string[] = [];
  const walk = (v: unknown, key?: string) => {
    if (key === "notes" || key === "kind") return;
    if (typeof v === "string") acc.push(v);
    else if (Array.isArray(v)) for (const x of v) walk(x);
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(out);
  return acc.join(" ");
};

export type CrossCheck = {
  repeats: { a: number; b: number; overlap: number; shared: string }[];
  sameHeading: { a: number; b: number; heading: string }[];
  termsUnused: string[];
  termsDrift: { term: string; slides: number[]; definitionOverlap: number }[];
  termsOutside: { term: string; chunks: number[] }[];
};

/**
 * Repeated content: slides in different chunks whose content-word trigrams overlap (Jaccard >= 0.2)
 * or whose headings match. Term drift: a key term whose sentences on the slides share under a quarter
 * of its spine definition's content words. Terms outside: a key term used in more than one chunk
 * (expected for checks and practise; reported, not judged).
 */
export function crossChunkCheck(
  placed: { n: number; chunk: number; out: unknown }[],
  spine: Spine,
): CrossCheck {
  const grams = (t: string) => {
    const w = words(t);
    return new Set(w.slice(2).map((_, i) => `${w[i]} ${w[i + 1]} ${w[i + 2]}`));
  };
  const items = placed.map((p) => ({
    ...p,
    text: textOf(p.out),
    heading: String((p.out as { heading?: unknown })?.heading ?? ""),
  }));
  const repeats: CrossCheck["repeats"] = [];
  const sameHeading: CrossCheck["sameHeading"] = [];
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (!a || !b || a.chunk === b.chunk) continue;
      const ga = grams(a.text);
      const gb = grams(b.text);
      const inter = [...ga].filter((g) => gb.has(g));
      const jac = inter.length / Math.max(1, ga.size + gb.size - inter.length);
      if (jac >= 0.2)
        repeats.push({
          a: a.n,
          b: b.n,
          overlap: Math.round(jac * 100) / 100,
          shared: inter.slice(0, 3).join(" / "),
        });
      if (a.heading && a.heading.toLowerCase() === b.heading.toLowerCase())
        sameHeading.push({ a: a.n, b: b.n, heading: a.heading });
    }
  const termsUnused: string[] = [];
  const termsDrift: CrossCheck["termsDrift"] = [];
  const termsOutside: CrossCheck["termsOutside"] = [];
  for (const { term, definition } of spine.keyTerms) {
    const t = term.toLowerCase();
    const hits = items.filter((x) => x.text.toLowerCase().includes(t));
    if (!hits.length) {
      termsUnused.push(term);
      continue;
    }
    const chunks = [...new Set(hits.map((h) => h.chunk))];
    if (chunks.length > 1) termsOutside.push({ term, chunks });
    const def = new Set(words(definition));
    const sentences = hits.flatMap((h) =>
      h.text.split(/(?<=[.!?:])\s+/).filter((s) => s.toLowerCase().includes(t)),
    );
    const used = new Set(sentences.flatMap(words));
    const overlap = def.size ? [...def].filter((w) => used.has(w)).length / def.size : 1;
    if (overlap < 0.25)
      termsDrift.push({
        term,
        slides: hits.map((h) => h.n),
        definitionOverlap: Math.round(overlap * 100) / 100,
      });
  }
  return { repeats, sameHeading, termsUnused, termsDrift, termsOutside };
}
