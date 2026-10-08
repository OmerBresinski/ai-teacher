import type { Locator, Page } from "@playwright/test";
import type { Lesson } from "@tj/domain/documents";
import { generatedLesson } from "@tj/domain/documents/fixtures";
import { E2E_API_URL, E2E_WEB_URL, expect, type SeededPaths, test } from "./fixtures";

/*
 * In-place text editing on `/l/$lessonId` (TEACH-104) with a real caret, where happy-dom cannot
 * follow: typing then Escape commits one undo step (row 2), the toolbar's Bold acts on the
 * selection (row 4), and typing into an AI text makes it the teacher's. The other rows were cut to
 * keep e2e to the critical journeys (8 Oct 2026).
 */

const EDITOR = (paths: SeededPaths) => paths.lesson("demo-water-cycle");
const elements = (page: Page) => page.locator("[data-slide-frame] [data-element-id]");
const proseMirror = (page: Page) => page.locator("[data-slide-frame] .ProseMirror");
const stage = (page: Page) => page.locator("[data-selection-layer]");

/**
 * The element's box once it has settled. `toBeVisible` retries but `boundingBox()` does not, and on
 * a loaded CI runner the canvas is still being scaled (`SlideScaler` rewrites the scale after its
 * first layout) or the static `td-rt` is being remounted when the first read lands — so the box
 * is polled until two consecutive reads agree (TEACH-172).
 */
type Box = NonNullable<Awaited<ReturnType<Locator["boundingBox"]>>>;
const sameBox = (a: Box | null, b: Box | null) =>
  a !== null &&
  b !== null &&
  a.x === b.x &&
  a.y === b.y &&
  a.width === b.width &&
  a.height === b.height;

async function box(locator: Locator): Promise<Box> {
  await expect(locator).toBeVisible();
  const reads: (Box | null)[] = [];
  await expect
    .poll(
      async () => {
        reads.push(await locator.boundingBox());
        return (
          reads.length >= 2 &&
          sameBox(reads[reads.length - 1] ?? null, reads[reads.length - 2] ?? null)
        );
      },
      { message: "element box did not settle" },
    )
    .toBe(true);
  const last = reads[reads.length - 1];
  if (!last) throw new Error("not on screen");
  return last;
}

/**
 * Elements sit under the transform layer's pointer catcher, so Playwright's own `dblclick()` waits
 * forever for them to "receive" the event; double-click where the element is, as a hand does.
 */
async function dblclickAt(page: Page, target: Locator, opens: Locator = proseMirror(page)) {
  const b = await box(target);
  await page.mouse.dblclick(b.x + b.width / 2, b.y + b.height / 2);
  // The canvas can still move under the pointer between the two clicks on a slow runner; when the
  // editor `opens` did not appear, the box is re-read and the double-click made once more
  // (TEACH-172).
  const opened = await opens
    .waitFor({ state: "attached", timeout: 2_000 })
    .then(() => true)
    .catch(() => false);
  if (!opened) {
    const again = await box(target);
    await page.mouse.dblclick(again.x + again.width / 2, again.y + again.height / 2);
  }
}

test.describe("text editing", () => {
  test("row 2: typing then Escape commits as one undo step and hands focus back to the canvas", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(EDITOR(paths));
    const title = elements(page).filter({ hasText: "The water cycle" }).first();
    await dblclickAt(page, title);
    const pm = proseMirror(page);
    await expect(pm).toBeFocused();
    await page.keyboard.press("End");
    await page.keyboard.type(" abc");
    // Live: the canvas re-renders each keystroke, and the thumbnail follows.
    await expect(pm).toContainText("The water cycle abc");
    await expect(
      page.getByRole("listbox", { name: "Slides" }).getByRole("option").first(),
    ).toContainText("The water cycle abc");

    await page.keyboard.press("Escape");
    await expect(proseMirror(page)).toHaveCount(0);
    await expect(stage(page)).toBeFocused();
    await expect(title).toContainText("The water cycle abc");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 5_000 });

    const undo = page.getByRole("button", { name: "Undo" });
    await undo.click();
    await expect(title).not.toContainText("abc");
    await expect(undo).toBeDisabled();
  });

  test("row 4: with the editor open, the toolbar's Bold acts on the selection and lands in the doc", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(EDITOR(paths));
    const title = elements(page).filter({ hasText: "The water cycle" }).first();
    await dblclickAt(page, title);
    await expect(proseMirror(page)).toBeFocused();
    await page.keyboard.press("ControlOrMeta+a");
    const bold = page.getByRole("toolbar", { name: "Text" }).getByRole("button", { name: "Bold" });
    await bold.click();
    await expect(bold).toHaveAttribute("aria-pressed", "true");
    await expect(proseMirror(page).locator("strong")).toContainText("The water cycle");
    await page.keyboard.press("Escape");
    await expect(title.locator("strong")).toContainText("The water cycle");
  });
});

/*
 * TEACH-74 (topic graph PRD §5.6, TG-12): the first teacher edit of an AI-authored text keeps the
 * AI's words in the saved document. Seeds `generatedLesson()` (provenance on every element), so
 * `test.use({ seed: false })` and no demo library.
 */
test.describe("first teacher edit keeps the original AI text (TEACH-74)", () => {
  test.use({ seed: false });

  test("typing into an ai text flips it to teacher and saves generatedFrom.originalText", async ({
    signedInPage: { page },
  }) => {
    const seeded = await page.request.post(`${E2E_API_URL}/__test/seed-library`, {
      headers: { origin: E2E_WEB_URL },
      data: {
        documents: [
          {
            key: "lesson",
            kind: "lesson",
            body: { ...generatedLesson(), updatedAt: new Date().toISOString() },
          },
        ],
      },
    });
    expect(seeded.ok(), await seeded.text()).toBe(true);
    const lessonId = ((await seeded.json()) as { ids: Record<string, string> }).ids.lesson ?? "";
    expect(lessonId).toBeTruthy();

    await page.goto(`/l/${lessonId}`);
    // The fixture's title and subtitle share one rect; the subtitle (`t2`) is drawn last, so it
    // is the box a double-click lands on.
    const subtitle = page.locator('[data-slide-frame] [data-element-id="t2"]');
    await expect(subtitle).toContainText("Year 4 · Science");
    await dblclickAt(page, subtitle);
    const pm = proseMirror(page);
    await expect(pm).toBeFocused();
    await page.keyboard.press("End");
    await page.keyboard.type(" and rain");
    await page.keyboard.press("Escape");
    await expect(subtitle).toContainText("Year 4 · Science and rain");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 5_000 });

    const saved = await page.request.get(`${E2E_API_URL}/documents/${lessonId}`, {
      headers: { origin: E2E_WEB_URL },
    });
    expect(saved.ok(), await saved.text()).toBe(true);
    const lesson = ((await saved.json()) as { document: { body: Lesson } }).document.body;
    const byId = (id: string) => lesson.slides[0]?.elements.find((e) => e.id === id);
    const edited = byId("t2");
    expect(edited?.authoredBy).toBe("teacher");
    expect(edited?.generatedFrom?.originalText).toBe("Year 4 · Science");
    expect(edited?.generatedFrom?.factRefs).toEqual([]);
    // The title the teacher never touched is still the AI's, with nothing recorded.
    const untouched = byId("t1");
    expect(untouched?.authoredBy).toBe("ai");
    expect(untouched?.generatedFrom?.originalText).toBeUndefined();
  });
});
