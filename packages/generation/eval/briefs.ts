import { type CreateLesson, CreateLessonSchema, yearNumberOf } from "@tj/domain/documents";
import eyfsPhonics from "./briefs/eyfs-phonics-sh.json";
import ks2Re from "./briefs/ks2-re-diwali.json";
import ks3English from "./briefs/ks3-english-persuasive.json";
import ks3Maths from "./briefs/ks3-maths-linear-equations.json";
import ks4EnglishLiterature from "./briefs/ks4-english-literature-macbeth.json";
import ks4Geography from "./briefs/ks4-geography-coasts.json";
import ks4Science from "./briefs/ks4-science-electrolysis.json";
import ks5History from "./briefs/ks5-history-weimar-crisis.json";
import post16Economics from "./briefs/post16-economics-elasticity.json";
import y3Maths from "./briefs/y3-maths-fractions.json";
import y4HistoryRomans from "./briefs/y4-history-romans.json";
import y6MathsRatio from "./briefs/y6-maths-ratio.json";
import y7ScienceCells from "./briefs/y7-science-cells.json";
import y8Science from "./briefs/y8-science-particles.json";
import y8SciencePhotosynthesis from "./briefs/y8-science-photosynthesis.json";
import y9HistoryRussian from "./briefs/y9-history-russian-revolution.json";
import y10History from "./briefs/y10-history-cold-war.json";
import y10HistoryWw1 from "./briefs/y10-history-ww1-causes.json";
import y12EconomicsExternalities from "./briefs/y12-economics-externalities.json";
import y13PsychologyFreud from "./briefs/y13-psychology-freud-critics.json";

/*
 * The eval set (ADR 0025 §23, F06 item 9): twelve `POST /lessons` bodies across key stages and
 * subjects — the original eight, plus four secondary briefs (TEACH-259) so the Year 7+ sample the
 * Plan-model question is about is n = 9 against 3 primary. Both halves of the eval iterate this
 * list in this order; a brief's `id` is its file name and is the only thing about it that reaches
 * a results file.
 */

export interface EvalBrief {
  id: string;
  input: CreateLesson;
}

const RAW: Record<string, unknown> = {
  "y3-maths-fractions": y3Maths,
  "y8-science-particles": y8Science,
  "y10-history-cold-war": y10History,
  "eyfs-phonics-sh": eyfsPhonics,
  "ks3-english-persuasive": ks3English,
  "ks4-geography-coasts": ks4Geography,
  "ks2-re-diwali": ks2Re,
  "post16-economics-elasticity": post16Economics,
  "ks3-maths-linear-equations": ks3Maths,
  "ks4-science-electrolysis": ks4Science,
  "ks4-english-literature-macbeth": ks4EnglishLiterature,
  "ks5-history-weimar-crisis": ks5History,
};

/**
 * The topic-pack experiment's briefs (np1, `eval/experiments/np1.json`): regression briefs the
 * lab (or the prompt bake-off) has already seen, three held-out ones never used in this project
 * (cells, the Russian Revolution, externalities) and a reserve. Kept out of `RAW` so the
 * eval set's twelve are unchanged; `lab.ts --brief <id>` resolves both lists.
 */
const NP1: Record<string, unknown> = {
  "y4-history-romans": y4HistoryRomans,
  "y6-maths-ratio": y6MathsRatio,
  "y8-science-photosynthesis": y8SciencePhotosynthesis,
  "y10-history-ww1-causes": y10HistoryWw1,
  "y13-psychology-freud-critics": y13PsychologyFreud,
  "y7-science-cells": y7ScienceCells,
  "y9-history-russian-revolution": y9HistoryRussian,
  "y12-economics-externalities": y12EconomicsExternalities,
};

/** The np1 briefs, parsed by the same schema `POST /lessons` runs. */
export function np1Briefs(): EvalBrief[] {
  return Object.entries(NP1).map(([id, raw]) => ({ id, input: CreateLessonSchema.parse(raw) }));
}

/** Every brief, parsed by the same schema `POST /lessons` runs; throws on a bad fixture. */
export function evalBriefs(): EvalBrief[] {
  return Object.entries(RAW).map(([id, raw]) => ({ id, input: CreateLessonSchema.parse(raw) }));
}

/** Whether a brief is secondary or post-16 (Year 7 and up) — the band the Plan-model eval compares. */
export function isSecondaryBrief(brief: EvalBrief): boolean {
  return (yearNumberOf(brief.input.yearGroup) ?? 0) >= SECONDARY_FROM_YEAR;
}

export const SECONDARY_FROM_YEAR = 7;
