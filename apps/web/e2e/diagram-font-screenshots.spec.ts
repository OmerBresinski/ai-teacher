/**
 * Diagram font PR screenshots. Opt-in, never in CI:
 * `TEACH_SCREENSHOTS=1 SHOT_DIR=<dir> FONT_LESSON=<lesson.json> bunx playwright test e2e/diagram-font-screenshots.spec.ts`
 *
 * A generated lesson whose drawn diagram (a Splash table, body face Nunito) collided on screen:
 * "Marching" ran into "112" because the SVG, shown through <img>, fell back to Verdana. Shoots the
 * diagram slide in the editor, on the Present stage, as a rail thumbnail, on the print route (the
 * PDF), and the PNG the PowerPoint export embeds, so before/after can be compared surface by surface.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Lesson } from "@tj/domain/documents";
import JSZip from "jszip";
import { E2E_API_URL, E2E_WEB_URL, expect, test } from "./fixtures";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "screenshots are opt-in");
test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(180_000);

const OUT = process.env.SHOT_DIR ?? "/tmp/diagram-font";
const LESSON = process.env.FONT_LESSON ?? "";
/** The slide holding the "Marching" table (1-based). */
const N = Number(process.env.FONT_SLIDE ?? 8);

test("shoots the Marching diagram on every surface", async ({ signedInPage: { page } }) => {
  mkdirSync(OUT, { recursive: true });
  await page.addInitScript(() => localStorage.setItem("tj-theme", "light"));
  const body = JSON.parse(readFileSync(LESSON, "utf8")) as Lesson;
  const res = await page.request.post(`${E2E_API_URL}/__test/seed-library`, {
    headers: { origin: E2E_WEB_URL },
    data: { documents: [{ key: "font", kind: "lesson", body: { ...body, id: "font-lesson" } }] },
  });
  expect(res.ok(), `seed failed: ${res.status()} ${await res.text()}`).toBe(true);
  const { ids } = (await res.json()) as { ids: Record<string, string> };
  const id = ids.font;

  // Editor.
  await page.goto(`/l/${id}`);
  const rows = page.getByRole("listbox", { name: "Slides" }).getByRole("option");
  await rows.nth(N - 1).click();
  const diagram = page.locator('[data-slide-frame] img[src^="data:image/svg"]').first();
  await expect(diagram).toBeVisible();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, "editor.png") });
  await diagram.screenshot({ path: path.join(OUT, "editor-diagram.png") });
  writeFileSync(
    path.join(OUT, "editor-src-head.txt"),
    ((await diagram.getAttribute("src")) ?? "").slice(0, 400),
  );

  // Thumbnail in the slide rail.
  await rows.nth(N - 1).scrollIntoViewIfNeeded();
  await rows.nth(N - 1).screenshot({ path: path.join(OUT, "thumbnail.png") });

  // Present.
  await page.goto(`/l/${id}/present?slide=${N}`);
  await expect(page.locator('[data-slide-mode="present"]')).toHaveCount(1);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, "present.png") });

  // PDF: the print route, as the browser prints it, once it says it has painted.
  await page.goto(`/l/${id}/print`);
  await expect(page.locator("html[data-capture-ready]")).toHaveCount(1, { timeout: 60_000 });
  await page.emulateMedia({ media: "print" });
  await page.pdf({ path: path.join(OUT, "lesson.pdf"), landscape: true, printBackground: true });
  const printed = page.locator('img[src^="data:image/svg"]').first();
  await printed.scrollIntoViewIfNeeded();
  const frame = printed.locator("xpath=ancestor::*[@data-slide-mode][1]");
  await ((await frame.count()) ? frame : printed).screenshot({
    path: path.join(OUT, "pdf-page.png"),
  });
  await page.emulateMedia({ media: "screen" });

  // PowerPoint: the PNG the exporter embeds for the drawing.
  await page.goto(`/l/${id}`);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export" });
  await dialog.getByRole("tab", { name: "PowerPoint" }).click();
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Export PowerPoint" }).click();
  const zip = await JSZip.loadAsync(readFileSync(await (await download).path()));
  const slideXml = (await zip.file(`ppt/slides/slide${N}.xml`)?.async("string")) ?? "";
  const rels = (await zip.file(`ppt/slides/_rels/slide${N}.xml.rels`)?.async("string")) ?? "";
  const media = Array.from(rels.matchAll(/Target="\.\.\/media\/([^"]+\.png)"/g), (m) => m[1]);
  let i = 0;
  for (const name of media) {
    const file = zip.file(`ppt/media/${name}`);
    if (file)
      writeFileSync(path.join(OUT, `pptx-image-${i++}.png`), await file.async("nodebuffer"));
  }
  expect(slideXml.length).toBeGreaterThan(0);
  expect(i).toBeGreaterThan(0);
});
