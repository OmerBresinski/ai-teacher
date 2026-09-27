/**
 * The /sign-in cast (TEACH-252): the homepage hero's four characters, alive through GSAP loaded on
 * mount (ADR 0028), reacting to the form. With reduced motion GSAP is never fetched and they stay
 * still. Transforms and paths are read straight off the SVG the rig writes to.
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
  // Record Slides' vertical offset on every frame from the first one, before the page even loads,
  // so a fast arrival cannot finish before the sampling starts.
  await page.addInitScript(() => {
    const seen: number[] = [];
    (window as unknown as { slidesOffsets: number[] }).slidesOffsets = seen;
    const step = () => {
      const host = document.querySelector('[data-cast="slides"]');
      if (host) seen.push(new DOMMatrixReadOnly(getComputedStyle(host).transform).m42);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  await page.goto("/sign-in");
  await expect(page.locator("[data-cast-stage]")).toHaveAttribute("data-cast-stage", "live");
  await page.waitForTimeout(2000);
  const offsets = await page.evaluate(
    () => (window as unknown as { slidesOffsets: number[] }).slidesOffsets,
  );
  const moving = offsets.filter((y) => y !== 0);
  expect(Math.max(...moving)).toBeGreaterThan(100); // it started below the card's top edge
  // ...and was nearly home before GSAP let go, not still hidden (the 27 Sep bug: ~180px, then a snap).
  expect(Math.abs(moving.at(-1) ?? 0)).toBeLessThan(20);
  expect(moving.filter((y) => y > 20 && y < 100).length).toBeGreaterThanOrEqual(3);
});

test("the cast says hello on arrival", async ({ page }) => {
  // Plan's hello opens its arms (its homepage gesture) for under a second; the ambient sway alone
  // stays under 1°. Record the arm every frame so a slow poll cannot miss it.
  await page.addInitScript(() => {
    const seen: number[] = [];
    (window as unknown as { armAngles: number[] }).armAngles = seen;
    const step = () => {
      const arm = document.querySelector('[data-cast="support"] .arm-left');
      const angle = arm?.getAttribute("transform")?.match(/rotate\(([-\d.]+)/)?.[1];
      if (angle) seen.push(Math.abs(Number(angle)));
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  await page.goto("/sign-in");
  await expect(page.locator("[data-cast-stage]")).toHaveAttribute("data-cast-stage", "live");
  await page.waitForTimeout(3500);
  const angles = await page.evaluate(
    () => (window as unknown as { armAngles: number[] }).armAngles,
  );
  expect(Math.max(...angles)).toBeGreaterThan(8);
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
