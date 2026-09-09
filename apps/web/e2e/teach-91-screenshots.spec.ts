import { test } from "./fixtures";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");

// The worksheet dialog became the creation flow in TEACH-184; the lesson brief's Blank lesson is
// the dialog's one remaining door.
test("captures both NewDocumentDialog steps", async ({ signedInPage: { page } }) => {
  await page.goto("/lessons/new");
  await page.getByRole("button", { name: "Blank lesson" }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: "/tmp/teach-91-new-document-about.png", fullPage: true });

  await page.getByRole("button", { name: "Next" }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: "/tmp/teach-91-new-document-theme.png", fullPage: true });
});
