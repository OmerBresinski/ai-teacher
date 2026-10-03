/*
 * stream-visuality.v1 (lab, ruling 147a, round VIS147A): a SOFT picture target for the Sol stream.
 * LAB_VISUALITY=low|mid|high picks a band on the share of teaching slides (every slide after the
 * objectives) that carry a rendered picture; mid is 147a's band for the key stage, low sits below it,
 * high above it. Code turns the band into a count of the stream's own rows, because the code warm-up
 * and the closing exit slide (about two slides in a deck) never carry one. The line is a target for
 * the lesson, not a plan: Sol still chooses each row's form as it plans (binding plans lost pictures,
 * 9/9 in round JEV). Unset: no line, no swap; the stream is the candidate's.
 */
/* v2: v1's smoke (y9 mid) traded two check rows for teach rows (code then inserted two checks, 13
 * slides) and still drew 3 pictures; the line now says where pictures go and that the checks stay. */
export const STREAM_VISUALITY_VERSION = "stream-visuality.v2";

export type VisualitySetting = "low" | "mid" | "high";

/** Share of teaching slides with a picture, [floor, ceiling], per key stage and setting. */
const BANDS: Record<
  "ks12" | "ks3" | "ks45",
  Record<VisualitySetting, readonly [number, number]>
> = {
  ks12: { low: [0.25, 0.4], mid: [0.55, 0.75], high: [0.85, 1] },
  ks3: { low: [0.1, 0.25], mid: [0.35, 0.5], high: [0.65, 0.85] },
  ks45: { low: [0.1, 0.2], mid: [0.3, 0.45], high: [0.6, 0.8] },
};

/** Slides in the delivered deck after the objectives that the stream does not write (warm-up, exit). */
const CODE_TEACHING_SLIDES = 2;

function stageOf(yearGroup: string): keyof typeof BANDS {
  const y = Number(/(\d+)/.exec(yearGroup)?.[1] ?? 9);
  return y <= 6 ? "ks12" : y <= 9 ? "ks3" : "ks45";
}

export function visualitySetting(): VisualitySetting | undefined {
  const v = process.env.LAB_VISUALITY;
  return v === "low" || v === "mid" || v === "high" ? v : undefined;
}

export type Visuality = {
  version: string;
  setting: VisualitySetting;
  stage: string;
  band: readonly [number, number];
  rows: number;
  lo: number;
  hi: number;
  line: string;
};

/** The band as a count of the stream's rows, and the user-turn line that carries it. */
export function visuality(setting: VisualitySetting, yearGroup: string, rows: number): Visuality {
  const stage = stageOf(yearGroup);
  const band = BANDS[stage][setting];
  const teaching = rows + CODE_TEACHING_SLIDES;
  const clamp = (k: number) => Math.max(0, Math.min(rows, k));
  let lo = clamp(Math.ceil(band[0] * teaching - 1e-9));
  let hi = clamp(Math.floor(band[1] * teaching + 1e-9));
  if (hi < lo) lo = hi = clamp(Math.round(((band[0] + band[1]) / 2) * teaching));
  const count = lo === hi ? `about ${lo}` : `about ${lo} to ${hi}`;
  const line = `Pictures: aim for ${count} of your ${rows} plan rows to carry a picture that teaches: a diagram, or a photo that the slide's text uses. Pictures go on teach slides, and on a check only when it asks about its picture; the lesson keeps its checks. Where an idea has a structure or a process, its picture is a diagram.`;
  return { version: STREAM_VISUALITY_VERSION, setting, stage, band, rows, lo, hi, line };
}

/** The system rule the line would contradict: the palette's "every teach slide is pictured". */
export const VISUALITY_SWAP = [
  "a teach slide is a photo or a diagram slot unless its idea cannot be pictured:",
  "a teach slide whose idea can be pictured is a photo or a diagram slot when the request's picture line leaves room for one:",
] as const;
