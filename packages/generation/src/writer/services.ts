import { BudgetReservationError, UnestimableCallError } from "@tj/ai";
import { BudgetExceeded } from "../types";
/*
 * The model calls the writer stage makes, as an interface the stage is handed: one streamed
 * writer call, and small structured calls (repair, restage, objective repair, notes, pupil
 * wording). Production builds them on `@tj/ai` (`writer/ai-services.ts`); tests and the replay
 * answer them from recorded outputs, so nothing here spends.
 */

export type Effort = "none" | "low" | "medium" | "high";

/** The writer's route (code default, ADR 0031 amendment): Sol at low effort. */
export const WRITER_MODEL = "openai/gpt-6.1-sol";
/** Every other call the stage makes: Luna at low effort. */
export const SMALL_MODEL = "openai/gpt-6-luna";
export const WRITER_EFFORT: Effort = "low";
/** The pinned writer's output cap (Standard, 9–12 slides): the floor of `writerMaxTokens`. */
export const WRITER_MAX_TOKENS = 9000;
/**
 * The most output tokens a slide took in the 24 saved base4 writer runs (3,065 for 12 slides,
 * reasoning included); the cap gives each slide of the range's maximum 2.9 times that, which keeps
 * Standard (12) on the pinned 9,000 and gives Detailed (20) 14,790.
 */
export const WRITER_TOKENS_PER_SLIDE = 255;
/** The writer's output cap for a lesson of up to `maxSlides` (Detailed, 13–20, must not stop on length). */
export const writerMaxTokens = (maxSlides: number) =>
  Math.max(WRITER_MAX_TOKENS, Math.ceil(WRITER_TOKENS_PER_SLIDE * 2.9 * maxSlides));

/**
 * A stop the stage must never swallow: the budget refusing a call, or the job being cancelled or
 * shut down. Every other call failure (a provider error, a timeout, an answer that does not
 * parse) is non-fatal: the stage keeps the slide or the notes it had.
 */
export function isFatal(e: unknown): boolean {
  if (e instanceof BudgetReservationError || e instanceof UnestimableCallError) return true;
  if (e instanceof BudgetExceeded) return true;
  if (e instanceof Error && e.name === "AbortError") return true;
  const cause = (e as { cause?: unknown } | null)?.cause;
  return cause !== undefined && cause !== e && isFatal(cause);
}

export type ChatReq = {
  model: string;
  effort?: Effort;
  system: string;
  user: string;
  schema: object;
  name: string;
  strict?: boolean;
  timeoutMs?: number;
  maxTokens?: number;
};
export type ChatResult = { out?: unknown; usd: number; ms: number };

export type WriterReq = {
  model: string;
  effort: Effort;
  system: string;
  user: string;
  schema: object;
  name: "lesson";
  maxTokens: number;
};
export type WriterResult = {
  text: string;
  finishReason?: string | null;
  usd: number;
  ms: number;
  firstTokenMs?: number;
};

export interface WriterServices {
  /** One small structured call; a failure rejects. */
  chat(req: ChatReq): Promise<ChatResult>;
  /** The streamed writer call; `onDelta` gets each piece of text as it arrives. */
  writer(req: WriterReq, onDelta: (delta: string) => void): Promise<WriterResult>;
  /** A structured event for the stage's log (ids and counts, never content in production). */
  log(event: object): void;
}
