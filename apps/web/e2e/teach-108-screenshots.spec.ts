/** TEACH-108 PR screenshots. Opt-in: `TEACH_SCREENSHOTS=1 … e2e/teach-108-screenshots.spec.ts`. */
import { expect, test } from "./fixtures";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");
test.use({ viewport: { width: 1100, height: 1500 } });

test("captures the worksheet print route on screen and in print media", async ({
  signedInPage: { page, paths },
}) => {
  await page.goto(paths.worksheet("fraction-practice", "/print"));
  await expect(page.locator(".ws-print-root")).toHaveCSS("visibility", "visible");
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/teach-108-print-screen.png", fullPage: true });

  await page.emulateMedia({ media: "print" });
  await page.waitForTimeout(200);
  await page.screenshot({ path: "/tmp/teach-108-print-media.png", fullPage: true });
  await page.pdf({ path: "/tmp/teach-108-fraction-practice.pdf", preferCSSPageSize: true });
});
