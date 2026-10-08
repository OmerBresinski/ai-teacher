/**
 * Same-subject picture sets (TEACH-237; Greg: a Year 1 "Growing up" sequence showed a chihuahua
 * puppy, a mongrel and a poodle). Panels that show one subject at different stages (a picture
 * sequence, or compare cards of the same thing) are one set: generated as ONE image of N
 * side-by-side panels in code's frame, cut apart by `splitPanels` (@tj/images), each panel judged
 * against its own request, then the set judged for sameness. Stock is not used for a set: no single
 * stock source returns the same individual at every stage.
 *
 * The frame lines below are base4's, byte for byte (`picture-set.test.ts` checks them against the
 * pinned lab source); a wording change goes through the prompt-engineer.
 */
import type { ImageBrief, Lesson, PhotoSource } from "@tj/domain/documents";
import {
  duplicatePanels,
  IMAGE_TERMS,
  type ImageGenerator,
  type ImageSize,
  splitPanels,
} from "@tj/images";
import { callStructured } from "../call";
import { SET_JUDGE_TOKENS, SetJudgeSchema, setJudgePrompt } from "../prompts/set-judge";
import type { PipelineDeps } from "../types";
import { judgeMadeDirected, plainSubject } from "./illustrate";
import { mustShowOf } from "./photo-bank";
import {
  housePhoto,
  housePhotoPrompt,
  type LessonLook,
  lessonIllustrationPrompt,
} from "./picture-director";

/** Words that say which stage, size or age a panel is at, not what the subject is. */
const STAGE =
  /^(?:a|an|the|of|same|very|one|its|their|this|that|with|and|in|on|at|from|to|as|her|his|beside|next|alongside|plus|holding|together|both|young|younger|old|older|adult|grown|grown-up|full-grown|full|fully|half|partly|completely|newly|new|fresh|small|smaller|little|tiny|big|bigger|large|larger|tall|taller|short|shorter|growing|developing|developed|early|later|late|final|first|second|third|stage|before|after|start|end|scale|photographic|kind|type|picture|photo|image|view|showing|side-on|standing|sitting|lying|clear|cloudy|melting|melted|rusting|rusty|rusted|burning|burnt|burned|wilting|wilted|ripe|unripe|dry|wet|empty|some|more|less|much|still|now|then)$/i;

/** The words that name what a panel shows, without its stage words. */
export function subjectWords(shows: string): string[] {
  return shows
    .toLowerCase()
    .replace(/[^a-z\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STAGE.test(w))
    .map((w) => w.replace(/(?:ies)$/, "y").replace(/(?<=[^s])s$/, ""));
}

/**
 * A set about change across real time (dated, "in the past", a century): not a generated set.
 * Ruling 163: a real place or thing then and now is Commons or nothing, never a made "then".
 */
export function isHistoricalSet(shows: string[]): boolean {
  return shows.some((s) =>
    /\b(?:1[0-9]{3}|20[0-9]{2})s?\b|\bcentur(?:y|ies)\b|\bdecades?\b|\bin the past\b|\bvictorian\b|\bmedieval\b|\btudor\b|\bhistoric(?:al)?\b|\bancient\b|\bthen and now\b|\byears? (?:ago|later)\b/i.test(
      s,
    ),
  );
}

/**
 * True when the panels show one subject at different stages: a panel says "the same", or every
 * panel names a word in common once stage words are dropped ("flask" in each of a three-flask
 * sequence). A sequence of different things (a baby, a child, an adult) is not a set unless it
 * says so; a chick-to-hen sequence names different words, so the writer marks sequences (`always`).
 */
export function isSameSubjectSet(shows: string[], always = false): boolean {
  if (shows.length < 2) return false;
  if (always) return true;
  if (shows.slice(1).some((s) => /\bsame\b/i.test(s))) return true;
  const sets = shows.map((s) => new Set(subjectWords(s)));
  const [first, ...rest] = sets;
  return [...(first ?? [])].some((w) => rest.every((r) => r.has(w)));
}

/**
 * One picture of a set made alone (the partial-set fallback): the panel's own request as a single
 * image, in the set's look. Code's frame, written from the set frame's own sentences: it is not a
 * strip, so a request naming two subjects ("an adult dog beside a puppy") is one scene, never two
 * panels (two Year 1 slides came out as diptychs when the one-panel set frame was used).
 */
export function soloImagePrompt(shows: string, look?: LessonLook): string {
  const body = [
    `One single photograph, not divided into panels: ${shows.replace(/\s+/g, " ").trim().replace(/\.$/, "")}.`,
    "Every subject whole, on a plain light background.",
    "No text anywhere in the image: no words, letters, labels, signs, captions or numbers.",
  ].join("\n");
  if (look?.style === "illustration")
    return lessonIllustrationPrompt(body.replace("photograph", "picture"), look);
  return housePhoto(look) ? housePhotoPrompt(body, look) : body;
}

/** One strip for the set: wide enough that each panel holds a whole subject. */
export function setSize(n: number): ImageSize {
  if (n === 1) return "1024x1024";
  return n >= 3 ? "2048x1152" : "1536x1024";
}

/**
 * The one image a set is generated as. Code's frame: N equal panels left to
 * right with white gutters, the panels' own requests in order, the same individual subject at the
 * same scale and view on one plain background, no text. An illustration lesson's locked look
 * leads it, as on every other generation.
 */
export function setImagePrompt(shows: string[], look?: LessonLook, same = true): string {
  const n = shows.length;
  // One panel generated on its own (a partial set's missing stage): a single picture in the
  // strip's look, never a "1-panel strip" (that wording drew gutters and seams).
  if (n === 1) {
    const one = [
      `${(shows[0] ?? "").replace(/\s+/g, " ").trim().replace(/\.$/, "")}.`,
      "One single photograph, not divided into panels: the subject whole, seen side-on, on a plain light background.",
      "No text anywhere in the image: no words, letters, labels, signs, captions or numbers.",
    ].join("\n");
    if (look?.style === "illustration") return lessonIllustrationPrompt(one, look);
    return housePhoto(look) ? housePhotoPrompt(one, look) : one;
  }
  const body = [
    `One image divided into ${n} equal side-by-side panels separated by thin pure white gaps. Left to right: ${shows
      .map((s, i) => `(${i + 1}) ${s.replace(/\s+/g, " ").trim().replace(/\.$/, "")}`)
      .join("; ")}.`,
    same
      ? "Every panel shows the very same individual subject at a different stage: the same kind, colours and markings, seen from the same viewpoint and camera distance, whole, so its size follows its stage, on the same plain light background."
      : "The panels are a matched set to compare side by side: each subject whole, seen from the same viewpoint, at the same scale, in the same light, on the same plain light background.",
    "No text anywhere in the image: no words, letters, labels, signs, captions or numbers.",
  ].join("\n");
  if (look?.style === "illustration") return lessonIllustrationPrompt(body, look);
  return housePhoto(look) ? housePhotoPrompt(body, look) : body;
}

// ---------------------------------------------------------------------------------------------
// The set flow (TEACH-237), as base4 ran it: one strip of N panels at the set's shape; a strip
// that repeats a panel is refused; each panel judged alone against its own request, then one set
// judge over all of them. One strip only (a second strip doubled the cost on a Year 1 lesson and
// failed the same way): each panel the strip could not place gets one solo generation, judged
// alone. A panel that is still missing keeps its slot empty.
// ---------------------------------------------------------------------------------------------

/** How many strips a set may generate before the solo fallback (base4: one). */
export const STRIP_ATTEMPTS = 1;

/** One panel of a set, as the writer asks for it. */
export interface SetAsk {
  key: string;
  /** The slide's index (the judge's context). */
  index: number;
  shows: string;
  mustSee: string[];
  /** The slot's width over height; every panel of a set shares the first panel's. */
  aspect?: number;
  /** A named real thing: never generated as a set (ruling 163). */
  named?: boolean;
  /** False for compare cards of different things (a matched set, not one individual). */
  sameSubject?: boolean;
}

type Box = { item: string; left: number; top: number; right: number; bottom: number };

/** A placed panel: the stored picture, its credit and the judge's boxes. */
export interface SetPicture {
  key: string;
  src: string;
  alt: string;
  /** The request the picture was judged against. */
  request: string;
  aspect: number;
  source: PhotoSource;
  style: "photo" | "illustration" | "house";
  /** The set it was made in (a solo panel: `<set>#solo<k>`). */
  set: string;
  boxes?: Box[];
}

export interface PanelVerdict {
  ok: boolean;
  boxes?: Box[];
  why?: string;
}

export interface PictureSetDeps {
  generator: Pick<ImageGenerator, "model" | "generate">;
  /** Store one panel's PNG; its public src. */
  save(bytes: Uint8Array): Promise<{ id: string; src: string }>;
  /** One panel judged alone, on exactly the picture the slide will show. */
  judgePanel(ask: SetAsk, dataUrl: string, aspect: number): Promise<PanelVerdict>;
  /** The set judge over every panel; undefined when it could not answer (the set is not refused). */
  judgeSet(
    shows: string[],
    dataUrls: string[],
  ): Promise<{ same: boolean; odd: number[]; why?: string } | undefined>;
  /** May one more generation of `size` run (the daily cap)? Absent: always. */
  allow?(size: ImageSize): boolean | Promise<boolean>;
  /** What a generation cost, once it has run. */
  spent?(usd: number): void;
  signal?: AbortSignal;
  /** Ids, counts, costs and reasons only: never a prompt (ADR 0015). */
  log(event: Record<string, unknown>): void;
}

/**
 * True when these panels are made as one generated set: no named real thing, not a history
 * lesson, and not change across real time. Those take the director's per-picture ladder (Commons
 * first, ruling 163).
 */
export function setIsGenerated(asks: SetAsk[], lessonSubject: string): boolean {
  return (
    !asks.some((a) => a.named) &&
    !/^hist/i.test(lessonSubject) &&
    !isHistoricalSet(asks.map((a) => a.shows))
  );
}

/**
 * The brief a set panel is judged with. A panel must show its subject; the stage details
 * ("developing feathers") are the strip's job and the set judge's, not a per-panel must (a growing
 * chicken failed twice on "developing feathers" while the judge said it fit).
 */
export function panelBrief(ask: SetAsk, aspect: number): ImageBrief {
  const request = [ask.shows, ...ask.mustSee].join(". ");
  return {
    subject: plainSubject(ask.shows).slice(0, 60),
    request: request.slice(0, 400),
    mustShow: ask.mustSee.length ? ask.mustSee : mustShowOf(request).slice(0, 1),
    purpose: "context",
    specific: false,
    aspect: Math.round(aspect * 100) / 100,
  } as ImageBrief;
}

const dataUrl = (png: Uint8Array) => `data:image/png;base64,${Buffer.from(png).toString("base64")}`;

/** The style a set is made in, from the lesson's look. */
export function setStyle(look?: LessonLook): SetPicture["style"] {
  return look?.style === "illustration"
    ? "illustration"
    : look?.generic === "generate"
      ? "house"
      : "photo";
}

/** Every panel of the set, placed or undefined (its slot stays empty). Never throws but an abort. */
export async function makePictureSet(
  asks: SetAsk[],
  deps: PictureSetDeps,
  look?: LessonLook,
): Promise<(SetPicture | undefined)[]> {
  const setKey = asks.map((a) => a.key).join("+");
  const aspect = asks[0]?.aspect ?? 4 / 3;
  const style = setStyle(look);
  const shows = asks.map((a) => a.shows);
  const prompt = setImagePrompt(
    shows,
    look,
    asks.every((a) => a.sameSubject !== false),
  );
  const generate = async (p: string, size: ImageSize) => {
    if (deps.allow && !(await deps.allow(size))) {
      deps.log({ ev: "set-capped", set: setKey, size });
      return undefined;
    }
    const made = await deps.generator.generate({
      prompt: p,
      size,
      ...(deps.signal ? { signal: deps.signal } : {}),
    });
    deps.spent?.(made.costUsd);
    return made;
  };
  const place = async (
    a: SetAsk,
    panel: Uint8Array,
    boxes: Box[] | undefined,
    set: string,
  ): Promise<SetPicture> => {
    const saved = await deps.save(panel);
    return {
      key: a.key,
      src: saved.src,
      alt: a.shows,
      request: [a.shows, ...a.mustSee].join(". "),
      aspect,
      source: {
        provider: "generated",
        id: saved.id,
        pageUrl: "https://openai.com/policies/",
        photographer: `AI-generated (${deps.generator.model})`,
        photographerUrl: "https://openai.com/policies/",
        licence: `generated (${IMAGE_TERMS})`,
      } as PhotoSource,
      style,
      set,
      ...(boxes?.length ? { boxes } : {}),
    };
  };
  const rethrowAbort = (e: unknown) => {
    if (e instanceof Error && e.name === "AbortError") throw e;
  };
  deps.log({ ev: "set-start", set: setKey, n: asks.length, aspect });
  let best: { results: (SetPicture | undefined)[]; ok: number } | undefined;
  for (let attempt = 0; attempt < STRIP_ATTEMPTS; attempt++) {
    let panels: Uint8Array[];
    let usd = 0;
    try {
      const made = await generate(prompt, setSize(asks.length));
      // The daily cap is spent: every slot keeps its placeholder, and no solo is tried.
      if (!made) return asks.map(() => undefined);
      usd = made.costUsd;
      panels = splitPanels(made.bytes, asks.length, aspect);
      const dup = duplicatePanels(panels);
      if (dup.length)
        throw new Error(`strip repeats a panel: ${dup.map((pair) => pair.join("=")).join(", ")}`);
    } catch (e) {
      rethrowAbort(e);
      deps.log({ ev: "set-error", set: setKey, attempt, err: String(e).slice(0, 200) });
      break;
    }
    const urls = panels.map(dataUrl);
    const judged = await Promise.all(
      asks.map((a, k) =>
        deps.judgePanel(a, urls[k] ?? "", aspect).catch((e): PanelVerdict => {
          rethrowAbort(e);
          return { ok: false };
        }),
      ),
    );
    const same = await deps.judgeSet(shows, urls).catch((e) => {
      rethrowAbort(e);
      return undefined;
    });
    const odd = new Set(same?.odd ?? []);
    const pass = judged.map((j, k) => j.ok && (!same || same.same || !odd.has(k)));
    deps.log({
      ev: "set-attempt",
      set: setKey,
      attempt,
      usd,
      panels: judged.map((j) => j.ok),
      same: same ? same.same : "skipped",
      odd: [...odd],
    });
    const results = await Promise.all(
      asks.map((a, k) => {
        const bytes = panels[k];
        return pass[k] && bytes ? place(a, bytes, judged[k]?.boxes, setKey) : undefined;
      }),
    );
    const ok = results.filter(Boolean).length;
    if (!best || ok > best.ok) best = { results, ok };
    if (ok === asks.length) break;
  }
  // Partial-set fallback: each panel the strip could not place is generated alone, same request in
  // the lesson's look, cropped to the slot's shape and judged alone; placed panels are kept.
  const solo = async (a: SetAsk, k: number): Promise<SetPicture | undefined> => {
    try {
      const made = await generate(soloImagePrompt(a.shows, look), setSize(1));
      if (!made) return undefined;
      // One picture, not a strip: cropped to the card's shape, never split.
      const panel = splitPanels(made.bytes, 1, aspect)[0] ?? made.bytes;
      const verdict = await deps.judgePanel(a, dataUrl(panel), aspect);
      deps.log({ ev: "set-solo", set: setKey, key: a.key, ok: verdict.ok, usd: made.costUsd });
      if (!verdict.ok) return undefined;
      return await place(a, panel, verdict.boxes, `${setKey}#solo${k}`);
    } catch (e) {
      rethrowAbort(e);
      deps.log({ ev: "set-solo-error", set: setKey, key: a.key, err: String(e).slice(0, 200) });
      return undefined;
    }
  };
  const first = best?.results ?? asks.map(() => undefined);
  const out = await Promise.all(asks.map((a, k) => first[k] ?? solo(a, k)));
  deps.log({ ev: "set-done", set: setKey, placed: out.filter(Boolean).length, of: asks.length });
  return out;
}

/** The writer planner's judges for a set: judge v17 on each panel, the set judge over all. */
export function directedSetJudges(
  lesson: Lesson,
  deps: PipelineDeps,
): Pick<PictureSetDeps, "judgePanel" | "judgeSet"> {
  return {
    async judgePanel(ask, url, aspect) {
      let boxes: Box[] | undefined;
      let why: string | undefined;
      const ok = await judgeMadeDirected({
        lesson,
        index: ask.index,
        brief: panelBrief(ask, aspect),
        deps,
        dataUrl: url,
        onVerdict: (v) => {
          boxes = (v as { boxes?: Box[] }).boxes;
          why = v.why ?? undefined;
        },
      });
      return { ok, ...(boxes ? { boxes } : {}), ...(why ? { why } : {}) };
    },
    async judgeSet(shows, urls) {
      const call = await callStructured({
        deps,
        stage: "illustrate",
        cls: "standard",
        effort: "low",
        prompt: setJudgePrompt,
        input: { shows },
        schema: SetJudgeSchema,
        maxOutputTokens: SET_JUDGE_TOKENS,
        images: urls.map((url, i) => ({ id: `panel-${i + 1}`, url })),
      });
      const o = call.output;
      return { same: o.same, odd: o.odd, ...(o.why ? { why: o.why } : {}) };
    },
  };
}
