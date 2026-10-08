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
/** The writer call's output cap in tokens. */
export const WRITER_MAX_TOKENS = 9000;

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
