/**
 * Plan review prototype screenshots (`proto/plan-review`). Opt-in:
 * `TEACH_SCREENSHOTS=1 … e2e/plan-review-screenshots.spec.ts`. Seeds `plannedLesson()` — facts,
 * `generation.stage: "planned"`, no lock — so `/l/:id` renders the review, walks the five steps,
 * saves one PNG per step plus the "yours" state, and runs axe on each step. Light theme, 1440×1000.
 */
import { plannedLesson } from "@tj/domain/documents/fixtures";
import { expectNoSeriousA11yViolations } from "./a11y";
import { E2E_API_URL, E2E_WEB_URL, expect, test } from "./fixtures";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");
test.use({ viewport: { width: 1440, height: 1000 }, seed: false });

test("captures every plan review step, the edited state and the handoff", async ({
  signedInPage: { page },
}) => {
  await page.addInitScript(() => window.localStorage.setItem("tj-theme", "light"));
  const res = await page.request.post(`${E2E_API_URL}/__test/seed-library`, {
    headers: { origin: E2E_WEB_URL },
    data: {
      documents: [
        {
          key: "planned",
          kind: "lesson",
          body: { ...plannedLesson(), updatedAt: new Date().toISOString() },
        },
      ],
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
  const { ids } = (await res.json()) as { ids: Record<string, string> };
  const lessonId = ids.planned;
  if (!lessonId) throw new Error("seed");

  await page.goto(`/l/${lessonId}`);
  const review = page.getByTestId("plan-review");
  await expect(review).toBeVisible();
  const rail = page.getByRole("navigation", { name: "Plan review steps" });
  await expect(rail).toContainText("1 of 5");
  await expect(page.getByRole("textbox", { name: "Objective 1, suggested" })).toBeFocused();
  await page.waitForTimeout(600);
  await page.screenshot({ path: "/tmp/plan-review-1-objectives.png" });
  await expectNoSeriousA11yViolations(page);

  // A teacher's edit: the row turns "yours".
  const objective = page.getByRole("textbox", { name: "Objective 2, suggested" });
  await objective.fill("Explain melting, boiling, condensing and freezing using particles");
  await expect(page.getByRole("textbox", { name: "Objective 2, yours" })).toBeVisible();
  await page.screenshot({ path: "/tmp/plan-review-1-objectives-yours.png" });

  // Enter accepts and advances; focus lands on the first control.
  await page.keyboard.press("Enter");
  await expect(rail).toContainText("2 of 5");
  await expect(page.getByRole("textbox", { name: "Title summary, suggested" })).toBeFocused();
  await page.waitForTimeout(600);
  await page.screenshot({ path: "/tmp/plan-review-2-shape.png" });
  await expectNoSeriousA11yViolations(page);
  // Retime a phase: the running total warns against the brief's 60 minutes.
  await page.getByRole("button", { name: "More minutes: Minutes for Starter" }).click();
  await expect(page.getByRole("status").filter({ hasText: "of 60 minutes" })).toContainText(
    "61 of 60 minutes: 1 over",
  );
  // Keyboard reorder: Alt+ArrowDown on the starter's handle moves it below the vocabulary slide.
  await page.getByRole("button", { name: /^Move Starter/ }).focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect(page.getByRole("button", { name: /^Move Starter, phase 4/ })).toBeVisible();
  await page.screenshot({ path: "/tmp/plan-review-2-shape-yours.png" });

  await page.getByRole("button", { name: "Continue" }).click();
  await expect(rail).toContainText("3 of 5");
  await expect(page.getByRole("textbox", { name: "Term 1, suggested" })).toBeFocused();
  await page.waitForTimeout(600);
  await page.screenshot({ path: "/tmp/plan-review-3-words.png" });
  await expectNoSeriousA11yViolations(page);

  await page.keyboard.press("Enter");
  await expect(rail).toContainText("4 of 5");
  await expect(page.getByRole("switch")).toBeFocused();
  await page.waitForTimeout(600);
  await page.screenshot({ path: "/tmp/plan-review-4-worksheet.png" });
  await expectNoSeriousA11yViolations(page);
  await page.getByRole("button", { name: "Support" }).click();
  await expect(page.getByRole("button", { name: "Support" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  // Escape steps back; Continue twice reaches the summary.
  await page.keyboard.press("Escape");
  await expect(rail).toContainText("3 of 5");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(rail).toContainText("5 of 5");
  await expect(page.getByRole("button", { name: "Generate" })).toBeFocused();
  await expect(review).toContainText("changes are yours");
  await page.waitForTimeout(600);
  await page.screenshot({ path: "/tmp/plan-review-5-summary.png" });
  await expectNoSeriousA11yViolations(page);

  // Generate hands the page to the generating view with the confirmed outline's skeletons.
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("generating-banner")).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: "/tmp/plan-review-6-generating.png" });
});
