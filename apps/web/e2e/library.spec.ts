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

  test("New lesson creates an untitled lesson, opens its stub and leads Recent on return", async ({
    signedInPage: { page },
  }) => {
    await page.getByRole("button", { name: "New lesson" }).click();
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("radio", { name: "Playground" }).click();
    await page.getByRole("button", { name: "Create lesson" }).click();

    await expect(page).toHaveURL(/\/l\/[^/]+$/);
    await expect(page.getByText("Untitled lesson", { exact: true }).first()).toBeVisible();

    await page.getByLabel("Back to the library").click();
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
    // Starter worksheets have 4 blocks (mock store).
    const card = page.locator("article", { hasText: "Decimals practice" }).first();
    await expect(card).toBeVisible();
    await page.getByRole("button", { name: "List" }).click();
    await expect(page.getByRole("row", { name: /Decimals practice/ })).toContainText("4 blocks");
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
    await expect(page.getByText("The water cycle")).toBeVisible();
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

  test("editor stubs return to the last library page", async ({ signedInPage: { page } }) => {
    await page.goto("/lessons");
    await expect(page.getByRole("heading", { name: "Lessons" })).toBeVisible();
    await expect(page).toHaveTitle("Lessons · Teaching Journey");
    await page.goto("/l/demo-water-cycle");
    await expect(page.getByText("The editor arrives with @tj/editor")).toBeVisible();
    // Route `head()` reads the loader's document.
    await expect(page).toHaveTitle("The water cycle · Teaching Journey");
    await expect(page.getByRole("navigation", { name: "Library" })).not.toBeVisible();
    await page.getByLabel("Back to the library").click();
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
});
