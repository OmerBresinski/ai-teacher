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
import y8Science from "./briefs/y8-science-particles.json";
import y10History from "./briefs/y10-history-cold-war.json";

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

/** Every brief, parsed by the same schema `POST /lessons` runs; throws on a bad fixture. */
export function evalBriefs(): EvalBrief[] {
  return Object.entries(RAW).map(([id, raw]) => ({ id, input: CreateLessonSchema.parse(raw) }));
}

/** Whether a brief is secondary or post-16 (Year 7 and up) — the band the Plan-model eval compares. */
export function isSecondaryBrief(brief: EvalBrief): boolean {
  return (yearNumberOf(brief.input.yearGroup) ?? 0) >= SECONDARY_FROM_YEAR;
}

export const SECONDARY_FROM_YEAR = 7;
