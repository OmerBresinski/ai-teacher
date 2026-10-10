/**
 * Library model font PR screenshots (TEACH-247 part o). Opt-in, never in CI:
 * `TEACH_SCREENSHOTS=1 SHOT_DIR=<dir> LIB_LESSONS=<a.json,b.json> bunx playwright test e2e/library-font-screenshots.spec.ts`
 *
 * Each lesson holds library model drawings, one per slide. For every slide: the editor at 1440 on
 * the light theme, the drawing alone, and the PNG the PowerPoint export embeds for it.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Lesson } from "@tj/domain/documents";
import JSZip from "jszip";
import { E2E_API_URL, E2E_WEB_URL, expect, test } from "./fixtures";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "screenshots are opt-in");
test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(600_000);

const OUT = process.env.SHOT_DIR ?? "/tmp/library-font";
const LESSONS = (process.env.LIB_LESSONS ?? "").split(",").filter(Boolean);

test("shoots each library model in the editor and the PowerPoint export", async ({
  signedInPage: { page },
}) => {
  await page.addInitScript(() => localStorage.setItem("tj-theme", "light"));
  for (const file of LESSONS) {
    const name = path.basename(file, ".json");
    const dir = path.join(OUT, name);
    mkdirSync(dir, { recursive: true });
    const body = JSON.parse(readFileSync(file, "utf8")) as Lesson;
    const res = await page.request.post(`${E2E_API_URL}/__test/seed-library`, {
      headers: { origin: E2E_WEB_URL },
      data: { documents: [{ key: "lib", kind: "lesson", body }] },
    });
    expect(res.ok(), `seed failed: ${res.status()} ${await res.text()}`).toBe(true);
    const { ids } = (await res.json()) as { ids: Record<string, string> };
    await page.goto(`/l/${ids.lib}`);
    const rows = page.getByRole("listbox", { name: "Slides" }).getByRole("option");
    for (let n = 1; n <= body.slides.length; n++) {
      const slideId = body.slides[n - 1]?.id ?? String(n);
      await rows.nth(n - 1).click();
      const diagram = page.locator('[data-slide-frame] img[src^="data:image/svg"]').first();
      await expect(diagram).toBeVisible();
      await page.waitForTimeout(900);
      await page.screenshot({ path: path.join(dir, `${slideId}-editor.png`) });
      await diagram.screenshot({ path: path.join(dir, `${slideId}-editor-diagram.png`) });
    }
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Export" });
    await dialog.getByRole("tab", { name: "PowerPoint" }).click();
    const download = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Export PowerPoint" }).click();
    const zip = await JSZip.loadAsync(readFileSync(await (await download).path()));
    for (let n = 1; n <= body.slides.length; n++) {
      const slideId = body.slides[n - 1]?.id ?? String(n);
      const rels = (await zip.file(`ppt/slides/_rels/slide${n}.xml.rels`)?.async("string")) ?? "";
      const media = Array.from(rels.matchAll(/Target="\.\.\/media\/([^"]+\.png)"/g), (m) => m[1]);
      let i = 0;
      for (const m of media) {
        const f = zip.file(`ppt/media/${m}`);
        if (f)
          writeFileSync(path.join(dir, `${slideId}-pptx-${i++}.png`), await f.async("nodebuffer"));
      }
      expect(i, `slide ${n} has no image in the PowerPoint`).toBeGreaterThan(0);
    }
    await page.keyboard.press("Escape");
  }
});
