/** TEACH-122 PR screenshots. Opt-in: `TEACH_SCREENSHOTS=1 … e2e/teach-122-screenshots.spec.ts`. */
import { expect, test } from "./fixtures";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");
test.use({ viewport: { width: 1440, height: 1000 }, seed: false });

test("captures the brief empty, filled with its questions, and with a guard error", async ({
  signedInPage: { page },
}) => {
  await page.goto("/lessons/new");
  await expect(page.getByRole("textbox", { name: "Topic or objective" })).toBeFocused();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/teach-122-empty.png", fullPage: true });

  await page.getByRole("textbox", { name: "Topic or objective" }).fill("Fractions of amounts");
  await page.getByRole("combobox", { name: "Year group" }).click();
  await page.getByRole("option", { name: "Year 5" }).click();
  await page.getByRole("combobox", { name: "Subject" }).click();
  await page.getByRole("option", { name: "Maths" }).click();
  await expect(page.getByRole("radio", { name: "Recall fractions of amounts" })).toBeChecked();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/teach-122-filled.png", fullPage: true });

  await page.getByRole("button", { name: "Add class context" }).click();
  await page.getByRole("radio", { name: "25–30" }).click();
  await page.getByRole("spinbutton", { name: "SEND" }).fill("3");
  const notes = page.getByRole("textbox", { name: "Notes" });
  await notes.fill("A pupil called Jamie struggles after lunch");
  await notes.blur();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/teach-122-guard.png", fullPage: true });
});
