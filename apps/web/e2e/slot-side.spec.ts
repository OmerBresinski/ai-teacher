/**
 * R2 (TEACH-19): a teaching slide's photo takes a side of the words from its toolbar
 * ("Picture: Left | Right") or by being dragged across the slide's midline, each one undo step.
 * Real pointer events on the editor canvas.
 */

import type { Page } from "@playwright/test";
import type { Lesson } from "@tj/domain/documents";
import { materialiseSlide, materialiseSlides, newLesson } from "@tj/editor/starter";
import { E2E_API_URL, E2E_WEB_URL, expect, test } from "./fixtures";

const META = { promptVersion: "e2e", model: "fixture", at: "2026-09-27T12:00:00.000Z" };

function demo(): Lesson {
  const base: Lesson = { ...newLesson("PR 1 demo: slots", "chalk"), id: "slot-side-e2e" };
  const plain = materialiseSlide(
    { kind: "content", heading: "Where Rome was", body: "Rome was a city in Italy.", factRefs: [] },
    "chalk",
    META,
  );
  const [slot] = materialiseSlides(
    {
      kind: "content",
      heading: "Why did Rome invade?",
      body: "Rome wanted Britain for its metals, grain and slaves. Tin and silver paid for soldiers.",
      factRefs: [],
    },
    "chalk",
    META,
    undefined,
    0,
    { photo: { subject: "Roman legionaries landing on a beach", mustShow: ["shields"] } },
  );
  if (!slot) throw new Error("no slot slide");
  base.slides = [base.slides[0] ?? plain, plain, slot];
  return base;
}

/** The photo's box on screen, and which half of the slide its centre is in. */
async function photo(page: Page) {
  const stage = await page.locator('[data-slide-mode="edit"]').first().boundingBox();
  const box = await page
    .locator('[data-slide-mode="edit"] [data-element-type="image"]')
    .first()
    .boundingBox();
  if (!stage || !box) throw new Error("no photo on the canvas");
  const side = box.x + box.width / 2 < stage.x + stage.width / 2 ? "left" : "right";
  return { stage, box, side };
}

test("the picture takes a side from its toolbar and by a drag across, each one undo step", async ({
  signedInPage: { page },
}) => {
  const res = await page.request.post(`${E2E_API_URL}/__test/seed-library`, {
    headers: { origin: E2E_WEB_URL },
    data: { documents: [{ key: "demo", kind: "lesson", body: demo() }] },
  });
  expect(res.ok(), `seed failed: ${res.status()} ${await res.text()}`).toBe(true);
  const { ids } = (await res.json()) as { ids: Record<string, string> };

  await page.goto(`/l/${ids.demo}`);
  await page.getByRole("listbox", { name: "Slides" }).getByRole("option").nth(2).click();
  await expect(page.locator('[data-slide-mode="edit"] [data-element-type="image"]')).toBeVisible();
  expect((await photo(page)).side).toBe("left");
  // No swap button on the slide toolbar any more.
  await expect(page.getByRole("button", { name: "Swap picture side" })).toHaveCount(0);

  // Select the photo: its toolbar says Picture: Left | Right. Right moves it; undo brings it back.
  let { box } = await photo(page);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const sides = page.getByRole("radiogroup", { name: "Picture side" });
  await expect(sides).toBeVisible();
  await sides.getByRole("radio", { name: "Right" }).click();
  await expect.poll(async () => (await photo(page)).side).toBe("right");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await photo(page)).side).toBe("left");

  // Drag it over the words past the midline: it swaps on drop. Undo brings it back.
  await page.keyboard.press("Escape");
  const at = await photo(page);
  box = at.box;
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const to = { x: at.stage.x + at.stage.width * 0.75, y: from.y + 20 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let k = 1; k <= 12; k++)
    await page.mouse.move(from.x + ((to.x - from.x) * k) / 12, from.y + ((to.y - from.y) * k) / 12);
  await page.mouse.up();
  await expect.poll(async () => (await photo(page)).side).toBe("right");
  // The swap, not the drag: the photo sits level with where it was.
  expect(Math.abs((await photo(page)).box.y - box.y)).toBeLessThan(2);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await photo(page)).side).toBe("left");
});
