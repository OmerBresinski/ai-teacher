import { type CreateLesson, CreateLessonSchema } from "@tj/domain/documents";
import eyfsPhonics from "./briefs/eyfs-phonics-sh.json";
import ks2Re from "./briefs/ks2-re-diwali.json";
import ks3English from "./briefs/ks3-english-persuasive.json";
import ks4Geography from "./briefs/ks4-geography-coasts.json";
import post16Economics from "./briefs/post16-economics-elasticity.json";
import y3Maths from "./briefs/y3-maths-fractions.json";
import y8Science from "./briefs/y8-science-particles.json";
import y10History from "./briefs/y10-history-cold-war.json";

/*
 * The eval set (ADR 0025 §23, F06 item 9): eight `POST /lessons` bodies across key stages and
 * subjects. Both halves of the eval iterate this list in this order; a brief's `id` is its file
 * name and is the only thing about it that reaches a results file.
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
};

/** Every brief, parsed by the same schema `POST /lessons` runs; throws on a bad fixture. */
export function evalBriefs(): EvalBrief[] {
  return Object.entries(RAW).map(([id, raw]) => ({ id, input: CreateLessonSchema.parse(raw) }));
}
