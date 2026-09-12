/** TEACH-110 PR screenshots. Opt-in: `TEACH_SCREENSHOTS=1 … e2e/teach-110-screenshots.spec.ts`. */
import { expect, test } from "./fixtures";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");
test.use({ viewport: { width: 1440, height: 1000 } });

/** Wait for the dialog's arrival motion, not a fixed time. */
const settled = (page: import("@playwright/test").Page) =>
  page
    .getByRole("dialog")
    .evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));

test("captures the export dialog, the print route and the import dialog", async ({
  signedInPage: { page, paths },
}) => {
  await page.goto(paths.lesson("demo-water-cycle"));
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "Slides" }).fill("1-3, 5");
  await settled(page);
  await page.screenshot({ path: "/tmp/teach-110-export-dialog.png" });
  await page.keyboard.press("Escape");

  await page.goto(`${paths.lesson("demo-water-cycle", "/print")}?notes=1`);
  await expect(page.locator("html")).toHaveAttribute("data-capture-ready", "true");
  await page.screenshot({ path: "/tmp/teach-110-print-notes.png" });

  await page.goto(`${paths.lesson("demo-water-cycle", "/print")}?handout=3`);
  await expect(page.locator("html")).toHaveAttribute("data-capture-ready", "true");
  await page.screenshot({ path: "/tmp/teach-110-print-handout3.png" });

  await page.goto("/lessons");
  await page.getByRole("button", { name: "Import" }).click();
  await expect(page.getByRole("dialog", { name: "Import" })).toBeVisible();
  await settled(page);
  await page.screenshot({ path: "/tmp/teach-110-import-dialog.png" });
});
