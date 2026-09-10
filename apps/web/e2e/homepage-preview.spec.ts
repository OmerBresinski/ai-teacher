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
  test("switches coherent materials and links, with answers revealed on request", async ({
    page,
  }) => {
    await serveHomepage(page);
    await page.goto("http://homepage.test/homepage/");
    for (const [year, slug, title, question, answer] of [
      ["Year 3", "shadows", "Change one thing", "A shadow forms", "Light."],
      [
        "Year 7",
        "states-of-matter",
        "Close together does not mean fixed",
        "arrangement and movement",
        "Solid: close together",
      ],
      [
        "Year 9",
        "conservation-of-mass",
        "Atoms rearrange. Mass stays.",
        "120 g before a reaction",
        "120 g. Atoms rearrange",
      ],
    ] as const) {
      await page.getByRole("tab", { name: year, exact: true }).click();
      const panel = page.getByRole("tabpanel");
      await expect(panel).toHaveCount(1);
      await expect(panel.locator(".hm-sample-slide")).toContainText(title);
      await expect(panel.locator(".hm-sample-worksheet")).toContainText(question);
      await expect(panel.locator(".hm-sample-answers ol")).toBeHidden();
      await panel.getByText("Show the answers", { exact: true }).click();
      await expect(panel.locator(".hm-sample-answers ol")).toContainText(answer);
      await expect(panel.getByRole("link", { name: "Explore this lesson" })).toHaveAttribute(
        "href",
        `/homepage/examples/${slug}/`,
      );
      await panel.getByRole("link", { name: "Explore this lesson" }).click();
      await expect(page.locator(".ex-lesson-head")).toContainText(year);
      await page.getByRole("tab", { name: "Worksheet", exact: true }).click();
      await expect(page.locator("#worksheet")).toContainText(question);
      await page.getByRole("tab", { name: "Answers", exact: true }).click();
      await expect(page.locator("#answers")).toContainText(answer);
      await page.goto("http://homepage.test/homepage/");
    }
  });

  test("supports keyboard selection and narrow screens without overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await serveHomepage(page);
    await page.goto("http://homepage.test/homepage/");
    const first = page.getByRole("tab", { name: "Year 3", exact: true });
    await first.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Year 7", exact: true })).toBeFocused();
    await page.keyboard.press("End");
    await expect(page.getByRole("tab", { name: "Year 9", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.keyboard.press("Home");
    await expect(first).toHaveAttribute("aria-selected", "true");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
});

test.describe("homepage sample lessons without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("keeps the default sample and navigable full-lesson choices", async ({ page }) => {
    await serveHomepage(page);
    await page.goto("http://homepage.test/homepage/");
    await expect(page.locator('[data-sample-panel="shadows"]')).toBeVisible();
    await page.locator('[data-sample-tab="states-of-matter"]').click();
    await expect(page.locator(".ex-lesson-head")).toContainText("Year 7 science");
    await page.goto("http://homepage.test/homepage/");
    await page.locator('[data-sample-tab="conservation-of-mass"]').click();
    await expect(page.locator(".ex-lesson-head")).toContainText("Year 9 science");
  });
});
