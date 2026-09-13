/**
 * The DayBack marketing site (`homepage/`) after the launch cut (TEACH-307): eleven routes, a hero
 * form that hands a real topic to the application, example lessons built from an asset manifest,
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
const appOrigin = "https://app.bresinski.org";

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
    await expect(nav.getByRole("link", { name: "Examples", exact: true })).toHaveAttribute(
      "href",
      `/homepage/examples/`,
    );
    await expect(nav.getByRole("link", { name: "FAQ", exact: true })).toHaveAttribute(
      "href",
      `/homepage/help/`,
    );
    await expect(nav.getByRole("link", { name: "About", exact: true })).toHaveAttribute(
      "href",
      `/homepage/about/`,
    );
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

test.describe("example lessons", () => {
  test("a lesson page renders its exported images with real alt text", async ({ page }) => {
    await serveHomepage(page);
    const lesson = routes().find(({ route }) => /^\/examples\/.+\//.test(route));
    if (!lesson) throw new Error("No example lesson was emitted");
    await page.goto(`${site}${lesson.route}`);
    const slides = page.locator(".ex-material img");
    expect(await slides.count()).toBeGreaterThan(0);
    for (const alt of await slides.evaluateAll((images) =>
      images.map((image) => (image as HTMLImageElement).alt),
    )) {
      expect(alt.trim().length).toBeGreaterThan(0);
    }
    await expect(page.locator(".ex-answers img").first()).toBeHidden();
    await page.locator(".ex-answers > summary").click();
    await expect(page.locator(".ex-answers img").first()).toBeVisible();
  });
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
      await page.goto(`${site}${target}`);
      await expectNoSeriousA11yViolations(page, `homepage ${label}`);
    });
  }
});
