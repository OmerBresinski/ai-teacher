import { expectNoSeriousA11yViolations } from "./a11y";
import { expect, test } from "./fixtures";

test.describe("library shell", () => {
  test("Home has the library navigation, create strip, and capped sections", async ({
    signedInPage: { page },
  }) => {
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    await expect(page.getByText("TeachDeck", { exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Library" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Home/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Lessons/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Worksheets/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Series/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "New lesson" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recent" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Lessons" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Worksheets" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Series" })).toBeVisible();
  });

  test("New lesson creates an untitled lesson, opens the editor and leads Recent on return", async ({
    signedInPage: { page },
  }) => {
    await page.getByRole("button", { name: "New lesson" }).click();
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("radio", { name: "Playground" }).click();
    await page.getByRole("button", { name: "Create lesson" }).click();

    await expect(page).toHaveURL(/\/l\/[^/]+$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Untitled lesson", exact: true }),
    ).toBeVisible();

    await page.getByLabel("Back to library").click();
    await expect(page).toHaveURL(/\/$/);
    // Newest lesson is the Recent hero: first heading inside the Recent section.
    const recent = page.getByRole("region", { name: "Recent" });
    await expect(recent.getByText("Untitled lesson", { exact: true }).first()).toBeVisible();
    // Sidebar count moved from the seeded 10 to 11.
    // The count is part of the link's accessible name ("Lessons 11").
    await expect(page.getByRole("link", { name: /^Lessons\b/ })).toContainText("11");
  });

  test("New worksheet trims the title and opens the worksheet stub", async ({
    signedInPage: { page },
  }) => {
    await page.getByRole("button", { name: "New worksheet" }).click();
    await page.getByRole("textbox", { name: "Title" }).fill("  Decimals practice  ");
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("radio", { name: "Playground" }).click();
    await page.getByRole("button", { name: "Create worksheet" }).click();

    await expect(page).toHaveURL(/\/w\/[^/]+$/);
    await expect(page.getByText("Decimals practice", { exact: true }).first()).toBeVisible();
    await page.getByLabel("Back to the library").click();
    await page.getByRole("link", { name: /^Worksheets\b/ }).click();
    // The count is the starter worksheet's real block count (TeachDeck `starterWorksheet`, 5).
    const card = page.locator("article", { hasText: "Decimals practice" }).first();
    await expect(card).toBeVisible();
    await page.getByRole("button", { name: "List" }).click();
    await expect(page.getByRole("row", { name: /Decimals practice/ })).toContainText("5 blocks");
  });

  test("New series uses the untitled fallback on Enter", async ({ signedInPage: { page } }) => {
    await page.getByRole("button", { name: "New series" }).click();
    await page.getByRole("textbox", { name: "Title" }).press("Enter");

    await expect(page).toHaveURL(/\/series\/[^/]+$/);
    await expect(page.getByText("Untitled series", { exact: true })).toBeVisible();
  });

  test("Lessons search survives reload and Escape clears it", async ({
    signedInPage: { page },
  }) => {
    await page.goto("/lessons");
    const search = page.getByRole("searchbox", { name: "Search by title" });
    await search.fill("water");
    await expect(page).toHaveURL(/\/lessons\?q=water$/);
    // The title appears on the card and inside its rendered cover slide.
    await expect(page.getByText("The water cycle").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Open The water cycle" })).toHaveCount(1);
    await page.reload();
    await expect(search).toHaveValue("water");
    await search.press("Escape");
    await expect(page).toHaveURL(/\/lessons$/);
  });

  test("collapsed navigation persists after reload and exposes item tooltips", async ({
    signedInPage: { page },
  }) => {
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
    await page.getByRole("link", { name: "Lessons", exact: true }).hover();
    await expect(page.getByRole("tooltip", { name: "Lessons" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  });

  test("document routes return to the last library page", async ({ signedInPage: { page } }) => {
    await page.goto("/lessons");
    await expect(page.getByRole("heading", { name: "Lessons" })).toBeVisible();
    await expect(page).toHaveTitle("Lessons · Teaching Journey");
    // Hover preloads run loaders but must not move the return target (committed navigations only).
    await page.getByRole("link", { name: /^Worksheets\b/ }).hover();
    await page.waitForTimeout(300);
    await page.goto("/l/demo-water-cycle");
    // The editor (TEACH-103) owns `/l/*`; the stub remains on `/w/*` until phase D.
    await expect(page.getByRole("listbox", { name: "Slides" })).toBeVisible();
    // Route `head()` reads the loader's document.
    await expect(page).toHaveTitle("The water cycle · Teaching Journey");
    await expect(page.getByRole("navigation", { name: "Library" })).not.toBeVisible();
    await page.getByLabel("Back to library").click();
    await expect(page).toHaveURL(/\/lessons$/);
  });

  test("unknown editor documents render the not-found page", async ({ signedInPage: { page } }) => {
    await page.goto("/l/nope");

    await expect(page.getByText("Page not found")).toBeVisible();
  });

  test("Series search miss clears the query", async ({ signedInPage: { page } }) => {
    await page.goto("/series?q=zzz");

    await expect(page.getByText("No titles match that")).toBeVisible();
    await page.getByRole("button", { name: "Clear search" }).last().click();
    await expect(page).toHaveURL(/\/series$/);
  });

  test("card cover links and actions preserve their destinations", async ({
    signedInPage: { page },
  }) => {
    await page.goto("/lessons");
    const card = page.locator("article").filter({ hasText: "The water cycle" }).first();
    await card.hover();
    const present = card.getByRole("button", { name: "Present" });
    const box = await present.boundingBox();
    if (!box) throw new Error("Present button has no bounding box");
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page).toHaveURL(/\/l\/demo-water-cycle\/present$/);

    await page.goto("/lessons");
    const body = await card.boundingBox();
    if (!body) throw new Error("Library card has no bounding box");
    await page.mouse.click(body.x + 12, body.y + 12);
    await expect(page).toHaveURL(/\/l\/demo-water-cycle$/);

    await page.goto("/worksheets");
    const worksheet = page.locator("article").filter({ hasText: "Fractions practice" }).first();
    await worksheet.hover();
    await worksheet.getByRole("button", { name: "Print" }).click();
    await expect(page).toHaveURL(/\/w\/fraction-practice\/print$/);
  });

  test("Delete can be undone from a card menu", async ({ signedInPage: { page } }) => {
    await page.goto("/lessons");
    const card = page.locator("article").filter({ hasText: "The water cycle" }).first();
    await card.hover();
    await card.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await expect(page.getByRole("link", { name: "Open The water cycle" })).not.toBeVisible();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByRole("link", { name: "Open The water cycle" })).toBeVisible();
  });

  test("List view uses the library table headings", async ({ signedInPage: { page } }) => {
    await page.goto("/lessons");
    await page.getByRole("button", { name: "List" }).click();
    const table = page.getByRole("table").first();
    await expect(table).toBeVisible();
    await expect(table.getByRole("columnheader")).toHaveText([
      "Thumbnail",
      "Title",
      "Year and subject",
      "Size",
      "Edited",
      "Actions",
    ]);
  });

  test("Home, Lessons grid/list, and Series have no serious or critical axe findings", async ({
    signedInPage: { page },
  }) => {
    await expectNoSeriousA11yViolations(page, "/");
    await page.goto("/lessons");
    await expect(page.getByRole("heading", { name: "Lessons" })).toBeVisible();
    await expectNoSeriousA11yViolations(page, "/lessons");
    await page.getByRole("button", { name: "List" }).click();
    await expectNoSeriousA11yViolations(page, "/lessons (list)");
    await page.goto("/series");
    await expect(page.getByRole("heading", { name: "Series" })).toBeVisible();
    await expectNoSeriousA11yViolations(page, "/series");
    await page.goto("/");
    await page.getByRole("button", { name: "Theme" }).click();
    await page.getByRole("menuitemradio", { name: "Dark" }).click();
    await page.waitForTimeout(200);
    await expectNoSeriousA11yViolations(page, "/ (dark)");
    await page.goto("/lessons");
    await expectNoSeriousA11yViolations(page, "/lessons (dark)");
    await page.goto("/series");
    await expectNoSeriousA11yViolations(page, "/series (dark)");
  });

  test("Create dialogs have no serious or critical axe findings in both themes", async ({
    signedInPage: { page },
  }) => {
    // AddLessonsDialog has no consumer until the series detail page (TEACH-92) mounts it;
    // its axe coverage is added there.
    async function scanDialog(label: string) {
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.waitForTimeout(500);
      await expectNoSeriousA11yViolations(page, label, '[role="dialog"]');
    }
    async function scanAll(theme: string) {
      await page.getByRole("button", { name: "New lesson" }).click();
      await scanDialog(`new lesson dialog, about (${theme})`);
      await page.getByRole("button", { name: "Next" }).click();
      await scanDialog(`new lesson dialog, theme (${theme})`);
      await page.getByRole("button", { name: "Back" }).click();
      await page.getByRole("button", { name: "Cancel" }).click();

      await page.getByRole("button", { name: "New worksheet" }).click();
      await scanDialog(`new worksheet dialog, about (${theme})`);
      await page.getByRole("button", { name: "Next" }).click();
      await scanDialog(`new worksheet dialog, theme (${theme})`);
      await page.getByRole("button", { name: "Back" }).click();
      await page.getByRole("button", { name: "Cancel" }).click();

      await page.getByRole("button", { name: "New series" }).click();
      await scanDialog(`new series dialog (${theme})`);
      await page.getByRole("button", { name: "Cancel" }).click();
    }

    await scanAll("light");
    await page.getByRole("button", { name: "Theme" }).click();
    await page.getByRole("menuitemradio", { name: "Dark" }).click();
    await page.waitForTimeout(500);
    await scanAll("dark");
  });

  test("keyboard only: Tab to a card, F2 rename, Enter; Tab to the menu, Delete, Undo", async ({
    signedInPage: { page },
  }) => {
    await page.goto("/lessons");
    await expect(page.getByRole("heading", { name: "Lessons" })).toBeVisible();
    // Start from the page's first control and Tab until the first card's cover link has focus.
    await page.getByRole("searchbox", { name: "Search by title" }).focus();
    const coverLink = page.getByRole("link", { name: "Open The water cycle" });
    for (let presses = 0; presses < 12; presses += 1) {
      if (await coverLink.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press("Tab");
    }
    await expect(coverLink).toBeFocused();

    await page.keyboard.press("F2");
    const input = page.getByRole("textbox", { name: "Rename The water cycle" });
    await expect(input).toBeFocused();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("Water everywhere");
    await page.keyboard.press("Enter");
    const renamedLink = page.getByRole("link", { name: "Open Water everywhere" });
    await expect(renamedLink).toBeVisible();

    // Overlay actions become visible on focus-within: Tab reaches Present, then the menu.
    await expect(renamedLink).toBeFocused();
    await page.keyboard.press("Tab");
    const card = page.locator("article", { hasText: "Water everywhere" }).first();
    await expect(card.getByRole("button", { name: "Present" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(card.getByRole("button", { name: "More actions" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("End");
    await expect(page.getByRole("menuitem", { name: "Delete" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(renamedLink).toHaveCount(0);

    // The toast's Undo is reachable by keyboard: Tab from wherever focus landed until it is focused.
    const undo = page.getByRole("button", { name: "Undo" });
    await expect(undo).toBeVisible();
    for (let presses = 0; presses < 40; presses += 1) {
      if (await undo.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press("Tab");
    }
    await expect(undo).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("link", { name: "Open Water everywhere" })).toBeVisible();
  });

  test("narrow viewport: two-column grid and a usable sidebar", async ({
    signedInPage: { page },
  }) => {
    await page.setViewportSize({ width: 900, height: 700 });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    const recent = page.getByRole("region", { name: "Recent" });
    const columns = await recent
      .locator(".grid")
      .first()
      .evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(" ").length);
    expect(columns).toBe(2);
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect(page.getByRole("navigation", { name: "Library" })).toHaveCSS("width", "56px");
    await page.getByRole("link", { name: /^Lessons\b/ }).click();
    await expect(page).toHaveURL(/\/lessons$/);
    await expectNoSeriousA11yViolations(page, "/lessons (900px)");
  });

  test("library cards paint the lesson's first slide, not a placeholder initial", async ({
    signedInPage: { page },
  }) => {
    await page.goto("/lessons");
    await expect(page.getByRole("link", { name: "Open The water cycle" })).toBeVisible();
    // Every seeded lesson card carries a rendered slide (TEACH-99); the swatch-and-initial
    // fallback is for documents with no first slide only.
    const cards = page.locator("[data-slot='card-thumbnail']");
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
    await expect(page.locator("[data-slot='card-thumbnail'] [data-slide-root]")).toHaveCount(count);
    // The cover renders the lesson title inside the slide at thumbnail scale.
    const waterCycle = page
      .locator("[data-slide-root]")
      .filter({ hasText: "The water cycle" })
      .first();
    await expect(waterCycle).toHaveAttribute("data-slide-mode", "thumb");
    // The fluid thumb really scales: the 960pt slide's transform resolves to a number below 1 and
    // the scaled slide sits inside its container's width (a rejected `calc()` would leave it 960px).
    const fluid = page.locator("[data-slide-fluid]").first();
    const metrics = await fluid.evaluate((el) => {
      const inner = el.firstElementChild as HTMLElement;
      const matrix = new DOMMatrixReadOnly(getComputedStyle(inner).transform);
      return {
        scale: matrix.a,
        containerWidth: el.getBoundingClientRect().width,
        slideWidth: inner.getBoundingClientRect().width,
      };
    });
    expect(metrics.scale).toBeGreaterThan(0);
    expect(metrics.scale).toBeLessThan(1);
    expect(Math.abs(metrics.slideWidth - metrics.containerWidth)).toBeLessThan(2);
  });
});
