/** TEACH-268 PR screenshots. Opt-in: `TEACH_SCREENSHOTS=1 … e2e/teach-268-screenshots.spec.ts`. */
import { expect, test } from "./fixtures";
import { MATERIAL, tinyPdf } from "./source-fixtures";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");
test.use({ viewport: { width: 1440, height: 1000 }, seed: false });

test("captures the drop zone empty, with an accepted chip and a refusal", async ({
  signedInPage: { page },
}) => {
  await page.addInitScript(() => localStorage.setItem("tj-theme", "light"));
  await page.goto("/lessons/new");
  const zone = page.getByRole("region", { name: /Start from your material/ });
  await expect(zone).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/teach-268-empty.png" });

  await zone.locator('input[type="file"]').setInputFiles({
    name: "photosynthesis-chapter.pdf",
    mimeType: "application/pdf",
    buffer: tinyPdf(MATERIAL),
  });
  await expect(
    page.getByRole("button", { name: "Remove photosynthesis-chapter.pdf" }),
  ).toBeVisible();
  await zone.locator('input[type="file"]').setInputFiles({
    name: "year5-register.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("Amelia Jones\t12/03/2014\nOliver Smith\t03/07/2014\n"),
  });
  await expect(page.getByRole("list", { name: "Files we could not take" })).toBeVisible();
  await page.getByRole("textbox", { name: "Topic or objective" }).fill("Photosynthesis");
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/teach-268-chip-and-refusal.png" });
  await zone.screenshot({ path: "/tmp/teach-268-zone-crop.png" });
});
