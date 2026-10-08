// lib arm renderer: a library model through the library's own engine (mountSlide) in Playwright.
// The final build (the summary, every build shown) is cropped to the drawing and handed to the slide
// as a PNG in its figure zone (the photo path: the editor's inline-SVG sanitiser drops an <image href>,
// so an SVG wrapper would show an empty box); the builds strip is saved beside it for review.
import { mkdirSync, writeFileSync } from "node:fs";
// @ts-expect-error untyped .mjs path (render.ts imports Playwright the same way)
import { chromium as pw } from "../../../apps/web/node_modules/@playwright/test/index.mjs";
import type { Drawn } from "./lib";

const PAGE = `file://${import.meta.dir}/lib-render.html`;
/** The light theme (the library's warm primary theme on a light page). */
export const LIB_THEME = "primary";
const SCALE = 1.5;

type Box = { x: number; y: number; width: number; height: number };
type El = { screenshot: () => Promise<Buffer>; boundingBox: () => Promise<Box | null> };
type Page = {
  on: (ev: string, f: (e: Error) => void) => void;
  goto: (u: string) => Promise<unknown>;
  waitForSelector: (s: string, o: object) => Promise<unknown>;
  evaluate: <A>(f: (a: A) => unknown, a?: A) => Promise<unknown>;
  $: (s: string) => Promise<El | null>;
  screenshot: (o: object) => Promise<Buffer>;
  setContent: (h: string) => Promise<unknown>;
};
const chromium = pw as {
  launch: (
    o: object,
  ) => Promise<{ newPage: (o?: object) => Promise<Page>; close: () => Promise<void> }>;
};
/** The render page's api (lib-render.html). */
type Libr = {
  render: (id: string, p: object, theme: string) => Promise<{ N: number; warnings: string[] }>;
  show: (k: number) => string[];
  bbox: () => { x: number; y: number; w: number; h: number };
};

let open: Promise<{ close: () => Promise<void>; page: Page; sheet: Page }> | undefined;
let idle: ReturnType<typeof setTimeout> | undefined;
let queue: Promise<unknown> = Promise.resolve();

function browser() {
  open ??= (async () => {
    const b = await chromium.launch({ args: ["--allow-file-access-from-files"] });
    const page = await b.newPage({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: SCALE,
      colorScheme: "light",
      reducedMotion: "reduce",
    });
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(e.message));
    await page.goto(PAGE);
    await page
      .waitForSelector('html[data-ready="1"]', { timeout: 20000, state: "attached" })
      .catch(() => {
        throw new Error(`lib-render page did not load: ${errors.join(" | ")}`);
      });
    const sheet = await b.newPage({ viewport: { width: 1310, height: 400 } });
    return { close: () => b.close(), page, sheet };
  })();
  return open;
}
/** Closes the browser (also done 5 s after the last render, so a run's process can exit). */
export async function closeRenderer() {
  if (idle) clearTimeout(idle);
  const o = open;
  open = undefined;
  if (o) await (await o).close();
}

/** Final build into a drawn figure (light theme, no title: the slide's heading is the title), plus frames. */
export function renderModel(
  id: string,
  params: Record<string, unknown>,
  outDir?: string,
): Promise<Drawn & { warnings: string[]; frames: number }> {
  const job = queue.then(async () => {
    if (idle) clearTimeout(idle);
    const { page, sheet } = await browser();
    const p = { ...params, title: "" };
    const { N, warnings } = (await page.evaluate(
      ([i, pp, t]: [string, object, string]) =>
        (globalThis as unknown as { LIBR: Libr }).LIBR.render(i, pp, t),
      [id, p, LIB_THEME] as [string, object, string],
    )) as { N: number; warnings: string[] };
    const el = await page.$("#host .slide");
    if (!el) throw new Error(`model ${id} mounted no slide`);
    const frames: Buffer[] = [];
    const warn = new Set(warnings);
    for (let k = 0; k <= N; k++) {
      for (const w of (await page.evaluate(
        (kk: number) => (globalThis as unknown as { LIBR: Libr }).LIBR.show(kk),
        k,
      )) as string[])
        warn.add(w);
      if (outDir) frames.push(await el.screenshot());
    }
    // Final build (k = N is the summary, every build shown), cropped to the drawing.
    const box = (await page.evaluate(() =>
      (globalThis as unknown as { LIBR: Libr }).LIBR.bbox(),
    )) as { x: number; y: number; w: number; h: number };
    const sb = (await el.boundingBox())!;
    const png = await page.screenshot({
      clip: { x: sb.x + box.x, y: sb.y + box.y, width: box.w, height: box.h },
    });
    const w = Math.round(box.w);
    const h = Math.round(box.h);
    if (outDir) {
      mkdirSync(outDir, { recursive: true });
      writeFileSync(`${outDir}/final.png`, png);
      for (const [k, f] of frames.entries()) writeFileSync(`${outDir}/build-${k}.png`, f);
      const imgs = frames
        .map(
          (f) =>
            `<img src="data:image/png;base64,${f.toString("base64")}" style="width:640px;display:block">`,
        )
        .join("");
      await sheet.setContent(
        `<body style="margin:0;padding:10px;background:#777;display:grid;grid-template-columns:repeat(2,640px);gap:10px">${imgs}</body>`,
      );
      await sheet.screenshot({ path: `${outDir}/strip.png`, fullPage: true });
    }
    idle = setTimeout(() => void closeRenderer(), 5000);
    return {
      src: `data:image/png;base64,${png.toString("base64")}`,
      aspect: w / h,
      warnings: [...warn],
      frames: N + 1,
    };
  });
  queue = job.catch(() => undefined);
  return job;
}
