import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { E2E_API_URL } from "../playwright.config";
import { expectNoSeriousA11yViolations } from "./a11y";
import { expect, type SeededPaths, test } from "./fixtures";

const PNG = readFileSync(fileURLToPath(new URL("./fixtures/photo-3000x2000.png", import.meta.url)));

/*
 * The worksheet editor on `/w/$worksheetId` (TEACH-109): rows 1, 2, 3, 7 and 9 of the acceptance
 * table with a real caret and a real pointer — typing into Tiptap, the slash menu from `/`, a drag
 * on the gutter handle, Print opening a new tab — where happy-dom cannot follow.
 */

const EDITOR = (paths: SeededPaths) => paths.worksheet("fraction-practice");
const blocks = (page: Page) => page.locator(".ws-column .ws-block");
const proseMirror = (page: Page) => page.locator(".ws-column .ProseMirror");

test.describe("worksheet editor", () => {
  test("row 1: the header, every block and Saved; page breaks as the print route makes them", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(EDITOR(paths));
    await expect(page).toHaveTitle("Fractions practice · Teaching Journey");
    // The chrome's h1 and the sheet's own title both read "Fractions practice" (TEACH-186).
    await expect(
      page.getByRole("heading", { level: 1, name: "Fractions practice" }).first(),
    ).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Sheet title" })).toHaveText(
      "Fractions practice",
    );
    await expect(blocks(page)).toHaveCount(9);
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    // The same paginator as `/print`: the same number of pages.
    const editorPages = await page.locator(".ws-column .ws-page").count();
    await page.goto(paths.worksheet("fraction-practice", "/print"));
    await expect(page.locator(".ws-print-root")).toHaveCSS("visibility", "visible");
    expect(await page.locator(".ws-print-root .ws-page").count()).toBe(editorPages);
  });

  test("row 2: a typing burst is one undo step and autosaves", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(EDITOR(paths));
    const stem = blocks(page).locator(".ws-q-stem").first();
    await expect(stem).toBeVisible();
    const original = (await stem.textContent()) ?? "";
    await stem.click();
    const pm = proseMirror(page);
    await expect(pm).toBeFocused();
    await page.keyboard.press("End");
    await page.keyboard.type(" abc", { delay: 30 });
    await expect(pm).toHaveText(`${original} abc`);
    await expect(page.getByText("Unsaved changes")).toBeVisible();
    // Pause past the idle window so the session closes, then undo: the whole burst goes.
    await page.waitForTimeout(700);
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    await expect(pm).toHaveText(original);
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 3000 });
    // The store has the undone text: reload and read it back.
    await page.reload();
    await expect(blocks(page).locator(".ws-q-stem").first()).toHaveText(original);
  });

  test("row 3: `/` in an empty paragraph opens the slash menu; Question inserts a numbered block", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(EDITOR(paths));
    await expect(blocks(page)).toHaveCount(9);
    const count = 9;
    // Insert a paragraph below the first block through the gutter, then type `/` into it.
    const first = blocks(page).first();
    await first.hover();
    await first.getByRole("button", { name: "Insert a block below" }).click();
    // The gutter + opens "Add a block" (TEACH-183); Blocks > Paragraph inserts an empty one.
    const dialog = page.getByRole("dialog", { name: "Add a block" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("tab", { name: "Blocks" }).click();
    await dialog.getByRole("button", { name: /^Paragraph/ }).click();
    await expect(dialog).toBeHidden();
    await expect(blocks(page)).toHaveCount(count + 1);
    const pm = proseMirror(page);
    await expect(pm).toBeFocused();
    await page.keyboard.type("/");
    const list = page.getByRole("listbox", { name: "Block types" });
    await expect(list).toBeVisible();
    // Fifteen block types (headings twice, True or false and Sorting table) and the nine sections.
    await expect(list.getByRole("option")).toHaveCount(27);
    // The popover arrives over a fade; axe reads contrast through it, so let the motion finish.
    await page
      .locator('[role="dialog"]')
      .last()
      .evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
    await expectNoSeriousA11yViolations(page, "/w/:id (slash menu open)");
    await page.getByRole("combobox", { name: "Filter blocks" }).fill("question");
    await page.keyboard.press("Enter");
    // The empty paragraph was replaced by a question: same count, a new numbered stem with the
    // caret in it. Found by focus, not position: `pickFromSlash` deletes the paragraph before it
    // inserts after the paragraph's id, so the replacement lands at the end of the sheet rather
    // than in place (tech debt, TEACH-186 review); the old seed hid it because block 2 was q1.
    await expect(blocks(page)).toHaveCount(count + 1);
    await expect(proseMirror(page)).toBeFocused();
    const inserted = blocks(page).filter({ has: page.locator(".ProseMirror") });
    await expect(inserted.locator(".ws-q-no")).toHaveText(/^\d+\.$/);
    await expect(inserted.locator(".ws-lines .ws-line")).toHaveCount(2);
  });

  test("row 7: dragging the gutter handle of block 3 above block 1 reorders in one undo step", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(EDITOR(paths));
    await expect(blocks(page)).toHaveCount(9);
    const ids = await blocks(page).evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-block-id")),
    );
    const third = blocks(page).nth(2);
    await third.hover();
    const handle = third.getByRole("button", { name: "Drag to reorder this block" });
    const hb = await handle.boundingBox();
    const fb = await blocks(page).first().boundingBox();
    if (!hb || !fb) throw new Error("no geometry");
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x, fb.y + 2, { steps: 8 });
    await expect(page.locator(".ws-drop-line")).toBeVisible();
    await page.mouse.up();
    const after = await blocks(page).evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-block-id")),
    );
    expect(after.slice(0, 3)).toEqual([ids[2], ids[0], ids[1]]);
    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    const undone = await blocks(page).evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-block-id")),
    );
    expect(undone).toEqual(ids);
  });

  test("row 9: Print opens the print route with ?auto=1 in a new tab", async ({
    signedInPage: { page, paths },
  }) => {
    const context = page.context();
    await page.goto(EDITOR(paths));
    await expect(page.getByRole("button", { name: "Print" })).toBeEnabled();
    const [tab] = await Promise.all([
      context.waitForEvent("page"),
      page.getByRole("button", { name: "Print" }).click(),
    ]);
    await tab.waitForLoadState();
    expect(new URL(tab.url()).pathname + new URL(tab.url()).search).toBe(
      `${paths.worksheet("fraction-practice", "/print")}?auto=1`,
    );
    await tab.close();
  });

  test("row 10: a lesson id on the worksheet route shows the wrong-kind page", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(`/w/${paths.id("demo-water-cycle")}`);
    await expect(page.getByText("This is a lesson")).toBeVisible();
    await page.getByRole("link", { name: "Open the lesson" }).click();
    await expect(page).toHaveURL(new RegExp(`${paths.lesson("demo-water-cycle")}$`));
    await page.goto(`/l/${paths.id("fraction-practice")}`);
    await expect(page.getByText("This is a worksheet")).toBeVisible();
  });

  test("TEACH-160 row 7: Replace picks a Pexels photo and autosaves it with provenance", async ({
    signedInPage: { page, paths },
  }) => {
    // The seed has no image block and the UI cannot insert one: merge it into the loaded
    // document. Pexels and the bucket are mocked; the api itself is real.
    await page.route("**/documents/*", async (route) => {
      const request = route.request();
      if (
        request.method() !== "GET" ||
        !/\/documents\/[^/]+$/.test(new URL(request.url()).pathname)
      ) {
        return route.continue();
      }
      const response = await route.fetch();
      const body = (await response.json()) as {
        document?: { body?: { blocks?: unknown[] } };
      };
      body.document?.body?.blocks?.push({
        id: "wb-img-1",
        type: "image",
        src: "data:image/svg+xml;utf8,placeholder",
        alt: "Describe this image for pupils using a screen reader",
        widthPct: 60,
        caption: "Figure 1",
      });
      return route.fulfill({
        status: response.status(),
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    });
    await page.route(`${E2E_API_URL}/images/search*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          photos: [
            {
              id: "leaf",
              width: 6000,
              height: 4000,
              alt: "Leaf",
              photographer: "Ada",
              photographerUrl: "https://www.pexels.com/@ada",
              pageUrl: "https://www.pexels.com/photo/leaf/",
              src: {
                large: "https://images.pexels.com/photos/leaf/large.jpeg",
                medium: "https://images.pexels.com/photos/leaf/medium.jpeg",
                tiny: "https://images.pexels.com/photos/leaf/tiny.jpeg",
              },
            },
          ],
          nextPage: null,
        }),
      }),
    );
    await page.route(`${E2E_API_URL}/images/pick`, (route) =>
      route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          key: "ws/images/leaf.jpg",
          url: "/files/ws/images/leaf.jpg",
          width: 6000,
          height: 4000,
          bytes: 100,
          contentType: "image/png",
          source: {
            provider: "pexels",
            id: "leaf",
            pageUrl: "https://www.pexels.com/photo/leaf/",
            photographer: "Ada",
            photographerUrl: "https://www.pexels.com/@ada",
          },
        }),
      }),
    );
    await page.route("https://images.pexels.com/**", (route) =>
      route.fulfill({ status: 200, contentType: "image/png", body: PNG }),
    );

    await page.goto(EDITOR(paths));
    await expect(blocks(page)).not.toHaveCount(0);
    const figure = blocks(page).locator("figure.ws-figure").first();
    await figure.click();
    const toolbar = page.getByRole("toolbar", { name: "Image block" });
    await expect(toolbar).toBeVisible();
    await toolbar.getByRole("button", { name: "Replace" }).click();
    const dialog = page.getByRole("dialog", { name: "Replace image" });
    await dialog.getByRole("tab", { name: "Photos" }).click();
    const field = dialog.getByRole("searchbox", { name: "Search images" });
    await field.fill("leaf");
    await field.press("Enter");
    await dialog.getByRole("button", { name: "Leaf" }).click();

    await expect(figure.locator("img")).toHaveAttribute(
      "src",
      `${E2E_API_URL}/files/ws/images/leaf.jpg`,
    );
    const put = await page.waitForResponse(
      (res) => res.request().method() === "PUT" && /\/documents\//.test(res.url()),
    );
    const saved = (await put.request().postDataJSON()) as {
      document?: { blocks?: { id: string; src: string; source?: { provider: string } }[] };
    };
    const block = saved.document?.blocks?.find((b) => b.id === "wb-img-1");
    expect(block?.src).toBe(`${E2E_API_URL}/files/ws/images/leaf.jpg`);
    expect(block?.source?.provider).toBe("pexels");
  });
});
