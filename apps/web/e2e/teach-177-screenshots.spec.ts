/** TEACH-177 PR screenshots. Opt-in: `TEACH_SCREENSHOTS=1 … e2e/teach-177-screenshots.spec.ts`. */
import { expect, test } from "./fixtures";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");
test.use({ viewport: { width: 1440, height: 1000 }, seed: false });

test("captures the remembered class, the one-at-a-time question, the theme tiles and the disabled reason", async ({
  signedInPage: { page },
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("tj-theme", "light");
    localStorage.setItem(
      "tj:brief:last-class",
      JSON.stringify({
        subject: "Science",
        subjectOther: "",
        yearGroup: "Year 5",
        themeId: "chalk",
      }),
    );
  });
  await page.goto("/lessons/new");
  await expect(page.getByRole("textbox", { name: "Topic or objective" })).toBeFocused();
  await expect(page.getByText("From your last lesson")).toHaveCount(2);
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/teach-177-brief-empty-remembered.png" });

  await page.getByRole("textbox", { name: "Topic or objective" }).fill("The water cycle");
  await expect(page.getByRole("radio", { name: "Explain" })).toBeChecked();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(600);
  await page.screenshot({ path: "/tmp/teach-177-question-suggested.png" });

  const tiles = page.getByTestId("theme-tiles");
  await tiles.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/teach-177-theme-tiles.png" });
  await tiles.screenshot({ path: "/tmp/teach-177-theme-tiles-crop.png" });

  await page.getByRole("spinbutton", { name: "Duration (minutes)" }).fill("3");
  await expect(page.getByRole("button", { name: "Plan it" })).toBeDisabled();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(300);
  await page.screenshot({ path: "/tmp/teach-177-disabled-reason.png" });
});
