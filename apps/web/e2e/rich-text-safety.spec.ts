import { generatedLesson } from "@tj/domain/documents/fixtures";
import { expect, test } from "./fixtures";

/**
 * TEACH-277 (audit F01): stored XSS through rich-text links.
 *
 * 1. Import: a Lesson file whose text carries a link mark with `href: "javascript:…"` is refused by
 *    the parser in the browser (no POST reaches the API) and the teacher sees the failure toast.
 * 2. Rendering: a Document that already holds such a link (stored before the schema was closed) is
 *    simulated by rewriting the `GET /documents/:id` response. View and present render the text
 *    with no anchor; clicking it runs nothing and navigates nowhere.
 */

const MARKER = "auditXss";
const PAYLOAD = `javascript:void(document.body.dataset.${MARKER}=String(1))`;

/** The demo lesson with its first text element replaced by the poisoned link. */
function poisonedLesson() {
  const lesson = generatedLesson();
  const slide = lesson.slides[0];
  if (!slide) throw new Error("fixture has no slides");
  const text = slide.elements.find((el) => el.type === "text");
  if (text?.type !== "text") throw new Error("fixture has no text element");
  text.doc = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "AUDIT LINK",
            marks: [{ type: "link", attrs: { href: PAYLOAD, target: "_self" } }],
          },
        ],
      },
    ],
  };
  return lesson;
}

test.describe("rich-text link safety (TEACH-277)", () => {
  test("Import refuses a lesson with a javascript: link before any request is sent", async ({
    signedInPage: { page },
  }) => {
    const posts: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && /\/documents$/.test(new URL(request.url()).pathname)) {
        posts.push(request.url());
      }
    });
    await page.goto("/lessons");
    await page.getByRole("button", { name: "Import" }).click();
    const dialog = page.getByRole("dialog", { name: "Import" });
    await dialog.getByLabel("Import files").setInputFiles({
      name: "poisoned.teachdeck.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(poisonedLesson())),
    });
    await expect(page.getByText(/Could not import “poisoned\.teachdeck\.json”/)).toBeVisible();
    expect(posts).toHaveLength(0);
    await expect(page.locator("article").filter({ hasText: "AUDIT LINK" })).toHaveCount(0);
  });

  test("a stored javascript: link renders as plain text in view and present", async ({
    signedInPage: { page, paths },
  }) => {
    // Simulate legacy stored content: the API answer is rewritten on the way to the renderer.
    const lessonId = paths.id("demo-water-cycle");
    await page.route(`**/documents/${lessonId}`, async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const response = await route.fetch();
      const json = (await response.json()) as {
        document: { body: ReturnType<typeof generatedLesson> };
      };
      const body = json.document.body;
      const slide = body.slides[0];
      const text = slide?.elements.find((el) => el.type === "text");
      if (text && text.type === "text") {
        text.doc = {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "AUDIT LINK",
                  marks: [{ type: "link", attrs: { href: PAYLOAD, target: "_self" } }],
                },
              ],
            },
          ],
        };
      }
      await route.fulfill({ response, json });
    });

    for (const mode of ["/view", "/present"] as const) {
      await page.goto(paths.lesson("demo-water-cycle", mode));
      const text = page.getByText("AUDIT LINK").first();
      await expect(text).toBeVisible();
      // No anchor at all, let alone one with an executable address.
      await expect(page.locator(`a[href^="javascript" i]`)).toHaveCount(0);
      await expect(page.locator(".td-rt a", { hasText: "AUDIT LINK" })).toHaveCount(0);
      const before = page.url();
      await text.click({ force: true });
      await page.waitForTimeout(150);
      expect(await page.evaluate((m) => document.body.dataset[m], MARKER)).toBeUndefined();
      expect(page.url()).toBe(before);
      if (process.env.TEACH_SCREENSHOTS === "1") {
        await page.screenshot({ path: `/tmp/teach-277-${mode.slice(1)}.png` });
      }
    }
  });
});
