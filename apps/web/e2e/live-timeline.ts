import { mkdirSync, writeFileSync } from "node:fs";
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

declare global {
  interface Window {
    __liveTimeline?: TimelineSample[];
  }
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
  const frames: { t: number; file: string }[] = [];
  let running = true;
  const framesDir = opts.outDir ? join(opts.outDir, "frames") : undefined;
  if (framesDir) mkdirSync(framesDir, { recursive: true });
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
      const result = { samples, frames, metrics: timelineMetrics(samples) };
      if (opts.outDir)
        writeFileSync(join(opts.outDir, "timeline.json"), JSON.stringify(result, null, 2));
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
