/**
 * TEACH-134 on the fake worker (`AI_FAKE_SCRIPT=pipeline` answers cascade/regenerate calls with a
 * marked fixture spec, ADR 0025 §18): editing a fact in the facts panel cascades to the slides
 * that derive from it and lands as one undo step with the toast; regenerating a slide with an
 * instruction posts once and lands with its toast. The seed is `generatedLesson()` — facts,
 * provenance on every element, a linked worksheet — so the impact set is known.
 */

import type { Page } from "@playwright/test";
import { generatedLesson, generatedWorksheet } from "@tj/domain/documents/fixtures";
import { E2E_API_URL, E2E_WEB_URL, expect, test } from "./fixtures";

test.use({ seed: false });

/** Seeds the worksheet first so the lesson's `artefacts.worksheetId` can point at its minted uuid. */
async function seedGenerated(page: Page): Promise<string> {
  const now = new Date().toISOString();
  const seed = async (documents: unknown[]) => {
    const res = await page.request.post(`${E2E_API_URL}/__test/seed-library`, {
      headers: { origin: E2E_WEB_URL },
      data: { documents },
    });
    expect(res.ok(), await res.text()).toBe(true);
    return ((await res.json()) as { ids: Record<string, string> }).ids;
  };
  const { worksheet } = await seed([
    { key: "worksheet", kind: "worksheet", body: { ...generatedWorksheet(), updatedAt: now } },
  ]);
  if (!worksheet) throw new Error("seed returned no worksheet id");
  const { lesson } = await seed([
    {
      key: "lesson",
      kind: "lesson",
      body: { ...generatedLesson(), updatedAt: now, artefacts: { worksheetId: worksheet } },
    },
  ]);
  if (!lesson) throw new Error("seed returned no lesson id");
  return lesson;
}

const frameOf = (page: Page) => page.locator("[data-slide-frame]").first();
async function settledFrame(page: Page) {
  let last = await frameOf(page).boundingBox();
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(100);
    const next = await frameOf(page).boundingBox();
    if (last && next && Math.abs(next.x - last.x) < 0.5 && Math.abs(next.width - last.width) < 0.5)
      return next;
    last = next;
  }
  if (!last) throw new Error("no slide");
  return last;
}

test.describe("facts panel and proposals", () => {
  // Layout A (rulings 186, 187): Facts shares the right pane slot with the chat.
  test("Facts opens in the pane slot in place of the chat and never moves the slide", async ({
    signedInPage: { page },
  }) => {
    await page.addInitScript(() => localStorage.setItem("dayback.edit-pane.open", "1"));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/l/${await seedGenerated(page)}`);
    await expect(page.getByRole("complementary", { name: "Edit with Dayback" })).toBeVisible();
    const before = await settledFrame(page);
    await page.getByRole("button", { name: "More lesson actions" }).click();
    await page.getByRole("button", { name: "Facts" }).click();
    const facts = page.getByRole("complementary", { name: "Facts" });
    await expect(facts).toBeVisible();
    await expect(facts).toHaveAttribute("data-side-pane", "docked");
    // One pane in the slot: the chat closed.
    await expect(page.getByRole("complementary", { name: "Edit with Dayback" })).toBeHidden();
    const after = await settledFrame(page);
    const factsBox = await facts.boundingBox();
    if (!factsBox) throw new Error("no facts");
    expect(after.width).toBeCloseTo(before.width, 0);
    expect(after.x).toBeCloseTo(before.x, 0);
    expect(after.x + after.width).toBeLessThanOrEqual(factsBox.x + 0.5);
  });

  test("editing an objective cascades to the slides that use it; one toast, one undo", async ({
    signedInPage: { page },
  }) => {
    const lessonId = await seedGenerated(page);
    await page.goto(`/l/${lessonId}`);
    await expect(page.getByRole("heading", { level: 1, name: "The water cycle" })).toBeVisible();
    await page.getByRole("button", { name: "More lesson actions" }).click();
    await page.getByRole("button", { name: "Facts" }).click();
    const panel = page.getByRole("complementary", { name: "Facts" });
    await expect(panel).toBeVisible();

    const objective = panel.getByRole("textbox", { name: "Objective 1" });
    await objective.fill("Describe the water cycle in order");
    await objective.press("Enter");

    // The cascade lands. Slides 2 and 4 derive from o1: the objectives slide's fields are read back
    // as spec fields (TEACH-19), so both change, plus a block on the linked worksheet.
    const toast = page.getByText("Auto changed on slides 2 and 4 and the worksheet to match");
    await expect(toast).toBeVisible({ timeout: 20_000 });
    const rail = page.getByRole("listbox", { name: "Slides" });
    const question = rail.getByRole("option").nth(3);
    await expect(question).toContainText("Updated to match");
    // Toast Undo: the cascade goes, the typed fact stays.
    await page.getByRole("button", { name: "Undo" }).last().click();
    await expect(question).toContainText("Which process turns liquid water into vapour?");
    await expect(question).not.toContainText("Updated to match");
    await expect(objective).toHaveValue("Describe the water cycle in order");
  });

  test("regenerate slide 3 with an instruction posts once and lands with its toast", async ({
    signedInPage: { page },
  }) => {
    const lessonId = await seedGenerated(page);
    await page.goto(`/l/${lessonId}`);
    await expect(page.getByRole("heading", { level: 1, name: "The water cycle" })).toBeVisible();
    const rail = page.getByRole("listbox", { name: "Slides" });
    await rail.getByRole("option").nth(2).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Regenerate slide…" }).click();
    const dialog = page.getByRole("dialog", { name: "Regenerate slide 3" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Also changes:");
    await dialog.getByRole("textbox", { name: "Instruction (optional)" }).fill("Simpler words");
    const posted = page.waitForRequest(
      (request) => request.method() === "POST" && request.url().endsWith("/regenerate"),
    );
    await dialog.getByRole("button", { name: "Regenerate" }).click();
    const request = await posted;
    expect(request.postDataJSON()).toEqual({
      targets: [{ slideId: "s-vocab" }],
      instruction: "Simpler words",
    });
    await expect(rail.getByRole("option").nth(2).locator("[data-slide-busy]")).toBeVisible();
    await expect(page.getByText("Regenerated slide 3")).toBeVisible({ timeout: 20_000 });
    // The fixture vocabulary slide replaced the seeded one (its entries carry no free text to mark).
    await expect(rail.getByRole("option").nth(2)).toContainText("Particle");
    await expect(rail.getByRole("option").nth(2)).not.toContainText("Evaporation");
  });
});
