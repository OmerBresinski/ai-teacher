/** TEACH-111 PR screenshots. Opt-in: `TEACH_SCREENSHOTS=1 … e2e/teach-111-screenshots.spec.ts`. */
import { copyFileSync } from "node:fs";
import { expect, test } from "./fixtures";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");
test.use({ viewport: { width: 1440, height: 1000 } });

const settled = (page: import("@playwright/test").Page) =>
  page
    .getByRole("dialog")
    .evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));

test("captures the PowerPoint and PNG tabs, and saves a .pptx for the viewer screenshot", async ({
  signedInPage: { page, paths },
}) => {
  await page.goto(paths.lesson("demo-water-cycle"));
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export" });
  await dialog.getByRole("tab", { name: "PowerPoint" }).click();
  await dialog.getByRole("switch", { name: "Include answers" }).click();
  await settled(page);
  await page.screenshot({ path: "/tmp/teach-111-pptx-tab.png" });
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Export PowerPoint" }).click();
  copyFileSync(await (await download).path(), "/tmp/teach-111-the-water-cycle.pptx");

  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("dialog", { name: "Export" }).getByRole("tab", { name: "PNG" }).click();
  await page.getByRole("dialog", { name: "Export" }).getByRole("radio", { name: "3x" }).click();
  await settled(page);
  await page.screenshot({ path: "/tmp/teach-111-png-tab.png" });
  await expect(page.getByRole("dialog", { name: "Export" })).toBeVisible();
});
