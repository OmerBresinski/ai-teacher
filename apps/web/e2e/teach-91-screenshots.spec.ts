import { test } from "./fixtures";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");

test("captures both NewDocumentDialog steps", async ({ signedInPage: { page } }) => {
  await page.getByRole("button", { name: "New lesson" }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: "/tmp/teach-91-new-document-about.png", fullPage: true });

  await page.getByRole("button", { name: "Next" }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: "/tmp/teach-91-new-document-theme.png", fullPage: true });
});
