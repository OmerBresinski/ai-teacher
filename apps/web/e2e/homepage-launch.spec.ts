/**
 * The DayBack marketing site (`homepage/`) after the launch cut (TEACH-307): eleven routes, a hero
 * form that hands a real topic to the application, top lessons built from an asset manifest,
 * and no page errors anywhere. The static build is served through Playwright's router rather than
 * a local HTTP server, exactly as the preceding homepage spec did.
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { extname, resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "./a11y";

const root = resolve(import.meta.dirname, "../../..");
const output = resolve(root, "homepage/dist");
const site = "http://homepage.test/homepage";
// The homepage build default (homepage/config.mjs); production passes the same origin.
const appOrigin = "https://teach.dayback.app";

interface Route {
  route: string;
  title: string;
}

function routes(): Route[] {
  return JSON.parse(readFileSync(resolve(output, "routes.json"), "utf8")) as Route[];
}

async function serveHomepage(page: Page, requests?: string[]) {
  // The application is a different origin; stub it so a real hero submission is observable.
  await page.route(`${appOrigin}/**`, async (route) => {
    await route.fulfill({
      body: "<!doctype html><html lang=en><title>Application</title><body><h1>Application</h1>",
      contentType: "text/html",
    });
  });
  await page.route("http://homepage.test/**", async (route) => {
    const url = new URL(route.request().url());
    requests?.push(`${route.request().method()} ${url.pathname}${url.search}`);
    const file = resolve(
      output,
      `.${url.pathname.replace(/^\/homepage/, "")}${url.pathname.endsWith("/") ? "index.html" : ""}`,
    );
    const types: Record<string, string> = {
      ".html": "text/html",
      ".css": "text/css",
      ".js": "text/javascript",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".woff2": "font/woff2",
    };
    try {
      await route.fulfill({ body: readFileSync(file), contentType: types[extname(file)] });
    } catch {
      await route.fulfill({ status: 404, body: "", contentType: "text/plain" });
    }
  });
}

/**
 * `beforeAll` runs once per worker and the build clears `homepage/dist`, so the workers take an
 * atomic lock: one builds, the others wait for the finished output.
 */
test.beforeAll(() => {
  const lock = resolve(root, "apps/web/test-results/homepage-build.lock");
  mkdirSync(resolve(root, "apps/web/test-results"), { recursive: true });
  let owner = true;
  try {
    mkdirSync(lock);
  } catch {
    owner = false;
  }
  if (owner) {
    const build = Bun.spawnSync(["bun", "homepage/build.mjs", "--allow-provisional"], {
      cwd: root,
    });
    rmSync(lock, { recursive: true, force: true });
    expect(build.exitCode).toBe(0);
    return;
  }
  const deadline = Date.now() + 60_000;
  while (
    (existsSync(lock) || !existsSync(resolve(output, "routes.json"))) &&
    Date.now() < deadline
  ) {
    Bun.sleepSync(100);
  }
  expect(existsSync(resolve(output, "routes.json"))).toBe(true);
});

for (const javaScriptEnabled of [false, true]) {
  test.describe(`hero form with JavaScript ${javaScriptEnabled ? "enabled" : "disabled"}`, () => {
    test.use({ javaScriptEnabled });

    test("hands the typed topic to the application", async ({ page }) => {
      await serveHomepage(page);
      await page.goto(`${site}/`);
      const topic = page.getByRole("textbox", { name: "What are you teaching?" });
      await topic.fill("Year 7 science, solids, liquids and gases");
      await topic.press("Enter");
      await page.waitForURL(new RegExp(`^${appOrigin}/lessons/new\\?topic=`));
      const url = new URL(page.url());
      expect(url.origin + url.pathname).toBe(`${appOrigin}/lessons/new`);
      expect(url.searchParams.get("topic")).toBe("Year 7 science, solids, liquids and gases");
    });

    test("does not navigate when the field is empty", async ({ page }) => {
      const requests: string[] = [];
      await serveHomepage(page, requests);
      await page.goto(`${site}/`);
      const topic = page.getByRole("textbox", { name: "What are you teaching?" });
      await topic.press("Enter");
      await page.getByRole("button", { name: "Create a lesson" }).first().click();
      // Negative check: an empty field must not navigate.
      await page.waitForTimeout(200);
      expect(page.url()).toBe(`${site}/`);
      expect(requests.filter((request) => request.includes("?topic="))).toEqual([]);
    });
  });
}

test.describe("navigation and links", () => {
  test("the upload link opens the application with a source", async ({ page }) => {
    await serveHomepage(page);
    await page.goto(`${site}/`);
    const upload = page.getByRole("link", {
      name: "Start from your own PowerPoint, PDF or Word file",
    });
    await expect(upload).toHaveAttribute("href", `${appOrigin}/lessons/new?source=1`);
    // The tooltip is decorative text inside the link, shown by CSS on hover and focus.
    await expect(page.locator(".hm-brief-tooltip")).toHaveText(
      "Or start from your own PowerPoint, PDF or Word file.",
    );
  });

  test("the navigation reaches every top-level destination", async ({ page }) => {
    await serveHomepage(page);
    await page.goto(`${site}/`);
    const nav = page.locator("#main-nav");
    await expect(nav.getByRole("link", { name: "Top lessons", exact: true })).toHaveAttribute(
      "href",
      `/homepage/examples/`,
    );
    await expect(nav.getByRole("link", { name: "FAQ", exact: true })).toHaveAttribute(
      "href",
      `/homepage/help/`,
    );
    // About lives in the footer only.
    await expect(nav.getByRole("link", { name: "About", exact: true })).toHaveCount(0);
    await expect(
      page.locator(".site-footer").getByRole("link", { name: "About", exact: true }),
    ).toHaveAttribute("href", `/homepage/about/`);
    await expect(nav.getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute(
      "href",
      `${appOrigin}/sign-in`,
    );
    await expect(nav.getByRole("link", { name: /Create a lesson/ })).toHaveAttribute(
      "href",
      "#start",
    );
    await page.goto(`${site}/about/`);
    await expect(
      page.locator("#main-nav").getByRole("link", { name: /Create a lesson/ }),
    ).toHaveAttribute("href", `${appOrigin}/lessons/new`);
  });
});

test.describe("top lessons", () => {
  test("a lesson page renders its exported images with real alt text", async ({ page }) => {
    await serveHomepage(page);
    const lesson = routes().find(({ route }) => /^\/examples\/.+\//.test(route));
    if (!lesson) throw new Error("No example lesson was emitted");
    await page.goto(`${site}${lesson.route}`);
    const slides = page.locator(".viewer-slide img");
    expect(await slides.count()).toBeGreaterThan(0);
    for (const alt of await slides.evaluateAll((images) =>
      images.map((image) => (image as HTMLImageElement).alt),
    )) {
      expect(alt.trim().length).toBeGreaterThan(0);
    }
    // A lesson may ship with slides only. When it has a worksheet, its mark scheme stays hidden
    // until the Answers switch is turned on, and then takes the sheet's place; no worksheet
    // heading appears when it has none.
    const sheet = page.locator(".paper-doc").filter({ hasText: "Worksheet" });
    if ((await sheet.count()) > 0) {
      const toggle = sheet.getByRole("button", { name: "Answers" });
      await expect(sheet.locator("[data-answers] img").first()).toBeHidden();
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-pressed", "true");
      await expect(sheet.getByRole("button", { name: "Questions" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      await expect(sheet.locator("[data-answers] img").first()).toBeVisible();
      await expect(sheet.locator(".paper-sheet img").first()).toBeHidden();
    } else {
      await expect(page.getByRole("heading", { name: "Worksheet" })).toHaveCount(0);
    }
  });
});

test.describe("slide viewer", () => {
  for (const javaScriptEnabled of [true, false]) {
    test(`${javaScriptEnabled ? "steps through slides" : "shows every slide"} with JavaScript ${javaScriptEnabled ? "on" : "off"}`, async ({
      browser,
    }) => {
      const context = await browser.newContext({ javaScriptEnabled });
      const page = await context.newPage();
      await serveHomepage(page);
      const lesson = routes().find(({ route }) => /^\/examples\/.+\//.test(route));
      if (!lesson) throw new Error("No example lesson was emitted");
      await page.goto(`${site}${lesson.route}`);
      const slides = page.locator(".viewer-slide");
      const total = await slides.count();
      if (!javaScriptEnabled) {
        for (let index = 0; index < total; index++) await expect(slides.nth(index)).toBeVisible();
        await expect(page.locator(".viewer-controls")).toBeHidden();
        await context.close();
        return;
      }
      await expect(page.locator(".viewer-status")).toHaveText(`Slide 1 of ${total}`);
      await expect(slides.nth(1)).toBeHidden();
      const second = page.locator(".viewer-thumb").nth(1);
      await second.click();
      await expect(second).toHaveAttribute("aria-current", "true");
      await expect(second).toHaveAttribute("aria-pressed", "true");
      await expect(slides.nth(1)).toBeVisible();
      await second.press("ArrowRight");
      await expect(page.locator(".viewer-status")).toHaveText(`Slide 3 of ${total}`);
      await expect(page.locator(".viewer-thumb").nth(2)).toBeFocused();
      // A slide with answers offers the switch; turning it on swaps in the answer image, and
      // moving to another slide turns it off again.
      const withAnswer = slides.filter({ has: page.locator("[data-answer]") }).first();
      if ((await withAnswer.count()) > 0) {
        const index = await withAnswer.evaluate((el) =>
          [...(el.parentElement?.children ?? [])].indexOf(el),
        );
        await page.locator(".viewer-thumb").nth(index).click();
        const toggle = page
          .locator("[data-slide-answers]")
          .getByRole("button", { name: "Answers" });
        await toggle.click();
        await expect(toggle).toHaveAttribute("aria-pressed", "true");
        await expect(withAnswer.locator("[data-answer]")).toBeVisible();
        await page.locator(".viewer-thumb").nth(1).click();
        await expect(toggle).toHaveAttribute("aria-pressed", "false");
      }
      await page.locator(".viewer-thumb").nth(2).click();
      await page.getByRole("button", { name: "Previous slide" }).click();
      await expect(page.locator(".viewer-status")).toHaveText(`Slide 2 of ${total}`);
      await context.close();
    });
  }
});

test.describe("every route", () => {
  test("loads without a page error and fits a 390 viewport", async ({ page }) => {
    await serveHomepage(page);
    const problems: string[] = [];
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 844 });
      for (const { route } of routes()) {
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(`${route} @${width}: ${error.message}`));
        page.on("console", (message) => {
          if (message.type() === "error") errors.push(`${route} @${width}: ${message.text()}`);
        });
        await page.goto(`${site}${route}`);
        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        if (scrollWidth > width) {
          problems.push(`${route} @${width}: scrollWidth ${scrollWidth}`);
        }
        problems.push(...errors);
        page.removeAllListeners("pageerror");
        page.removeAllListeners("console");
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });
});

test.describe("accessibility", () => {
  for (const [label, route] of [
    ["home", "/"],
    ["example lesson", null],
    ["FAQ", "/help/"],
    ["privacy", "/privacy/"],
  ] as [string, string | null][]) {
    test(`axe reports no serious violation on ${label}`, async ({ page }) => {
      const target = route ?? routes().find(({ route: r }) => /^\/examples\/.+\//.test(r))?.route;
      if (!target) throw new Error("No example lesson was emitted");
      await serveHomepage(page);
      // Contrast is measured on the settled page, not on a frame halfway through the proof replay.
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`${site}${target}`);
      await expectNoSeriousA11yViolations(page, `homepage ${label}`);
    });
  }
});
