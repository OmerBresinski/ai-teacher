/** TEACH-112 PR screenshots. Opt-in: `TEACH_SCREENSHOTS=1 … e2e/teach-112-screenshots.spec.ts`. */
import { copyFileSync } from "node:fs";
import { expect, test } from "./fixtures";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");
test.use({ viewport: { width: 1440, height: 1000 } });

test("captures the Word tab and saves a .docx for the viewer screenshot", async ({
  signedInPage: { page, paths },
}) => {
  await page.goto(paths.worksheet("fraction-practice"));
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export" });
  await dialog.getByRole("tab", { name: "Word" }).click();
  await dialog.getByRole("switch", { name: "Include answer key" }).click();
  await dialog.evaluate((el) =>
    Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)),
  );
  await page.screenshot({ path: "/tmp/teach-112-docx-tab.png" });
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Export Word" }).click();
  copyFileSync(await (await download).path(), "/tmp/teach-112-fractions-practice.docx");
  await expect(dialog).toHaveCount(0);
});
