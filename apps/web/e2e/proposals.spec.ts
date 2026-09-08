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

test.describe("facts panel and proposals", () => {
  test("editing an objective cascades to the slides that use it; one toast, one undo", async ({
    signedInPage: { page },
  }) => {
    const lessonId = await seedGenerated(page);
    await page.goto(`/l/${lessonId}`);
    await expect(page.getByRole("heading", { level: 1, name: "The water cycle" })).toBeVisible();
    await page.getByRole("button", { name: "Facts" }).click();
    const panel = page.getByRole("complementary", { name: "Facts" });
    await expect(panel).toBeVisible();

    const objective = panel.getByRole("textbox", { name: "Objective 1" });
    await objective.fill("Describe the water cycle in order");
    await objective.press("Enter");

    // The cascade lands. Slides 2 and 4 derive from o1; the fixture objectives recipe has no
    // element in the position of the seeded one, so the worker skips that target (logged) and the
    // question slide — a whole-slide proposal — is what changes, plus a block on the linked worksheet.
    const toast = page.getByText("Auto changed on slide 4 and the worksheet to match");
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
