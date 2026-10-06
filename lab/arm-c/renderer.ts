// Arm C: one Chromium for the lesson. Renders a wrapped slide, runs the DOM check, takes 1440 shots.
import {
  type Browser,
  type BrowserContext,
  chromium,
} from "../../node_modules/.bun/playwright@1.62.1/node_modules/playwright/index.mjs";
import { check, type Geometry } from "./geometry.ts";

export class Renderer {
  private browser!: Browser;
  private big!: BrowserContext;
  private shot!: BrowserContext;
  async start() {
    this.browser = await chromium.launch();
    this.big = await this.browser.newContext({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
    });
    this.shot = await this.browser.newContext({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 0.75,
    });
  }
  private async open(ctx: BrowserContext, file: string) {
    const page = await ctx.newPage();
    await page.goto(`file://${file}`, { waitUntil: "load", timeout: 30_000 });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(
        [...document.images].map((i) =>
          i.complete
            ? null
            : new Promise((r) => {
                i.onload = i.onerror = r;
              }),
        ),
      );
    });
    return page;
  }
  /** Geometry of the page at `file` (1920x1080). */
  async measure(file: string, minFont: number): Promise<Geometry> {
    const page = await this.open(this.big, file);
    try {
      return await page.evaluate(check, { minFont });
    } finally {
      await page.close();
    }
  }
  /** PNG 1440x810 of the page at `file`. */
  async png(file: string, out: string): Promise<void> {
    const page = await this.open(this.shot, file);
    try {
      await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1920, height: 1080 } });
    } finally {
      await page.close();
    }
  }
  async stop() {
    await this.browser?.close();
  }
}
