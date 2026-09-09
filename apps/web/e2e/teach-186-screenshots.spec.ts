/** TEACH-186 PR screenshots. Opt-in: `TEACH_SCREENSHOTS=1 … e2e/teach-186-screenshots.spec.ts`. */
import { expect, test } from "./fixtures";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");
test.use({ viewport: { width: 1440, height: 1000 } });

const SHEETS = [
  ["fraction-practice", "Fractions practice"],
  ["roman-source", "Roman source investigation"],
  ["plant-labels", "Label a flowering plant"],
  ["river-vocabulary", "River vocabulary"],
] as const;

test("captures the Worksheets library and the first page of each seeded sheet", async ({
  signedInPage: { page, paths },
}) => {
  await page.addInitScript(() => localStorage.setItem("tj-theme", "light"));
  await page.goto("/worksheets");
  await expect(page.getByRole("button", { name: "New worksheet" })).toBeVisible();
  await expect(page.getByText("12 marks · 20 min")).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: "/tmp/teach-186-library.png" });

  for (const [key, title] of SHEETS) {
    await page.goto(paths.worksheet(key));
    await expect(page.getByRole("heading", { level: 1, name: title }).first()).toBeVisible();
    await expect(page.locator(".ws-column .ws-page").first()).toBeVisible();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `/tmp/teach-186-${key}.png` });
  }
});
