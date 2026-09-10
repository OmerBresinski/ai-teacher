import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { expect, test } from "@playwright/test";

const root = resolve(import.meta.dirname, "../../..");
const output = resolve(root, "homepage/dist");

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
        await page.route("http://homepage.test/**", async (route) => {
          const url = new URL(route.request().url());
          requests.push(`${route.request().method()} ${url.pathname}${url.search}`);
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
