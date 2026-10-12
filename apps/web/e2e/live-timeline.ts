import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";

/*
 * Live writing P0 (TEACH-202 part d): a timeline of what a teacher sees while a lesson writes.
 * A sampler in the page records, every 50 ms, which view is up (the generating shell or the
 * editor), how many slides the strip shows, the open slide, the slide being written, the open
 * slide's text length and its pictures, and the pictures in the strip. Frames are captured on a
 * slower clock with their timestamps, for a person's eye only. `metrics` turns the samples into
 * the numbers the live writing phases are measured by: first layout, first text, the editor's
 * open slide following the slide being written, and each picture becoming visible.
 *
 * Times are milliseconds from `t0` (the caller's start, e.g. the click that starts the job).
 */

export type TimelineSample = {
  t: number;
  view: "shell" | "editor" | "other";
  /** Slides in the strip (the shell's thumbs or the editor's). */
  slides: number;
  /** The open slide's index in the strip, -1 when none is marked. */
  active: number;
  /** The newest slide marked "Writing…" in the editor's strip, -1 when none. */
  writing: number;
  /** Characters of text on the open slide. */
  text: number;
  /** Loaded, visible photographs on the open slide (not placeholders). */
  pictures: number;
  /** Photo placeholders on the open slide. */
  placeholders: number;
  /** Loaded photographs across the strip's thumbnails. */
  stripPictures: number;
};

export type TimelineMetrics = {
  firstLayoutMs: number | null;
  firstTextMs: number | null;
  editorOpenMs: number | null;
  /** Each time the slide being written changed in the editor: how long until it was open. */
  follow: { writing: number; atMs: number; followedAfterMs: number | null }[];
  /** Each time the strip's or the open slide's picture count rose. */
  pictures: { atMs: number; where: "strip" | "open"; count: number }[];
  /** Pictures shown in the strip before the editor stopped marking any slide "Writing…". */
  picturesWhileWriting: number;
  doneMs: number | null;
};

/** One animation frame where the open slide's words, draft state or caret changed (P5-P7). */
export type WordSample = {
  t: number;
  /** The open slide's index in the strip (the shell's newest counts as its own). */
  active: number;
  /** The open slide's id, when the canvas names it. */
  slide: string | null;
  words: number;
  /** The canvas shows a draft (`data-live-slide`). */
  live: boolean;
  caret: boolean;
};

export type WordMetrics = {
  /** First frame a draft's words were on screen. */
  firstDraftWordsMs: number | null;
  /** Each slide shown from drafts: its word counts while live, and its steps. */
  slides: {
    slide: string;
    firstMs: number;
    lastLiveMs: number;
    distinct: number;
    maxStep: number;
  }[];
  /** The largest step in words between two frames on a live slide. */
  maxStep: number;
  /** Frames where the open slide (same id) lost words: a draft or hand-over flicker. */
  drops: { t: number; slide: string; from: number; to: number }[];
  /** Hand-overs (a live slide shown from its saved copy next frame): words before and after. */
  handovers: { t: number; slide: string; before: number; after: number }[];
  caretFrames: number;
};

declare global {
  interface Window {
    __liveTimeline?: TimelineSample[];
    __liveWords?: WordSample[];
  }
}

/** Every animation frame: the open slide's words and whether it is a draft, kept when changed. */
function wordSampler(t0: number) {
  window.__liveWords = [];
  let last = "";
  const frame = () => {
    const shell = document.querySelector("[data-testid=generating-shell]");
    const nav = document.querySelector("[data-navigator]");
    const thumbs = shell
      ? [...document.querySelectorAll("[data-generating-thumb]")]
      : nav
        ? [...nav.querySelectorAll("[role=option]")]
        : [];
    const active = thumbs.findIndex(
      (el) =>
        el.getAttribute("aria-current") === "true" ||
        (!shell && el.getAttribute("aria-selected") === "true"),
    );
    const canvas = document.querySelector("[data-canvas-content], [data-canvas-slide]");
    const live = !!document.querySelector("[data-live-slide]");
    const slide =
      document.querySelector("[data-live-slide]")?.getAttribute("data-live-slide") ??
      canvas?.getAttribute("data-canvas-slide") ??
      (active >= 0 ? `#${active}` : null);
    const text = (canvas?.textContent ?? "").trim();
    const words = text ? text.split(/\s+/).length : 0;
    const caret = !!document.querySelector("[data-live-caret]");
    const key = `${active}|${slide}|${words}|${live}|${caret}`;
    if (key !== last) {
      last = key;
      window.__liveWords?.push({ t: Date.now() - t0, active, slide, words, live, caret });
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

export function wordMetrics(samples: WordSample[]): WordMetrics {
  const slides = new Map<
    string,
    { firstMs: number; lastLiveMs: number; seen: Set<number>; maxStep: number }
  >();
  const drops: WordMetrics["drops"] = [];
  const handovers: WordMetrics["handovers"] = [];
  let maxStep = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1] as WordSample;
    const b = samples[i] as WordSample;
    if (b.live && b.slide) {
      const s = slides.get(b.slide) ?? {
        firstMs: b.t,
        lastLiveMs: b.t,
        seen: new Set(),
        maxStep: 0,
      };
      s.seen.add(b.words);
      s.lastLiveMs = b.t;
      if (a.live && a.slide === b.slide && b.words > a.words) {
        s.maxStep = Math.max(s.maxStep, b.words - a.words);
        maxStep = Math.max(maxStep, b.words - a.words);
      }
      slides.set(b.slide, s);
    }
    if (
      a.slide &&
      a.slide === b.slide &&
      a.active === b.active &&
      b.words < a.words &&
      (a.live || b.live)
    )
      drops.push({ t: b.t, slide: b.slide, from: a.words, to: b.words });
    if (a.live && !b.live && a.slide && (b.slide === a.slide || b.active === a.active))
      handovers.push({ t: b.t, slide: a.slide, before: a.words, after: b.words });
  }
  return {
    firstDraftWordsMs: samples.find((s) => s.live && s.words > 0)?.t ?? null,
    slides: [...slides].map(([slide, s]) => ({
      slide,
      firstMs: s.firstMs,
      lastLiveMs: s.lastLiveMs,
      distinct: s.seen.size,
      maxStep: s.maxStep,
    })),
    maxStep,
    drops,
    handovers,
    caretFrames: samples.filter((s) => s.caret).length,
  };
}

/** The in-page sampler: installed on every document the page loads, from `t0` (epoch ms). */
function sampler(t0: number) {
  const picturesIn = (root: Element | null) =>
    root
      ? [...root.querySelectorAll("img")].filter(
          (img) =>
            img.complete &&
            img.naturalWidth > 0 &&
            !img.src.startsWith("data:image/svg+xml") &&
            Number(getComputedStyle(img).opacity) > 0.5,
        ).length
      : 0;
  window.__liveTimeline = [];
  const tick = () => {
    const shell = document.querySelector("[data-testid=generating-shell]");
    const nav = document.querySelector("[data-navigator]");
    const view = shell ? "shell" : nav ? "editor" : "other";
    const thumbs = shell
      ? [...document.querySelectorAll("[data-generating-thumb]")]
      : nav
        ? [...nav.querySelectorAll("[role=option]")]
        : [];
    const active = thumbs.findIndex(
      (el) =>
        el.getAttribute("aria-current") === "true" ||
        (!shell && el.getAttribute("aria-selected") === "true"),
    );
    // The newest slide marked "Writing…": the objectives slide stays marked until the job ends.
    const marked = thumbs.map((el) => !!el.querySelector("[data-slide-writing]"));
    const writing = shell ? -1 : marked.lastIndexOf(true);
    const slide = document.querySelector("[data-canvas-content], [data-canvas-slide]");
    window.__liveTimeline?.push({
      t: Date.now() - t0,
      view,
      slides: thumbs.length,
      active,
      writing,
      text: (slide?.textContent ?? "").replace(/\s+/g, "").length,
      pictures: picturesIn(slide),
      placeholders: slide?.querySelectorAll("[data-slot-placeholder=photo]").length ?? 0,
      stripPictures: picturesIn(
        shell ? shell.querySelector("[data-testid=generating-strip]") : nav,
      ),
    });
  };
  setInterval(tick, 50);
}

export async function startTimeline(
  page: Page,
  opts: { t0?: number; outDir?: string; frameMs?: number } = {},
) {
  const t0 = opts.t0 ?? Date.now();
  await page.addInitScript(sampler, t0);
  await page.evaluate(sampler, t0);
  await page.addInitScript(wordSampler, t0);
  await page.evaluate(wordSampler, t0);
  const frames: { t: number; file: string }[] = [];
  let running = true;
  // Each run gets its own new frames folder (named by its start time): frames are named by their
  // time from t0, so two runs in one folder interleave and a gif made from it jumps between runs.
  const framesDir = opts.outDir
    ? join(opts.outDir, `frames-${new Date(t0).toISOString().replace(/[:.]/g, "-")}`)
    : undefined;
  if (framesDir) {
    if (existsSync(framesDir)) throw new Error(`frames folder already exists: ${framesDir}`);
    mkdirSync(framesDir, { recursive: true });
  }
  const capture = (async () => {
    while (running && framesDir) {
      const t = Date.now() - t0;
      const file = join(framesDir, `${String(t).padStart(6, "0")}.png`);
      await page.screenshot({ path: file }).catch(() => undefined);
      frames.push({ t, file });
      await new Promise((r) => setTimeout(r, opts.frameMs ?? 500));
    }
  })();
  return {
    t0,
    async stop() {
      running = false;
      await capture;
      const samples = await page.evaluate(() => window.__liveTimeline ?? []);
      const words = await page.evaluate(() => window.__liveWords ?? []);
      const result = {
        framesDir,
        samples,
        words,
        frames,
        metrics: timelineMetrics(samples),
        wordMetrics: wordMetrics(words),
      };
      if (opts.outDir && framesDir)
        writeFileSync(join(framesDir, "timeline.json"), JSON.stringify(result, null, 2));
      return result;
    },
  };
}

export function timelineMetrics(samples: TimelineSample[]): TimelineMetrics {
  const first = (ok: (s: TimelineSample) => boolean) => samples.find(ok)?.t ?? null;
  const follow: TimelineMetrics["follow"] = [];
  const pictures: TimelineMetrics["pictures"] = [];
  let writing = -1;
  let strip = 0;
  let open = 0;
  let lastWriting: number | null = null;
  for (const [i, s] of samples.entries()) {
    if (s.view === "editor" && s.writing >= 0 && s.writing !== writing) {
      writing = s.writing;
      const at = samples.slice(i).find((x) => x.writing !== writing || x.active === writing);
      follow.push({
        writing,
        atMs: s.t,
        followedAfterMs: at && at.active === writing ? at.t - s.t : null,
      });
    }
    if (s.view === "editor" && s.writing >= 0) lastWriting = s.t;
    if (s.stripPictures > strip)
      pictures.push({ atMs: s.t, where: "strip", count: s.stripPictures });
    if (s.pictures > open) pictures.push({ atMs: s.t, where: "open", count: s.pictures });
    strip = s.stripPictures;
    open = s.pictures;
  }
  const picturesWhileWriting =
    lastWriting === null
      ? 0
      : Math.max(0, ...samples.filter((s) => s.t <= lastWriting).map((s) => s.stripPictures));
  return {
    firstLayoutMs: first((s) => s.slides > 0),
    firstTextMs: first((s) => s.text > 0),
    editorOpenMs: first((s) => s.view === "editor"),
    follow,
    pictures,
    picturesWhileWriting,
    doneMs: lastWriting,
  };
}
