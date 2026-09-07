/**
 * The generating state on `/l/$lessonId` (ADR 0024 §18, TEACH-121): while a `lesson.plan` job
 * holds the row's lock the page shows the banner and no editor; once the lock is released the
 * editor takes over. The spec cancels the job itself before it starts and asserts the hand-over —
 * the "clears" half. The "shows" half seeds a lesson locked by a job that never ran, which stays
 * locked (no terminal event, not yet stale). The full run over the fake worker is
 * `generation.spec.ts` (TEACH-133).
 */
import type { LessonFacts } from "@tj/domain/documents";
import { demoWorkspace } from "@tj/editor/starter";
import { expectNoSeriousA11yViolations } from "./a11y";
import { E2E_API_URL, E2E_WEB_URL, expect, test } from "./fixtures";

test.use({ seed: false });

/** What Plan persists: the outline of the whole lesson, before the content slides exist. */
const OUTLINE_KINDS = ["title", "objectives", "content", "multiple-choice", "plenary"] as const;
const FACTS: LessonFacts = {
  objectives: [],
  vocabulary: [],
  workedExamples: [],
  questions: [],
  misconceptions: [],
  outline: OUTLINE_KINDS.map((kind, i) => ({ id: `s${i + 1}`, kind, minutes: 12, factRefs: [] })),
  durationMin: 60,
};

test.describe("generating lesson", () => {
  test("a locked lesson shows the read-only banner instead of the editor, with a skeleton per slide to come", async ({
    signedInPage: { page },
  }) => {
    const jobId = "01a06a15-1849-7000-ac6a-c07e27fe308b";
    const water = demoWorkspace(new Date()).find((d) => d.key === "demo-water-cycle");
    if (!water || !("slides" in water.body)) throw new Error("fixture missing");
    // Dated now, or `GET /documents/:id` would treat a never-queued lock as stale (ADR 0025 §24).
    // Three of the five outlined slides written: the rail shows two skeletons after them.
    const body = {
      ...water.body,
      slides: water.body.slides.slice(0, 3),
      facts: FACTS,
      updatedAt: new Date().toISOString(),
    };
    const res = await page.request.post(`${E2E_API_URL}/__test/seed-library`, {
      headers: { origin: E2E_WEB_URL },
      data: { documents: [{ ...water, body, generatingJobId: jobId }] },
    });
    expect(res.ok()).toBe(true);
    const { ids } = (await res.json()) as { ids: Record<string, string> };

    await page.goto(`/l/${ids["demo-water-cycle"]}`);
    const banner = page.getByTestId("generating-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Generating your lesson…");
    // Read-only: the slides render through the viewer, the editor chrome is absent.
    await expect(page.getByRole("button", { name: "Rename lesson" })).toHaveCount(0);
    await expect(page.locator("[data-slide-root]").first()).toBeVisible();
    await expect(page).toHaveTitle("The water cycle · Teaching Journey");

    const rail = page.getByRole("navigation", { name: "Slides" });
    await expect(rail.getByRole("button", { name: /^Slide \d+$/ })).toHaveCount(3);
    await expect(rail.locator('li[aria-hidden="true"]')).toHaveCount(2);
    await expect(page.getByText("3 of 5 slides")).toBeVisible();

    // The generating route is not in the a11y sweep (it needs a locked seed), so it is scanned
    // here in each theme.
    for (const theme of ["light", "dark", "high-contrast"] as const) {
      await page.addInitScript((value) => localStorage.setItem("tj-theme", value), theme);
      await page.reload();
      await expect(rail.locator('li[aria-hidden="true"]')).toHaveCount(2);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expectNoSeriousA11yViolations(page, `generating lesson (${theme})`);
    }
  });

  test("a lesson from a brief opens on its page and unlocks when the job ends", async ({
    signedInPage: { page },
  }) => {
    const res = await page.request.post(`${E2E_API_URL}/lessons`, {
      headers: { origin: E2E_WEB_URL },
      data: { brief: { topic: "Fractions of amounts" }, yearGroup: "Year 5" },
    });
    expect(res.status(), await res.text()).toBe(202);
    const { lessonId, jobId } = (await res.json()) as { lessonId: string; jobId: string };
    // End the job at once, before the fake worker picks it up (pg-boss polls every 0.5 s). The
    // terminal event releases the lock (`releaseStaleLock` on read, ADR 0025 §24) and the page
    // hands over — the transition this test is about. Should the worker win the race and write a
    // slide first, the page lands on the editor instead of the empty state; both are the unlock.
    const cancelled = await page.request.post(`${E2E_API_URL}/jobs/${jobId}/cancel`, {
      headers: { origin: E2E_WEB_URL },
    });
    expect(cancelled.status(), await cancelled.text()).toBe(202);

    await page.goto(`/l/${lessonId}`);
    await expect(page.getByRole("heading", { level: 1, name: "Fractions of amounts" })).toBeVisible(
      { timeout: 20_000 },
    );
    await expect(page.getByTestId("generating-banner")).toHaveCount(0);
    // Usually the job wrote no slide, so the page offers the first one; the editor mounts on it.
    const empty = page.getByRole("button", { name: "Add a title slide" });
    if (await empty.isVisible()) await empty.click();
    await expect(page.getByRole("button", { name: "Rename lesson" })).toBeVisible();
    await expect(
      page.getByRole("listbox", { name: "Slides" }).getByRole("option").first(),
    ).toBeVisible();
    // The library lists the new lesson from the api.
    await page.getByRole("button", { name: "Back to library" }).click();
    await expect(
      page.getByRole("link", { name: "Open Fractions of amounts" }).first(),
    ).toBeVisible();
  });
});
