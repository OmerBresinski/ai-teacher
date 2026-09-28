/**
 * /sign-in motion (TEACH-252): the homepage hero's four characters, alive through GSAP loaded on
 * mount (ADR 0028) and reacting to the form, and the card easing between heights. With reduced
 * motion GSAP is never fetched and the cast stays still. Transforms and paths are read straight
 * off the SVG the rig writes to.
 */
import type { Page } from "@playwright/test";
import { expect, test, uniqueEmail } from "./fixtures";

test.use({ viewport: { width: 1440, height: 1000 } });

const bodyOf = (page: Page, kind: string) =>
  page.locator(`[data-cast="${kind}"] .body`).getAttribute("transform");
const mouthOf = (page: Page, kind: string) =>
  page.locator(`[data-cast="${kind}"] .mouth`).getAttribute("d");
/** The control point's y: larger is a deeper smile. */
const smileDepth = (d: string | null) => Number(d?.split("Q")[1]?.trim().split(" ")[1]);

/**
 * Records one number per animation frame for `selector`, from the page's first frame (an init
 * script, so a fast arrival cannot finish before sampling starts) and for 8 s: Slides' vertical
 * offset, or an arm's rotation. A slow `expect.poll` can miss a moment that lasts under a second.
 */
async function recordEveryFrame(page: Page, selector: string, read: "offsetY" | "rotation") {
  await page.addInitScript(
    ({ selector, read }) => {
      const seen: number[] = [];
      (window as unknown as { recorded: number[] }).recorded = seen;
      const started = performance.now();
      const step = () => {
        const element = document.querySelector(selector);
        if (element && read === "offsetY") {
          seen.push(new DOMMatrixReadOnly(getComputedStyle(element).transform).m42);
        }
        const angle = element?.getAttribute("transform")?.match(/rotate\(([-\d.]+)/)?.[1];
        if (read === "rotation" && angle) seen.push(Math.abs(Number(angle)));
        if (performance.now() - started < 8000) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    },
    { selector, read },
  );
  return () => page.evaluate(() => (window as unknown as { recorded: number[] }).recorded);
}

test("the cast arrives from behind the card and keeps moving", async ({ page }) => {
  const gsap = page.waitForResponse(async (response) =>
    response.request().resourceType() === "script"
      ? (await response.text()).includes("GreenSock")
      : false,
  );
  await page.goto("/sign-in");
  await gsap;
  const stage = page.locator("[data-cast-stage]");
  await expect(stage).toHaveAttribute("data-cast-stage", "live");
  await expect(page.locator('[data-cast="slides"]')).toBeInViewport();
  const first = await bodyOf(page, "support");
  await page.waitForTimeout(700);
  expect(await bodyOf(page, "support")).not.toBe(first);
});

test("Slides climbs out from behind the card instead of popping in", async ({ page }) => {
  const offsets = await recordEveryFrame(page, '[data-cast="slides"]', "offsetY");
  await page.goto("/sign-in");
  await expect(page.locator("[data-cast-stage]")).toHaveAttribute("data-cast-stage", "live");
  await page.waitForTimeout(2000);
  const moving = (await offsets()).filter((y) => y !== 0);
  expect(Math.max(...moving)).toBeGreaterThan(100); // it started below the card's top edge
  // ...and was nearly home before GSAP let go, not still hidden (the 27 Sep bug: ~180px, then a snap).
  expect(Math.abs(moving.at(-1) ?? 0)).toBeLessThan(20);
  expect(moving.filter((y) => y > 20 && y < 100).length).toBeGreaterThanOrEqual(3);
});

test("the cast says hello on arrival", async ({ page }) => {
  // Plan's hello opens its arms (its homepage gesture); the ambient sway alone stays under 1°.
  const angles = await recordEveryFrame(page, '[data-cast="support"] .arm-left', "rotation");
  await page.goto("/sign-in");
  await expect(page.locator("[data-cast-stage]")).toHaveAttribute("data-cast-stage", "live");
  await page.waitForTimeout(3500);
  expect(Math.max(...(await angles()))).toBeGreaterThan(8);
});

test("the cast reads along while you type and celebrates when the link is sent", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await expect(page.locator("[data-cast-stage]")).toHaveAttribute("data-cast-stage", "live");
  await page.waitForTimeout(2500); // the hello
  const eye = page.locator('[data-cast="slides"] .eye').first();
  const field = page.getByLabel("Email address");
  await field.click();
  await field.pressSequentially("a");
  await page.waitForTimeout(400);
  const early = Number(await eye.getAttribute("cx"));
  await field.pressSequentially(uniqueEmail("cast").slice(1), { delay: 15 });
  await page.waitForTimeout(400);
  // The caret moved right, and so did the eyes.
  expect(Number(await eye.getAttribute("cx"))).toBeGreaterThan(early);

  const before = smileDepth(await mouthOf(page, "answers"));
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(page.getByRole("status")).toHaveText(/Check your inbox/);
  await page.waitForTimeout(1200);
  expect(smileDepth(await mouthOf(page, "answers"))).toBeGreaterThan(before);
});

test("the card eases to its new height when the link is sent", async ({ page }) => {
  await page.goto("/sign-in");
  const card = page.locator("[data-sign-in-card]");
  await page.getByLabel("Email address").fill(uniqueEmail("height"));
  const before = (await card.boundingBox())?.height ?? 0;
  // The card's height on every frame for 1.5 s, started before the click.
  const recorded = page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const element = document.querySelector("[data-sign-in-card]");
        const seen: number[] = [];
        const started = performance.now();
        const step = () => {
          if (element) seen.push(element.getBoundingClientRect().height);
          if (performance.now() - started < 1500) requestAnimationFrame(step);
          else resolve(seen);
        };
        step();
      }),
  );
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(page.getByRole("status")).toHaveText(/Check your inbox/);
  const heights = await recorded;
  const after = heights.at(-1) ?? 0;
  expect(Math.abs(after - before), `form ${before}px, sent ${after}px`).toBeGreaterThan(8);
  // Frames strictly between the two heights: it travelled rather than jumped.
  const [low, high] = [Math.min(before, after), Math.max(before, after)];
  const between = new Set(heights.filter((h) => h > low + 1 && h < high - 1).map(Math.round));
  expect(between.size).toBeGreaterThanOrEqual(3);
});

test("with reduced motion the cast never moves and GSAP is never fetched", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const scripts: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "script") scripts.push(request.url());
  });
  await page.goto("/sign-in");
  await expect(page.locator("[data-cast-stage]")).toHaveAttribute("data-cast-stage", "still");
  await expect(page.locator('[data-cast="slides"]')).toBeInViewport();
  const first = await bodyOf(page, "support");
  await page.waitForTimeout(800);
  expect(await bodyOf(page, "support")).toBe(first);
  // Every chunk this page fetched, read for GSAP's banner: none of them may be GSAP.
  for (const url of scripts) {
    const body = await (await page.request.get(url)).text();
    expect(body, url).not.toContain("GreenSock");
  }
});
