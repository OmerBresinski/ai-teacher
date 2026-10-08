/**
 * Accessibility gate (F18-R09): axe on every route we ship, in each of the three themes, plus the
 * open state of every dialog and the card menu. Serious/critical violations fail; moderate/minor
 * are reported. The light theme gets the full rule set; dark and high contrast run only the rules
 * a theme can change (`THEME_RULES`: contrast, link distinction, target size). A page opens in its
 * first theme through `localStorage` before the pre-paint script runs (`addInitScript` precedes
 * every page script); the route tests then switch the open page with `switchTheme`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Lesson } from "@tj/domain/documents";
import { generatedLesson } from "@tj/domain/documents/fixtures";
import {
  demoWorkspace,
  drawFigure,
  FIGURE_RECT,
  getTheme,
  newLesson,
  newSlide,
} from "@tj/editor/starter";
import { expectNoSeriousA11yViolations, settled, switchTheme } from "./a11y";
import { E2E_API_URL, E2E_WEB_URL, expect, type SeededPaths, test, uniqueEmail } from "./fixtures";

test.describe("accessibility (axe)", () => {
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

  // /sign-in (TEACH-252), signed out, in each theme: the idle form, the sent state and a failed
  // round trip's alert.
  for (const theme of THEMES) {
    test(`/sign-in is clean in the ${theme} theme: idle, sent and ?error=`, async ({ page }) => {
      await page.addInitScript((value) => localStorage.setItem("tj-theme", value), theme);
      await page.goto("/sign-in");
      await expect(
        page.getByRole("heading", { level: 1, name: "Welcome to DayBack" }),
      ).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expectNoSeriousA11yViolations(page, `/sign-in (${theme})`, undefined, { theme });

      await page.getByLabel("Email address").fill(uniqueEmail("a11y"));
      await page.getByRole("button", { name: "Email me a link" }).click();
      await expect(page.getByRole("status")).toHaveText(/Check your inbox/);
      await expectNoSeriousA11yViolations(page, `/sign-in sent (${theme})`, undefined, { theme });

      await page.goto("/sign-in?error=INVALID_TOKEN");
      await expect(page.getByRole("alert")).toBeVisible();
      await expectNoSeriousA11yViolations(
        page,
        `/sign-in?error=INVALID_TOKEN (${theme})`,
        undefined,
        { theme },
      );
    });
  }
  /** Every route we ship, by name; the path is built from the seeded ids inside the test. */
  const ROUTES: { name: string; path: (paths: SeededPaths) => string; ready: RegExp | string }[] = [
    { name: "/", path: () => "/", ready: "Home" },
    { name: "/lessons", path: () => "/lessons", ready: "Lessons" },
    { name: "/lessons/new", path: () => "/lessons/new", ready: "Let’s start with your idea." },
    { name: "/worksheets", path: () => "/worksheets", ready: "Worksheets" },
    { name: "/worksheets/new", path: () => "/worksheets/new", ready: "From a lesson" },
    { name: "/series", path: () => "/series", ready: "Series" },
    { name: "/settings", path: () => "/settings", ready: "Account" },
    { name: "/series/:id", path: (p) => p.series("series-romans"), ready: "The Romans" },
    { name: "/l/:id", path: (p) => p.lesson("demo-water-cycle"), ready: "The water cycle" },
    {
      name: "/l/:id/view",
      path: (p) => p.lesson("demo-water-cycle", "/view"),
      ready: /\d+ slides/,
    },
    {
      name: "/l/:id/present",
      path: (p) => p.lesson("demo-water-cycle", "/present"),
      ready: "The water cycle",
    },
    // The lesson print route (TEACH-110) paints paper-white pages whatever the theme.
    {
      name: "/l/:id/print",
      path: (p) => p.lesson("demo-water-cycle", "/print"),
      ready: /Slide 1 of \d+|The water cycle/,
    },
    { name: "/w/:id", path: (p) => p.worksheet("fraction-practice"), ready: "Fractions practice" },
    // The print route paints paper-white pages whatever the theme (print.css forces the sheet).
    {
      name: "/w/:id/print",
      path: (p) => p.worksheet("fraction-practice", "/print"),
      ready: "Fractions practice",
    },
  ];

  // One test per route (TEACH-190 part a): the page opens once in the light theme for the full
  // scan, then switches to dark and to high contrast for the colour rules.
  for (const route of ROUTES) {
    test(`${route.name} is clean in every theme`, async ({ signedInPage: { page, paths } }) => {
      const path = route.path(paths);
      await page.addInitScript(() => localStorage.setItem("tj-theme", "light"));
      await page.goto(path);
      await expect(page.getByText(route.ready).first()).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
      // Some pages arrive with a fade (the brief, the creation flow); axe reads contrast mid-fade.
      await settled(page, "html");
      await expectNoSeriousA11yViolations(page, `${path} (light)`);
      for (const theme of ["dark", "high-contrast"] as const) {
        await switchTheme(page, theme);
        await expectNoSeriousA11yViolations(page, `${path} (${theme})`, undefined, { theme });
      }
    });
  }

  // TEACH-133: the generating view (a locked lesson under its banner) and the editor's residual
  // popover, in each theme. The lock is a job that never ran, dated now so it is not stale.
  test("the generating view and the residual popover are clean in every theme", async ({
    signedInPage: { page },
  }) => {
    const jobId = "01a06a15-1849-7000-ac6a-c07e27fe308b";
    const water = demoWorkspace(new Date()).find((d) => d.key === "demo-water-cycle");
    if (!water) throw new Error("fixture missing");
    const body = { ...water.body, updatedAt: new Date().toISOString() };
    const generated = generatedLesson();
    const res = await page.request.post(`${E2E_API_URL}/__test/seed-library`, {
      headers: { origin: E2E_WEB_URL },
      data: {
        documents: [
          { ...water, key: "locked", body, generatingJobId: jobId },
          { key: "generated", kind: "lesson", body: { ...generated, updatedAt: body.updatedAt } },
        ],
      },
    });
    expect(res.ok(), await res.text()).toBe(true);
    const { ids } = (await res.json()) as { ids: Record<string, string> };
    for (const theme of THEMES) {
      await page.addInitScript((value) => localStorage.setItem("tj-theme", value), theme);
      await page.goto(`/l/${ids.locked}`);
      await expect(page.getByTestId("generating-shell")).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expectNoSeriousA11yViolations(page, `generating view (${theme})`, undefined, { theme });

      await page.goto(`/l/${ids.generated}`);
      await page.getByRole("button", { name: /thing(s)? to check$/ }).click();
      const popover = page.locator('[data-slot="popover-content"]');
      await expect(popover.getByRole("list").filter({ hasText: "too abstract" })).toBeVisible();
      // axe reads contrast through the arrival fade: wait for it to finish.
      await popover.evaluate((el) =>
        Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)),
      );
      await expectNoSeriousA11yViolations(page, `residual popover (${theme})`, undefined, {
        theme,
      });
      await page.keyboard.press("Escape");
    }
  });

  // TEACH-134: the facts panel open, then the regenerate dialog over it, in each theme. Its own
  // test: six axe runs already fill the 30 s budget on CI, so these six get their own.
  test("the facts panel and the regenerate dialog are clean in every theme", async ({
    signedInPage: { page },
  }) => {
    const generated = generatedLesson();
    const res = await page.request.post(`${E2E_API_URL}/__test/seed-library`, {
      headers: { origin: E2E_WEB_URL },
      data: {
        documents: [
          {
            key: "generated",
            kind: "lesson",
            body: { ...generated, updatedAt: new Date().toISOString() },
          },
        ],
      },
    });
    expect(res.ok(), await res.text()).toBe(true);
    const { ids } = (await res.json()) as { ids: Record<string, string> };
    for (const theme of THEMES) {
      await page.addInitScript((value) => localStorage.setItem("tj-theme", value), theme);
      await page.goto(`/l/${ids.generated}`);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.getByRole("button", { name: "Facts" }).click();
      await expect(page.getByRole("complementary", { name: "Facts" })).toBeVisible();
      await expectNoSeriousA11yViolations(page, `facts panel (${theme})`, undefined, { theme });
      await page
        .getByRole("listbox", { name: "Slides" })
        .getByRole("option")
        .nth(1)
        .click({ button: "right" });
      await page.getByRole("menuitem", { name: "Regenerate slide…" }).click();
      const dialog = page.getByRole("dialog", { name: "Regenerate slide 2" });
      await expect(dialog).toBeVisible();
      await dialog.evaluate((el) =>
        Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)),
      );
      await expectNoSeriousA11yViolations(page, `regenerate dialog (${theme})`, '[role="dialog"]', {
        theme,
      });
      await page.keyboard.press("Escape");
    }
  });

  // TEACH-77 row 8: a diagram slide's figure is one image named by its alt text, in the viewer,
  // on the presenter's stage and in the editor. Slide 2's figure is clamped, so its muted "Not
  // drawn to scale" caption is scanned too.
  test("a diagram slide is clean, its figure named by its alt text", async ({
    signedInPage: { page },
  }) => {
    const lesson: Lesson = { ...newLesson("Pythagoras' theorem", "chalk"), id: "diagram" };
    const clamped = newSlide("diagram", "chalk");
    clamped.elements[0] = drawFigure(
      "right-triangle",
      {
        base: { length: 7, label: "7 cm" },
        height: { length: 24, label: "24 cm" },
        hypotenuse: { label: "x" },
      },
      getTheme("chalk"),
      FIGURE_RECT,
    );
    lesson.slides = [newSlide("diagram", "chalk"), clamped];
    const res = await page.request.post(`${E2E_API_URL}/__test/seed-library`, {
      headers: { origin: E2E_WEB_URL },
      data: { documents: [{ key: "diagram", kind: "lesson", body: lesson }] },
    });
    expect(res.ok(), await res.text()).toBe(true);
    const { ids } = (await res.json()) as { ids: Record<string, string> };
    const placeholder = "Right-angled triangle. Base 3 cm, height 4 cm, hypotenuse x.";
    const notToScale =
      "Right-angled triangle. Base 7 cm, height 24 cm, hypotenuse x. Not drawn to scale.";

    await page.goto(`/l/${ids.diagram}/view`);
    await expect(page.getByRole("status")).toHaveText("Slide 1 of 2");
    const viewed = page.locator('[data-slide-mode="view"]');
    await expect(viewed.getByRole("img", { name: placeholder })).toBeVisible();
    await expectNoSeriousA11yViolations(page, "/l/:id/view (diagram)");

    await page.goto(`/l/${ids.diagram}/present?slide=2`);
    await expect(page.locator('[data-slide-mode="present"]')).toHaveCount(1);
    const stage = page.locator('[data-slide-mode="present"]');
    await expect(stage).toHaveCount(1);
    await expect(stage.getByRole("img", { name: notToScale })).toBeVisible();
    await stage.evaluate((el) =>
      Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)),
    );
    await expectNoSeriousA11yViolations(page, "/l/:id/present (diagram)");

    await page.goto(`/l/${ids.diagram}`);
    await expect(page.getByRole("img", { name: placeholder }).first()).toBeVisible();
    await expectNoSeriousA11yViolations(page, "/l/:id (diagram)");
  });

  // Keep overlay groups independent: the combined walk outgrew CI's 30-second test budget.
  test("open overlays are clean: library dialogs and card menu", async ({
    signedInPage: { page, paths },
  }) => {
    // New lesson is the brief screen since TEACH-122 and New worksheet the creation flow since
    // TEACH-184 (both scanned in the route list); the dialog stays for series.
    for (const label of ["New series"]) {
      await page.getByRole("button", { name: label }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await settled(page);
      await expectNoSeriousA11yViolations(page, `${label} dialog`, '[role="dialog"]');
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }

    await page.goto("/lessons");
    const card = page.locator("article").first();
    await card.hover();
    await card.getByRole("button", { name: "More actions" }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await settled(page);
    await expectNoSeriousA11yViolations(page, "card menu", '[role="menu"]');
    await page.keyboard.press("Escape");

    await page.goto(paths.series("series-romans"));
    await page.getByRole("button", { name: "Add lesson" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await settled(page);
    await expectNoSeriousA11yViolations(page, "Add lessons dialog", '[role="dialog"]');
    await page.keyboard.press("Escape");
  });

  test("open overlays are clean: editor controls", async ({ signedInPage: { page, paths } }) => {
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
    await settled(page);
    await expectNoSeriousA11yViolations(page, "shape toolbar + More drawer");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Theme" }).click();
    await expect(page.getByRole("dialog", { name: "Theme" })).toBeVisible();
    await settled(page);
    await expectNoSeriousA11yViolations(page, "theme dialog", '[role="dialog"]');
    await page.keyboard.press("Escape");
  });

  // TEACH-113: the editor's `?` sheet, present mode's sheet, timer and notes panels, and the
  // worksheet slash menu — the overlays the earlier tickets left out.
  test("open overlays are clean: help sheet, present panels, worksheet slash menu", async ({
    signedInPage: { page, paths },
  }) => {
    test.setTimeout(45_000);
    await page.goto(paths.lesson("demo-water-cycle"));
    await page.getByRole("group", { name: "Slide canvas" }).focus();
    await page.keyboard.press("?");
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
    await settled(page);
    await expectNoSeriousA11yViolations(page, "editor help sheet", '[role="dialog"]');
    await page.keyboard.press("Escape");

    await page.goto(paths.lesson("demo-water-cycle", "/present"));
    await expect(page.locator('[data-slide-mode="present"]')).toHaveCount(1);
    await page.keyboard.press("t");
    await expect(page.getByRole("dialog", { name: "Timer" })).toBeVisible();
    await settled(page);
    await expectNoSeriousA11yViolations(page, "present timer panel");
    await page.keyboard.press("Escape");
    // The popover owns the keyboard until its fade-out has unmounted it.
    await expect(page.getByRole("dialog", { name: "Timer" })).toHaveCount(0);
    await page.keyboard.press("n");
    await expect(page.getByRole("complementary", { name: "Presenter notes" })).toBeVisible();
    await expectNoSeriousA11yViolations(page, "present notes panel");
    await page.keyboard.press("?");
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
    await settled(page);
    await expectNoSeriousA11yViolations(page, "present shortcuts sheet", '[role="dialog"]');
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");

    // The slash menu: `/` in a fresh paragraph (the gutter + → Blocks → Paragraph).
    await page.goto(paths.worksheet("fraction-practice"));
    const first = page.locator(".ws-column .ws-block:not(.ws-rag-slot)").first();
    await first.hover();
    await first.getByRole("button", { name: "Insert a block below" }).click();
    const add = page.getByRole("dialog", { name: "Add a block" });
    await add.getByRole("tab", { name: "Blocks" }).click();
    await add.getByRole("button", { name: /^Paragraph/ }).click();
    await expect(page.locator(".ws-column .ProseMirror")).toBeFocused();
    await page.keyboard.type("/");
    await expect(page.getByRole("listbox", { name: "Block types" })).toBeVisible();
    await settled(page);
    await expectNoSeriousA11yViolations(page, "worksheet slash menu");
  });

  test("open overlays are clean: export and import dialogs", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(paths.lesson("demo-water-cycle"));
    // The export dialog (TEACH-110 row 12), on the PDF tab it opens on and on JSON.
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Export" })).toBeVisible();
    await settled(page);
    await expectNoSeriousA11yViolations(page, "export dialog", '[role="dialog"]');
    await page.getByRole("tab", { name: "JSON" }).click();
    await expectNoSeriousA11yViolations(page, "export dialog (JSON)", '[role="dialog"]');
    // E2 (TEACH-111 row 9): the PowerPoint and PNG tabs.
    await page.getByRole("tab", { name: "PowerPoint" }).click();
    await expectNoSeriousA11yViolations(page, "export dialog (PowerPoint)", '[role="dialog"]');
    await page.getByRole("tab", { name: "PNG" }).click();
    await expectNoSeriousA11yViolations(page, "export dialog (PNG)", '[role="dialog"]');
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Export" })).toHaveCount(0);

    // The worksheet editor's export dialog on the Word tab (TEACH-112 row 4).
    await page.goto(paths.worksheet("fraction-practice"));
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Export" })).toBeVisible();
    await page.getByRole("tab", { name: "Word" }).click();
    await settled(page);
    await expectNoSeriousA11yViolations(page, "export dialog (Word)", '[role="dialog"]');
    await page.keyboard.press("Escape");

    // The library Import dialog (TEACH-110), reached from the sidebar.
    await page.goto("/lessons");
    await page.getByRole("button", { name: "Import" }).click();
    await expect(page.getByRole("dialog", { name: "Import" })).toBeVisible();
    await settled(page);
    await expectNoSeriousA11yViolations(page, "import dialog", '[role="dialog"]');
    await page.keyboard.press("Escape");
  });

  test("open overlays are clean: image upload and photo search", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(paths.lesson("demo-water-cycle"));
    await expect(page.getByRole("toolbar", { name: "Insert" })).toBeVisible();

    // The Add image panel on both tabs (TEACH-107 row 12, TEACH-158); the search is mocked, never live.
    await page.route(`${E2E_API_URL}/images/search*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          photos: [
            {
              id: "a11y",
              width: 900,
              height: 600,
              alt: "River",
              photographer: "Ada",
              photographerUrl: "https://www.pexels.com/@ada",
              pageUrl: "https://www.pexels.com/photo/a11y/",
              src: {
                large: "https://images.pexels.com/photos/a11y/large.jpeg",
                medium: "https://images.pexels.com/photos/a11y/medium.jpeg",
                tiny: "https://images.pexels.com/photos/a11y/tiny.jpeg",
              },
            },
          ],
          nextPage: null,
        }),
      }),
    );
    await page.route("https://images.pexels.com/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "image/png",
        body: readFileSync(
          fileURLToPath(new URL("./fixtures/photo-3000x2000.png", import.meta.url)),
        ),
      }),
    );
    await page
      .getByRole("toolbar", { name: "Insert" })
      .getByRole("button", { name: "Image" })
      .click();
    const imagePanel = page.getByRole("dialog", { name: "Add image" });
    await expect(imagePanel).toBeVisible();
    await settled(page);
    await expectNoSeriousA11yViolations(page, "add image panel (upload)", '[role="dialog"]');
    await imagePanel.getByRole("tab", { name: "Photos" }).click();
    const field = imagePanel.getByRole("searchbox", { name: "Search images" });
    await field.fill("river");
    await field.press("Enter");
    await expect(imagePanel.getByRole("button", { name: "River" })).toBeVisible();
    await settled(page);
    await expectNoSeriousA11yViolations(page, "add image panel (photos)", '[role="dialog"]');
  });
});
