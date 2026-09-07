/**
 * Accessibility gate (F18-R09): axe on every route we ship, in each of the three themes, plus the
 * open state of every dialog and the card menu. Serious/critical violations fail; moderate/minor
 * are reported. The theme is set through `localStorage` before the pre-paint script runs
 * (`addInitScript` precedes every page script), so each scan sees the final colours.
 */
import { expectNoSeriousA11yViolations } from "./a11y";
import { expect, type SeededPaths, test } from "./fixtures";

test.describe("accessibility (axe)", () => {
  test("/sign-in has no serious or critical violations", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.getByText("Sign in to Teaching Journey")).toBeVisible();
    await expectNoSeriousA11yViolations(page, "/sign-in");
  });

  test("/ (signed in) has no serious or critical violations", async ({
    signedInPage: { page },
  }) => {
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    await expectNoSeriousA11yViolations(page, "/");
  });

  test("/dev/jobs has no serious or critical violations (idle and with events)", async ({
    signedInPage: { page },
  }) => {
    await page.goto("/dev/jobs");
    await expect(page.getByText("Jobs / SSE demo", { exact: true })).toBeVisible();
    await expectNoSeriousA11yViolations(page, "/dev/jobs (idle)");

    await page.getByRole("button", { name: "Run ping" }).click();
    await expect(page.getByRole("list", { name: "Job events" })).toBeVisible();
    await expectNoSeriousA11yViolations(page, "/dev/jobs (with events)");
  });

  const THEMES = ["light", "dark", "high-contrast"] as const;
  const ROUTES = (paths: SeededPaths): { path: string; ready: RegExp | string }[] => [
    { path: "/", ready: "Home" },
    { path: "/lessons", ready: "Lessons" },
    { path: "/worksheets", ready: "Worksheets" },
    { path: "/series", ready: "Series" },
    { path: paths.series("series-romans"), ready: "The Romans" },
    { path: paths.lesson("demo-water-cycle"), ready: "The water cycle" },
    { path: paths.lesson("demo-water-cycle", "/view"), ready: /\d+ slides/ },
    { path: paths.lesson("demo-water-cycle", "/present"), ready: "Start presenting" },
    { path: paths.worksheet("fraction-practice"), ready: "Fractions practice" },
    // The print route paints paper-white pages whatever the theme (print.css forces the sheet).
    {
      path: paths.worksheet("fraction-practice", "/print"),
      ready: "The water cycle: check your understanding",
    },
  ];

  for (const theme of THEMES) {
    test(`every route is clean in the ${theme} theme`, async ({
      signedInPage: { page, paths },
    }) => {
      await page.addInitScript((value) => localStorage.setItem("tj-theme", value), theme);
      for (const route of ROUTES(paths)) {
        await page.goto(route.path);
        await expect(page.getByText(route.ready).first()).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await expectNoSeriousA11yViolations(page, `${route.path} (${theme})`);
      }
    });
  }

  test("open overlays are clean: create dialogs, card menu, series row menu", async ({
    signedInPage: { page, paths },
  }) => {
    // Dialogs and menus arrive over 450 ms; axe reads contrast through the fade, so wait for every
    // running animation on the surface (or its inner wrapper) to finish rather than for a fixed time.
    const settled = async () => {
      const surface = page.locator('[role="dialog"], [role="menu"]').last();
      await surface.evaluate((el) =>
        Promise.all(el.getAnimations({ subtree: true }).map((animation) => animation.finished)),
      );
    };
    for (const label of ["New lesson", "New worksheet", "New series"]) {
      await page.getByRole("button", { name: label }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await settled();
      await expectNoSeriousA11yViolations(page, `${label} dialog`, '[role="dialog"]');
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }

    await page.goto("/lessons");
    const card = page.locator("article").first();
    await card.hover();
    await card.getByRole("button", { name: "More actions" }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await settled();
    await expectNoSeriousA11yViolations(page, "card menu", '[role="menu"]');
    await page.keyboard.press("Escape");

    await page.goto(paths.series("series-romans"));
    await page.getByRole("button", { name: "Add lesson" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await settled();
    await expectNoSeriousA11yViolations(page, "Add lessons dialog", '[role="dialog"]');
    await page.keyboard.press("Escape");

    // The editor with a text element being typed into: Tiptap's contenteditable plus the text
    // toolbar over it (TEACH-104 row 12).
    await page.goto(paths.lesson("demo-water-cycle"));
    const title = page
      .locator("[data-slide-frame] [data-element-id]")
      .filter({ hasText: "The water cycle" })
      .first();
    const titleBox = await title.boundingBox();
    if (!titleBox) throw new Error("no title");
    // Under the transform layer's catcher, so click where it is rather than on it.
    await page.mouse.dblclick(titleBox.x + titleBox.width / 2, titleBox.y + titleBox.height / 2);
    await expect(page.locator("[data-slide-frame] .ProseMirror")).toBeFocused();
    await expect(page.getByRole("toolbar", { name: "Text" })).toBeVisible();
    await expectNoSeriousA11yViolations(page, "editor with text editing open");

    // The shape toolbar with its More drawer open, and the theme dialog (TEACH-105 row 11).
    await page.keyboard.press("Escape");
    await page
      .getByRole("toolbar", { name: "Insert" })
      .getByRole("button", { name: "Shape" })
      .click();
    await page.getByRole("menuitem", { name: "Rectangle" }).click();
    await expect(page.getByRole("toolbar", { name: "Shape" })).toBeVisible();
    await page
      .getByRole("toolbar", { name: "Shape" })
      .getByRole("button", { name: "More" })
      .click();
    await expect(page.getByRole("dialog", { name: "More" })).toBeVisible();
    await settled();
    await expectNoSeriousA11yViolations(page, "shape toolbar + More drawer");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Theme" }).click();
    await expect(page.getByRole("dialog", { name: "Theme" })).toBeVisible();
    await settled();
    await expectNoSeriousA11yViolations(page, "theme dialog", '[role="dialog"]');
    await page.keyboard.press("Escape");

    // The Add image panel on both tabs (TEACH-107 row 12); the search is mocked, never live.
    await page.route("https://api.openverse.org/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          page_count: 1,
          results: [
            {
              id: "a11y",
              title: "River",
              url: "https://cors.test/a.png",
              thumbnail: "https://cors.test/a-thumb.png",
              creator: "Ada",
              license: "by",
              license_version: "2.0",
            },
          ],
        }),
      }),
    );
    await page.route("https://cors.test/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>',
      }),
    );
    await page
      .getByRole("toolbar", { name: "Insert" })
      .getByRole("button", { name: "Image" })
      .click();
    const imagePanel = page.getByRole("dialog", { name: "Add image" });
    await expect(imagePanel).toBeVisible();
    await settled();
    await expectNoSeriousA11yViolations(page, "add image panel (upload)", '[role="dialog"]');
    await imagePanel.getByRole("tab", { name: "Photos" }).click();
    const field = imagePanel.getByRole("searchbox", { name: "Search images" });
    await field.fill("river");
    await field.press("Enter");
    await expect(imagePanel.getByRole("button", { name: "River by Ada, CC BY 2.0" })).toBeVisible();
    await settled();
    await expectNoSeriousA11yViolations(page, "add image panel (photos)", '[role="dialog"]');
  });
});
