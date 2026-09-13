import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";

const root = resolve(import.meta.dirname, "../../..");
const output = resolve(root, "homepage/dist");

async function serveHomepage(page: Page, requests?: string[]) {
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
      ".woff2": "font/woff2",
    };
    await route.fulfill({ body: readFileSync(file), contentType: types[extname(file)] });
  });
}

test.beforeAll(() => {
  const build = Bun.spawnSync(["bun", "homepage/build.mjs"], { cwd: root });
  expect(build.exitCode).toBe(0);
});

for (const javaScriptEnabled of [false, true]) {
  test.describe(`homepage forms with JavaScript ${javaScriptEnabled ? "enabled" : "disabled"}`, () => {
    test.use({ javaScriptEnabled });
    for (const routeName of ["early-access", "contact"]) {
      test(`${routeName} never sends entered details`, async ({ page }) => {
        const requests: string[] = [];
        await serveHomepage(page, requests);
        const url = `http://homepage.test/homepage/${routeName}/`;
        await page.goto(url);
        const email = page.locator('input[type="email"]');
        await email.fill("preview-test@example.test");
        if (routeName === "contact") {
          await page.locator('input[name="name"]').fill("Synthetic test teacher");
          await page.locator('textarea[name="message"]').fill("Synthetic preview message");
        }
        const submit = page.locator('button[type="submit"]');
        if (javaScriptEnabled) {
          await expect(submit).toBeEnabled();
          await submit.click();
          await expect(page.locator("[data-form-status]")).toContainText(
            "nothing has been sent or saved",
          );
        } else {
          await expect(submit).toBeDisabled();
          const bounds = await submit.boundingBox();
          if (!bounds) throw new Error("Missing disabled button");
          await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
          await expect(page.locator("noscript p")).toContainText("Nothing can be submitted here");
        }
        await email.press("Enter");
        await page.waitForTimeout(150);
        expect(page.url()).toBe(url);
        expect(
          requests.filter((request) => request.includes("?") || !request.startsWith("GET ")),
        ).toEqual([]);
        expect(
          requests.filter((request) => request === `GET /homepage/${routeName}/`),
        ).toHaveLength(1);
      });
    }
  });
}

test.describe("homepage sample lessons", () => {
  test("browses the prepared Year 4 sound slides", async ({ page }) => {
    await serveHomepage(page);
    await page.goto("http://homepage.test/homepage/");
    await expect(page.locator("[data-slide]:visible")).toContainText("Can you see a sound begin?");
    await page.getByRole("button", { name: "Next slide" }).click();
    await expect(page.locator("[data-slide]:visible")).toContainText(
      "Sound starts with a vibration",
    );
    await expect(page.locator("[data-slide-count]")).toHaveText("2 of 5");
  });

  test("keeps the complete landing page within a narrow viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await serveHomepage(page);
    await page.goto("http://homepage.test/homepage/");
    await expect(page.getByRole("heading", { name: /Outstanding lessons/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "See what you could teach." })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
});

for (const javaScriptEnabled of [false, true]) {
  test.describe(`homepage hero preview with JavaScript ${javaScriptEnabled ? "enabled" : "disabled"}`, () => {
    test.use({ javaScriptEnabled });

    test("keeps the topic local and does not generate or navigate", async ({ page }) => {
      const requests: string[] = [];
      await serveHomepage(page, requests);
      const url = "http://homepage.test/homepage/";
      await page.goto(url);
      const topic = page.getByRole("textbox", { name: "What would you like to teach?" });
      await topic.fill("Year 7 science — solids, liquids and gases");
      const submit = page.getByRole("button", { name: "Create a lesson" });

      if (javaScriptEnabled) {
        await expect(submit).toBeEnabled();
        await submit.click();
        await expect(page.getByRole("status")).toContainText("nothing was sent or saved");
      } else {
        await expect(submit).toBeDisabled();
        await expect(page.locator("noscript p")).toContainText("Nothing is sent or saved");
      }

      await topic.press("Enter");
      await page.waitForTimeout(150);
      expect(page.url()).toBe(url);
      expect(
        requests.filter((request) => request.includes("?") || !request.startsWith("GET ")),
      ).toEqual([]);
      expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([
        0, 0,
      ]);
    });
  });
}

test.describe("homepage sample lesson without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("keeps the featured sample link navigable", async ({ page }) => {
    await serveHomepage(page);
    await page.goto("http://homepage.test/homepage/");
    await expect(page.locator("[data-slide]:visible")).toContainText("Can you see a sound begin?");
    await expect(
      page.locator("#example").getByRole("link", { name: "Try your own topic" }),
    ).toHaveAttribute("href", "#start");
  });
});
