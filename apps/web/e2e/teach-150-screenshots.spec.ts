/**
 * TEACH-150 PR screenshots. Opt-in: `TEACH_SCREENSHOTS=1 … e2e/teach-150-screenshots.spec.ts`.
 *
 * Two runs: the kit shots need `E2E_KIT=1` as well (the production build does not scan the kit's
 * own utilities, so `/kit` is styled only by the Vite dev server); the home and editor shots come
 * from the production build, which carries no dev overlays.
 */
import type { Page } from "@playwright/test";
import { expect, seededPaths, seedLibrary, test } from "./fixtures";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");
test.use({ viewport: { width: 1440, height: 1000 }, seed: false });

const shot = (name: string) => `/tmp/teach-150-${name}.png`;

/** A kit specimen by its heading: heading → label column → the specimen row. */
const specimen = (page: Page, name: string) =>
  page.getByRole("heading", { name }).locator("xpath=ancestor::div[2]");

test("captures the kit's actions, status pills, choice and slider bubble", async ({
  signedInPage: { page },
}) => {
  test.skip(process.env.E2E_KIT !== "1", "the kit's utilities are scanned by the dev server only");
  await page.goto("/kit");
  await expect(page.getByRole("heading", { level: 1, name: "The kit" })).toBeVisible();
  await page.waitForTimeout(400);

  // Press the Zoom thumb, drag it a little and hold: the value bubble shows mid-drag.
  const value = page.locator("section#value");
  await value.scrollIntoViewIfNeeded();
  const thumb = page.getByRole("slider", { name: "Zoom" });
  const slider = thumb.locator("xpath=ancestor::*[@data-slot='slider']");
  await expect.poll(async () => (await slider.boundingBox())?.width ?? 0).toBeGreaterThan(200);
  const box = await thumb.boundingBox();
  if (!box) throw new Error("thumb not on screen");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x + i * 5, y);
  await expect(value.locator("[data-slot='slider-value']")).toBeVisible();
  await page.waitForTimeout(200);
  await value.screenshot({ path: shot("kit-slider-bubble") });
  await page.mouse.up();

  const actions = page.locator("section#actions");
  await actions.scrollIntoViewIfNeeded();
  await actions.screenshot({ path: shot("kit-actions") });

  const pills = specimen(page, "StatusPill, one per context");
  await pills.scrollIntoViewIfNeeded();
  await pills.screenshot({ path: shot("kit-status-pills") });

  const choice = page.locator("section#choice");
  await choice.scrollIntoViewIfNeeded();
  await choice.screenshot({ path: shot("kit-choice") });
});

test("captures the home page and the focus band on a navigator thumbnail", async ({
  signedInPage: { page },
}) => {
  test.skip(process.env.E2E_KIT === "1", "app shots come from the production build");
  const paths = seededPaths(await seedLibrary(page));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  await expect(
    page.locator("[data-slot='card-thumbnail'] [data-slide-root]").first(),
  ).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: shot("home") });

  await page.goto(paths.lesson("demo-water-cycle"));
  const frame = page.locator("[data-slide-frame]");
  await expect(frame).toBeVisible();
  await page.waitForTimeout(400);
  // Tab through the chrome until the rail's one tab stop (the open slide's row) has focus: the
  // band is a keyboard-focus ring, so it must come from a key, not a click.
  const onRow = () =>
    page.evaluate(() => Boolean(document.activeElement?.closest("[data-navigator-row]")));
  for (let i = 0; i < 40 && !(await onRow()); i++) await page.keyboard.press("Tab");
  await expect
    .poll(() =>
      page.evaluate(() => Boolean(document.activeElement?.closest("[data-navigator-row]"))),
    )
    .toBe(true);
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot("editor-focus-band") });
});
