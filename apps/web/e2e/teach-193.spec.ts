/**
 * TEACH-193: worksheet cards paint the top of their own page 1, the meta line keeps the time
 * whole, Print opens the print route with `?auto=1` in a new tab, and marks print only with the
 * sheet's Marks switch on (UX rulings 31 and 60).
 */
import { demoWorkspace } from "@tj/editor/starter";
import { E2E_API_URL, E2E_WEB_URL, expect, test } from "./fixtures";

const TITLES = [
  "Fractions practice",
  "Roman source investigation",
  "Label a flowering plant",
  "River vocabulary",
] as const;

test.describe("TEACH-193", () => {
  test("row 1: each worksheet card shows its own page 1, not a letter", async ({
    signedInPage: { page },
  }) => {
    await page.goto("/worksheets");
    for (const title of TITLES) {
      const card = page.locator("article", {
        has: page.getByRole("link", { name: `Open ${title}` }),
      });
      const thumb = card.locator("[data-slot='card-thumbnail']");
      await expect(thumb.locator(".ws-thumb .ws-page")).toHaveCount(1);
      await expect(thumb.locator(".ws-title")).toHaveText(title);
      await expect(thumb.locator(".font-display")).toHaveCount(0);
      // Fitted to the card: the scaled page is as wide as the frame, and greyscale.
      const frame = await thumb.boundingBox();
      const pageBox = await thumb.locator(".ws-page").boundingBox();
      if (!frame || !pageBox) throw new Error("no thumbnail boxes");
      expect(Math.abs(pageBox.width - frame.width)).toBeLessThan(2);
      await expect(thumb.locator(".ws-thumb")).toHaveCSS("filter", "grayscale(1)");
    }
  });

  test("row 2: a long subject truncates; the edited time stays whole", async ({
    signedInPage: { page },
  }) => {
    const river = demoWorkspace(new Date()).find((d) => d.key === "river-vocabulary");
    if (!river) throw new Error("no river vocabulary seed");
    const sheet = river.body;
    const key = "long-subject";
    const res = await page.request.post(`${E2E_API_URL}/__test/seed-library`, {
      headers: { origin: E2E_WEB_URL },
      data: {
        documents: [
          {
            key,
            kind: "worksheet",
            body: {
              ...sheet,
              id: key,
              title: "Long subject sheet",
              subject: "Religious education, philosophy and the history of ideas",
              yearGroup: "Year 10",
            },
          },
        ],
      },
    });
    expect(res.ok(), `seed failed: ${res.status()} ${await res.text()}`).toBe(true);
    await page.goto("/worksheets");
    const card = page.locator("article", {
      has: page.getByRole("link", { name: "Open Long subject sheet" }),
    });
    const meta = card.locator("[data-slot='card-meta']");
    await expect(meta).toBeVisible();
    const time = meta.locator("time");
    await expect(time).not.toHaveText("");
    const clipped = await time.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(clipped).toBe(false);
    const metaBox = await meta.boundingBox();
    const timeBox = await time.boundingBox();
    if (!metaBox || !timeBox) throw new Error("no meta boxes");
    expect(timeBox.x + timeBox.width).toBeLessThanOrEqual(metaBox.x + metaBox.width + 1);
    const subject = meta.locator("span.truncate");
    expect(await subject.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  });

  test("row 3: Print on a card opens the print route with ?auto=1 in a new tab", async ({
    signedInPage: { page, paths },
    context,
  }) => {
    await page.goto("/worksheets");
    const card = page.locator("article", {
      has: page.getByRole("link", { name: "Open Fractions practice" }),
    });
    await card.hover();
    const [printed] = await Promise.all([
      context.waitForEvent("page"),
      card.getByRole("button", { name: "Print" }).click(),
    ]);
    // The router re-serialises `auto=1` as `auto=%221%22` once the page mounts; both spell 1.
    await expect(printed).toHaveURL(
      new RegExp(`${paths.worksheet("fraction-practice", "/print")}\\?auto=(%22)?1(%22)?$`),
    );
    await expect(page).toHaveURL(/\/worksheets$/);
    await printed.close();
  });

  test("row 4: marks print only with the switch on; the header reads the minutes; the key is intact", async ({
    signedInPage: { page, paths },
  }) => {
    // River vocabulary leaves `showMarks` unset: off.
    await page.goto(paths.worksheet("river-vocabulary", "/print"));
    await expect(page.locator(".ws-print-root")).toHaveCSS("visibility", "visible");
    await expect(page.locator(".ws-print-root .ws-marks")).toHaveCount(0);
    await expect(page.locator(".ws-print-root .ws-header .ws-meta")).toHaveText(/^about \d+ min$/);
    // Fractions practice counts marks.
    await page.goto(paths.worksheet("fraction-practice", "/print"));
    await expect(page.locator(".ws-print-root")).toHaveCSS("visibility", "visible");
    expect(await page.locator(".ws-print-root .ws-marks").count()).toBeGreaterThan(0);
    await expect(page.locator(".ws-print-root .ws-header .ws-meta")).toHaveText(
      /^12 marks · about \d+ min$/,
    );
    // The editor: the Marks switch beside Answer key; off hides the labels and keeps the key.
    await page.goto(paths.worksheet("fraction-practice"));
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    // Select the header by its Name rule: a click on a field inside it is the field's, not the
    // row's, and with the criteria gone to the foot (TEACH-196) the header's centre is a field.
    await page.locator(".ws-column .ws-header").first().getByText("Name", { exact: true }).click();
    const marks = page.getByRole("switch", { name: "Marks" });
    await expect(marks).toBeVisible();
    await expect(marks).toHaveAttribute("aria-checked", "true");
    await marks.click();
    await expect(page.locator(".ws-column .ws-marks")).toHaveCount(0);
    await expect(page.locator(".ws-column .ws-header .ws-meta").first()).toHaveText(
      /^about \d+ min$/,
    );
    await page.getByRole("switch", { name: "Print answer key" }).click();
    await expect(page.locator(".ws-column .ws-key-entry").first()).toBeVisible();
    await expect(page.locator(".ws-column .ws-marks")).toHaveCount(0);
  });
});
