/**
 * The fixed codes a lesson picture's outcome event carries (`picture-outcome`, ADR 0041,
 * `docs/observability.md` "Lesson pictures"): what kind of picture it is, where it came from, and
 * the lesson's subject and key stage, so prod runs can say how often pictures fail and why. Codes
 * only: the words they are read from stay in the debug record.
 */
import { PROVIDER_ERROR_CODES } from "@tj/ai";
import { SUBJECTS } from "@tj/domain/documents";
import { FRAME_CUT_RUN, type PictureFailure } from "@tj/images";
import type { FrameMeasure, JudgeCheck, PictureTrace } from "./photo-bank";

/**
 * What a picture shows, read by code off the director's words and named kind (the director has no
 * such field). A portrait is a person shown on their own, often cropped at the chest on purpose,
 * so its frame cut is recorded apart from other kinds'. A heuristic: its accuracy is unmeasured.
 */
export const PICTURE_KINDS = ["portrait", "scene", "object", "drawing"] as const;
export type PictureKind = (typeof PICTURE_KINDS)[number];

const PORTRAIT =
  /\b(portraits?|head[- ]and[- ]shoulders|bust|half[- ]length|headshot|close[- ]up of (?:an? |the )?(?:face|person|man|woman|child|boy|girl))\b/i;
const PERSON =
  /\b(person|man|woman|child|children|boy|girl|teenager|pupil|student|teacher|scientist|doctor|nurse|farmer|worker|king|queen|character|athlete|player|chef|soldier)\b/i;
const SCENE =
  /\b(scene|landscape|street|room|classroom|kitchen|market|farm(?:yard)?|forest|woods?|beach|field|town|village|city|garden|park|crowd|people|playground|shop|harbou?r|countryside|river|mountains?|desert|jungle|laboratory|hall|stadium|meadow|seashore|coast|island|valley)\b/i;

export function pictureKindOf(args: {
  text: string;
  named?: string | null | undefined;
  draw?: boolean;
}): PictureKind {
  if (args.draw) return "drawing";
  if (PORTRAIT.test(args.text)) return "portrait";
  if (args.named === "place" || args.named === "event") return "scene";
  if (SCENE.test(args.text)) return "scene";
  if (args.named === "person" || PERSON.test(args.text)) return "portrait";
  return "object";
}

/** Where a placed picture came from. */
export const SOURCE_KINDS = ["generated", "drawn", "stock", "commons", "library", "none"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export function sourceKindOf(
  via: string,
  photo: { source: { provider: string }; style?: string } | undefined,
): SourceKind {
  if (!photo) return "none";
  if (via === "library") return "library";
  if (photo.source.provider === "generated") return photo.style === "drawn" ? "drawn" : "generated";
  if (photo.source.provider === "commons") return "commons";
  return "stock";
}

/** `Art and design` → `art-and-design`; a subject off the brief form's list is `other`. */
export const LESSON_SUBJECTS = [
  ...SUBJECTS.map((s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-")),
  "other",
] as const;

export function lessonSubjectOf(subject: string | undefined): string | undefined {
  if (!subject?.trim()) return undefined;
  const hit = SUBJECTS.find((s) => s.toLowerCase() === subject.trim().toLowerCase());
  return hit ? hit.toLowerCase().replace(/[^a-z0-9]+/g, "-") : "other";
}

export const KEY_STAGES = ["eyfs", "ks1", "ks2", "ks3", "ks4", "ks5"] as const;

/** England's key stage of a year-group label (`Reception`, `Year 7`); undefined when unknown. */
export function keyStageOf(yearGroup: string | undefined): string | undefined {
  if (!yearGroup) return undefined;
  if (/reception/i.test(yearGroup)) return "eyfs";
  const y = Number(/\d+/.exec(yearGroup)?.[0]);
  if (!Number.isInteger(y) || y < 1 || y > 13) return undefined;
  return y <= 2 ? "ks1" : y <= 6 ? "ks2" : y <= 9 ? "ks3" : y <= 11 ? "ks4" : "ks5";
}

/** Why a slot's tries failed, as codes (the event's `retryReasons`, `reason`). */
export const PICTURE_FAIL_REASONS = [
  // The ladder (`findPicture`).
  "judge",
  "judge-error",
  "style",
  "declined",
  "error",
  // The generator (`ImageFailReason`).
  "refused-safety",
  "rate-limited",
  "quota",
  "server-error",
  "network",
  "network-unsure",
  "timeout",
  "bad-request",
  "no-image",
  // A set frame (`picture-set.ts`).
  "odd",
  "capped",
  // An empty slot (`PictureOutcome.reason`).
  "director-code",
  "director-none",
  "director-failed",
  "real-miss-no-fallback",
  "generation-refused-or-failed",
] as const;

const FAIL_CODES: ReadonlySet<string> = new Set([...PICTURE_FAIL_REASONS, ...PROVIDER_ERROR_CODES]);

/**
 * The last failure's stage, status and code, for an outcome event (ADR 0041): the code only when
 * it is one of ours (a generator reason, a provider error code), never an S3 or free-text code.
 */
export function failureProps(failure: PictureFailure | undefined) {
  return {
    failStage: failure?.stage,
    failStatus: failure?.status,
    failCode: failure?.code && FAIL_CODES.has(failure.code) ? failure.code : undefined,
  };
}

/** The frame and trace numbers of one slot's outcome event (all codes and numbers). */
export function traceProps(
  trace: PictureTrace | undefined,
  placedSrc: string | undefined,
  kind: PictureKind,
) {
  const attempts = trace?.attempts ?? [];
  const placed = attempts.find((a) => a.src !== undefined && a.src === placedSrc);
  const frame: FrameMeasure | undefined = placed?.frame;
  const failed = new Set<JudgeCheck>();
  for (const a of attempts) for (const c of a.failedChecks ?? []) failed.add(c);
  const cutEdges = frame
    ? Object.values(frame.edges).filter((v) => v >= FRAME_CUT_RUN).length
    : undefined;
  const costs = attempts.map((a) => a.costUsd ?? 0);
  return {
    retryReasons: attempts
      .map((a) => a.result)
      .filter((r) => r !== "placed" && r !== "made")
      .slice(0, 20),
    failedChecks: [...failed],
    judgeRefusals: attempts.filter((a) => a.result === "judge").length,
    pictureCostUsd: Math.round(costs.reduce((s, c) => s + c, 0) * 1e6) / 1e6,
    // Measure only (21 Oct 2026): a cut is recorded, never redrawn.
    frameMeasured: frame !== undefined,
    backdrop: frame ? (frame.plain ? "plain" : "full-bleed") : undefined,
    frameCut: frame && kind !== "portrait" ? frame.cut : undefined,
    portraitCut: frame && kind === "portrait" ? frame.cut : undefined,
    cutEdges,
    frameBleed: frame ? Math.round(frame.bleed * 1000) / 1000 : undefined,
    frameMs: frame ? Math.round(frame.ms * 10) / 10 : undefined,
    cutsSeen: attempts.filter((a) => a.frame?.cut).length,
    ...failureProps(attempts.findLast((a) => a.failure)?.failure ?? trace?.stockFailure),
  };
}
