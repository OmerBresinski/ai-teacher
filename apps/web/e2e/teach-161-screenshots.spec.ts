/** TEACH-161 PR screenshots. Opt-in: `TEACH_SCREENSHOTS=1 … e2e/teach-161-screenshots.spec.ts`. */
import { copyFileSync, writeFileSync } from "node:fs";
import { expect, seedCreditedLesson, test } from "./fixtures";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");
test.use({ viewport: { width: 1440, height: 1000 } });

test("captures the PDF credits page, and saves the .pdf, .pptx and credits .png", async ({
  signedInPage: { page },
}) => {
  const id = await seedCreditedLesson(page);
  await page.goto(`/l/${id}/print`);
  const credits = page.locator("[data-credits-page]");
  await expect(credits.getByRole("heading", { name: "Image credits" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-capture-ready", "true");
  await credits.screenshot({ path: "/tmp/teach-161-pdf-credits.png" });
  await page.emulateMedia({ media: "print" });
  writeFileSync("/tmp/teach-161-credits.pdf", await page.pdf({ preferCSSPageSize: true }));
  await page.emulateMedia({ media: "screen" });

  await page.goto(`/l/${id}/print?notes=1`);
  await expect(page.locator("html")).toHaveAttribute("data-capture-ready", "true");
  await page
    .locator("[data-credits-page]")
    .screenshot({ path: "/tmp/teach-161-pdf-credits-a4.png" });

  await page.goto(`/l/${id}`);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export" });
  await dialog.getByRole("tab", { name: "PowerPoint" }).click();
  const pptx = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Export PowerPoint" }).click();
  copyFileSync(await (await pptx).path(), "/tmp/teach-161-pictures-of-the-sky.pptx");

  await page.getByRole("button", { name: "Export", exact: true }).click();
  const again = page.getByRole("dialog", { name: "Export" });
  await again.getByRole("tab", { name: "PNG" }).click();
  await again.getByRole("textbox", { name: "Slides" }).fill("1-3");
  const files: import("@playwright/test").Download[] = [];
  const both = new Promise<void>((resolve) => {
    page.on("download", (d) => {
      files.push(d);
      if (files.length === 4) resolve();
    });
  });
  await again.getByRole("button", { name: "Export PNG" }).click();
  await both;
  const last = files.at(-1);
  expect(last?.suggestedFilename()).toBe("pictures-of-the-sky-credits.png");
  if (last) copyFileSync(await last.path(), "/tmp/teach-161-png-credits.png");
});
