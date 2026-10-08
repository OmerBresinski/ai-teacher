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
  pngSize,
  splitGrid,
  splitPanels,
} from "@tj/images";
import { callStructured } from "../call";
import { SET_JUDGE_TOKENS, SetJudgeSchema, setJudgePrompt } from "../prompts/set-judge";
import type { PipelineDeps } from "../types";
import { nonFatal, whenNonFatal } from "../writer/services";
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

/**
 * One strip for the set: wide enough that each panel holds a whole subject. Two panels take the
 * wide size (about 1000x1152 each, 0.87: inside the picture slots' ranges; base4's 1536x1024 gave
 * 0.72 panels). Sets of 3 or 4 are a 2x2 grid (`GRID_SIZE`) or single pictures, never a strip.
 */
export function setSize(n: number): ImageSize {
  return n === 1 ? "1024x1024" : "2048x1152";
}

/** A 2x2 grid's size: 3:2 panels (about 750x500), inside every tile and compare range. */
export const GRID_SIZE: ImageSize = "1536x1024";

/**
 * Sets of 3 or 4 as one 2x2 grid (true) or as single pictures (false, about $0.015-0.02 a set).
 * The grid is new against base4 and stays off until a paid Year 1 check passes.
 */
export const SET_GRID_DEFAULT = false;

/**
 * The prompt-engineer's 2x2 grid opener, byte for byte (`picture-set.test.ts` holds its sha256).
 * Code fills `{{n}}` and `{{panels}}` (the numbered list, reading order).
 */
export const TILE_GRID_OPENER = `One image divided into a 2 by 2 grid of {{n}} equal panels separated by thin pure white gaps, each subject centred in its own panel with clear margin on every side, never crossing a gap. Left to right, top to bottom: {{panels}}.
`;

/**
 * The one image a set of 3 or 4 is generated as on the grid path: always 4 panels, a set of 3
 * filled with a spare (its first picture again), then base4's same-subject or matched-set line and
 * the no-text line.
 */
export function gridImagePrompt(shows: string[], look?: LessonLook, same = true): string {
  const cells = [0, 1, 2, 3].map((j) => shows[j % shows.length] ?? "");
  const listed = cells
    .map((s, i) => `(${i + 1}) ${s.replace(/\s+/g, " ").trim().replace(/\.$/, "")}`)
    .join("; ");
  const strip = setImagePrompt(cells, undefined, same).split("\n");
  const body = [
    TILE_GRID_OPENER.trim().replaceAll("{{n}}", "4").replaceAll("{{panels}}", listed),
    ...strip.slice(1),
  ].join("\n");
  if (look?.style === "illustration") return lessonIllustrationPrompt(body, look);
  return housePhoto(look) ? housePhotoPrompt(body, look) : body;
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
// The set flow (TEACH-237). Base4's for a strip: one strip (2 panels, or 5 and more); a strip
// that repeats a panel is refused; each panel judged alone against its own request, then one set
// judge over all of them; each panel the strip could not place gets one solo generation, judged
// alone. New against base4: sets of 3 or 4 are single pictures by default, or one 2x2 grid behind
// `SET_GRID_DEFAULT` (base4's 3- and 4-panel strips gave panels too tall for any slot). Panels are
// never cropped to the slot: the slide takes each at its own shape within the slot's range.
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
  /** Sets of 3 or 4 as one 2x2 grid; absent, `SET_GRID_DEFAULT` (single pictures). */
  grid?: boolean;
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

/** How a set is generated: one strip (2, or 5 and more), a 2x2 grid, or single pictures. */
export function setMode(n: number, grid = SET_GRID_DEFAULT): "strip" | "grid" | "solo" {
  if (n === 3 || n === 4) return grid ? "grid" : "solo";
  return n >= 2 ? "strip" : "solo";
}

/** Every panel of the set, placed or undefined (its slot stays empty). Never throws but an abort. */
export async function makePictureSet(
  asks: SetAsk[],
  deps: PictureSetDeps,
  look?: LessonLook,
): Promise<(SetPicture | undefined)[]> {
  const setKey = asks.map((a) => a.key).join("+");
  const slotAspect = asks[0]?.aspect ?? 4 / 3;
  const style = setStyle(look);
  const shows = asks.map((a) => a.shows);
  const same = asks.every((a) => a.sameSubject !== false);
  const mode = setMode(asks.length, deps.grid);
  let capped = false;
  const generate = async (p: string, size: ImageSize) => {
    if (capped || (deps.allow && !(await deps.allow(size)))) {
      if (!capped) deps.log({ ev: "set-capped", set: setKey, size });
      capped = true;
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
    const dims = pngSize(panel);
    return {
      key: a.key,
      src: saved.src,
      alt: a.shows,
      request: [a.shows, ...a.mustSee].join(". "),
      // The panel's own shape: the slot takes it within its range (nothing is cropped here).
      aspect: dims ? dims.width / dims.height : slotAspect,
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
  // A budget stop or an abort (`isFatal`) stops the set: no more paid pictures once the budget is gone.
  const judge = (a: SetAsk, url: string) =>
    deps.judgePanel(a, url, slotAspect).catch(whenNonFatal((): PanelVerdict => ({ ok: false })));
  deps.log({ ev: "set-start", set: setKey, n: asks.length, mode, aspect: slotAspect });

  /** Panels judged alone and as a set; each passing panel placed. */
  const settle = async (panels: Uint8Array[], judged: PanelVerdict[], usd: number, set: string) => {
    const urls = panels.map(dataUrl);
    const verdict = await deps.judgeSet(shows, urls).catch(whenNonFatal(() => undefined));
    const odd = new Set(verdict?.odd ?? []);
    const pass = judged.map((j, k) => j.ok && (!verdict || verdict.same || !odd.has(k)));
    deps.log({
      ev: "set-attempt",
      set: setKey,
      mode,
      usd,
      panels: judged.map((j) => j.ok),
      same: verdict ? verdict.same : "skipped",
      odd: [...odd],
    });
    return Promise.all(
      asks.map((a, k) => {
        const bytes = panels[k];
        return pass[k] && bytes ? place(a, bytes, judged[k]?.boxes, set) : undefined;
      }),
    );
  };

  let first: (SetPicture | undefined)[] = asks.map(() => undefined);
  const attempt = async (): Promise<(SetPicture | undefined)[] | "none" | undefined> => {
    if (mode === "strip") {
      // Base4: one strip only (a second doubled the cost and failed the same way).
      for (let attempt = 0; attempt < STRIP_ATTEMPTS; attempt++) {
        const made = await generate(setImagePrompt(shows, look, same), setSize(asks.length));
        if (!made) return "none";
        const panels = splitPanels(made.bytes, asks.length);
        const dup = duplicatePanels(panels);
        if (dup.length)
          throw new Error(`strip repeats a panel: ${dup.map((pair) => pair.join("=")).join(", ")}`);
        const judged = await Promise.all(
          asks.map((a, k) => judge(a, dataUrl(panels[k] ?? new Uint8Array()))),
        );
        first = await settle(panels, judged, made.costUsd, setKey);
        if (first.every(Boolean)) break;
      }
    } else if (mode === "grid") {
      // One 2x2 grid; a set of 3 has a spare cell (its first picture again). Every cell is judged
      // against its picture; a picture takes its own cell when that passes, else its spare.
      const made = await generate(gridImagePrompt(shows, look, same), GRID_SIZE);
      if (!made) return "none";
      const cells = splitGrid(made.bytes, 4, { cols: 2, rows: 2 });
      const n = asks.length;
      const all = await Promise.all(
        cells.map((cell, j) => judge(asks[j % n] as SetAsk, dataUrl(cell))),
      );
      const pick = asks.map((_, i) =>
        all[i]?.ok ? i : ([i + n].find((j) => j < 4 && all[j]?.ok) ?? i),
      );
      const panels = pick.map((j) => cells[j] ?? new Uint8Array());
      const judged = pick.map((j) => all[j] ?? { ok: false });
      // Two pictures of the set on near-identical cells: the later one fails.
      for (const [a, b] of duplicatePanels(panels)) judged[Math.max(a, b)] = { ok: false };
      deps.log({ ev: "grid-pick", set: setKey, judged: all.map((v) => v.ok), pick });
      first = await settle(panels, judged, made.costUsd, setKey);
    } else {
      // Single pictures (the default for 3 or 4 until the grid's paid check): each made alone in
      // the lesson's look, judged alone, then all of them by the set judge.
      const made = await Promise.all(
        asks.map(async (a) => {
          const m = await generate(soloImagePrompt(a.shows, look), setSize(1));
          return m ? m : undefined;
        }),
      );
      if (made.every((m) => !m)) return "none";
      const panels = made.map((m) => m?.bytes ?? new Uint8Array());
      const judged = await Promise.all(
        asks.map((a, k) => (made[k] ? judge(a, dataUrl(panels[k] as Uint8Array)) : { ok: false })),
      );
      const usd = made.reduce((t, m) => t + (m?.costUsd ?? 0), 0);
      first = await settle(panels, judged, usd, `${setKey}#solo`);
    }
    return undefined;
  };
  const tried = await nonFatal(attempt, (e) => {
    deps.log({ ev: "set-error", set: setKey, mode, err: String(e).slice(0, 200) });
    return undefined;
  });
  if (tried === "none") return asks.map(() => undefined);
  // Partial-set fallback (one regenerate per slot): each panel not placed is generated alone, same
  // request in the lesson's look, judged alone; placed panels are kept.
  const solo = (a: SetAsk, k: number): Promise<SetPicture | undefined> =>
    nonFatal(
      async () => {
        const made = await generate(soloImagePrompt(a.shows, look), setSize(1));
        if (!made) return undefined;
        const verdict = await deps.judgePanel(a, dataUrl(made.bytes), slotAspect);
        deps.log({ ev: "set-solo", set: setKey, key: a.key, ok: verdict.ok, usd: made.costUsd });
        if (!verdict.ok) return undefined;
        return await place(a, made.bytes, verdict.boxes, `${setKey}#solo${k}`);
      },
      (e) => {
        deps.log({ ev: "set-solo-error", set: setKey, key: a.key, err: String(e).slice(0, 200) });
        return undefined;
      },
    );
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
