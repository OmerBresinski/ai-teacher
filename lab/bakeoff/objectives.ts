// Objectives phase (Greg approved 7 Oct): a teacher-objectives call on Sol with a Luna fallback when
// no first objective has streamed by 8 s; at sign-off, a pupil-wording call runs beside the design
// call and fills slide 2. Models and the fallback are code defaults (ship config in code).
import { PartialJson } from "./partial";
import type { ChatReq } from "./services";

export const OBJECTIVES_CONFIG = {
  primary: { model: "gpt-6.1-sol", effort: "low" },
  fallback: { model: "gpt-6-luna", effort: "low" },
  /** No first objective by then: the primary call is aborted and the fallback runs. */
  firstWithinMs: 8_000,
  pupil: { model: "gpt-6-luna", effort: "low" },
} as const satisfies {
  primary: { model: string; effort: ChatReq["effort"] };
  fallback: { model: string; effort: ChatReq["effort"] };
  firstWithinMs: number;
  pupil: { model: string; effort: ChatReq["effort"] };
};

type StreamResult = { text: string; usage: unknown; usd: number; ms: number; firstTokenMs: number };
export type Streamer = (r: ChatReq, onText: (d: string) => void) => Promise<StreamResult>;
type Req = Omit<ChatReq, "model" | "effort">;

/** A streamed objective item: the teacher wording (a string, or `{teacher}` from older schemas). */
const teacherOf = (v: unknown) =>
  typeof v === "string" ? v : String((v as { teacher?: unknown })?.teacher ?? "");

export type ObjectivesRun = {
  teacher: string[];
  ran: "primary" | "fallback";
  model: string;
  /** The primary call's spend when it ran to the end, and whether it was abandoned. */
  result: StreamResult;
  abandoned?: { model: string; reason: string };
};

/**
 * The teacher-objectives call. The primary model streams; if no objective has closed after
 * `firstWithinMs` (or the call fails before one did), it is aborted and the fallback model runs
 * the same request. `onObjective` fires as each objective closes, from whichever call is used.
 */
export async function objectivesCall(
  req: Req,
  stream: Streamer,
  onObjective: (teacher: string, k: number) => void,
  cfg: {
    primary: { model: string; effort: ChatReq["effort"] };
    fallback: { model: string; effort: ChatReq["effort"] };
    firstWithinMs: number;
  } = OBJECTIVES_CONFIG,
): Promise<ObjectivesRun> {
  const attempt = async (m: { model: string; effort: ChatReq["effort"] }, deadline?: number) => {
    const got: string[] = [];
    const ac = new AbortController();
    const parser = new PartialJson((path, v) => {
      if (path[0] === "objectives" && path.length === 2) {
        const t = teacherOf(v);
        got.push(t);
        onObjective(t, got.length - 1);
      }
    });
    const timer =
      deadline === undefined
        ? undefined
        : setTimeout(() => {
            if (!got.length) ac.abort(new Error(`no objective within ${deadline} ms`));
          }, deadline);
    try {
      const result = await stream({ ...req, ...m, signal: ac.signal }, (d) => parser.push(d));
      return { got, result };
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    const p = await attempt(cfg.primary, cfg.firstWithinMs);
    return { teacher: p.got, ran: "primary", model: cfg.primary.model, result: p.result };
  } catch (e) {
    const f = await attempt(cfg.fallback);
    return {
      teacher: f.got,
      ran: "fallback",
      model: cfg.fallback.model,
      result: f.result,
      abandoned: {
        model: cfg.primary.model,
        reason: String((e as Error)?.message ?? e).slice(0, 120),
      },
    };
  }
}

/** The pupil-wording call's default schema: one pupil line per teacher objective, in order. */
export const pupilSchema = (n: number) => ({
  type: "object",
  additionalProperties: false,
  required: ["pupil"],
  properties: { pupil: { type: "array", items: { type: "string" }, minItems: n, maxItems: n } },
});

/**
 * The pupil wording of the approved teacher objectives (streamed; `onLine` fires per line as it
 * closes). Accepts `{pupil: [..]}` or `{objectives: [{pupil}]}` output.
 */
export async function pupilCall(
  req: Req,
  stream: Streamer,
  onLine: (pupil: string, k: number) => void,
  cfg: { model: string; effort: ChatReq["effort"] } = OBJECTIVES_CONFIG.pupil,
): Promise<{ pupil: string[]; result: StreamResult }> {
  const pupil: string[] = [];
  const parser = new PartialJson((path, v) => {
    const line =
      path[0] === "pupil" && path.length === 2
        ? String(v)
        : path[0] === "objectives" && path.length === 2
          ? String((v as { pupil?: unknown })?.pupil ?? "")
          : undefined;
    if (line === undefined) return;
    pupil.push(line);
    onLine(line, pupil.length - 1);
  });
  const result = await stream({ ...req, ...cfg }, (d) => parser.push(d));
  return { pupil, result };
}
