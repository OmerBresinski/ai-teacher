/**
 * Plan review prototype screenshots (`proto/plan-review`). Opt-in:
 * `TEACH_SCREENSHOTS=1 … e2e/plan-review-screenshots.spec.ts`. Seeds `plannedLesson()` — facts,
 * `generation.stage: "planned"`, no lock — so `/l/:id` renders the one-screen overview, and saves
 * it at rest, with a phase's minutes open, with two sections "yours", and the generating view after
 * Generate. axe runs at rest and with the detail open. Light theme, 1440×1000.
 */
import { plannedLesson } from "@tj/domain/documents/fixtures";
import { expectNoSeriousA11yViolations } from "./a11y";
import { E2E_API_URL, E2E_WEB_URL, expect, test } from "./fixtures";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");
test.use({ viewport: { width: 1440, height: 1000 }, seed: false });

test("captures the overview, an open phase, two sections yours and the handoff", async ({
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
  await expect(
    page.getByRole("heading", { level: 1, name: "States of matter, 60 minutes for Year 7" }),
  ).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "of 60 minutes" })).toHaveText(
    "60 of 60 minutes",
  );
  await expect(page.locator("section[data-section] [data-slot=status-pill]")).toHaveText([
    "Suggested",
    "Suggested",
    "Suggested",
    "Suggested",
  ]);
  await page.waitForTimeout(800);
  await page.screenshot({ path: "/tmp/plan-review-1-overview.png" });
  await expectNoSeriousA11yViolations(page, "plan review: overview");

  // Enter on a focused block opens its minutes; the stepper takes focus.
  // By id, not name: the name carries the minutes, which the test changes.
  const starter = page.locator("[data-phase-id=s3]");
  await expect(starter).toHaveAccessibleName(/^Starter, 5 minutes/);
  await starter.focus();
  await page.keyboard.press("Enter");
  const stepper = page.getByRole("spinbutton", { name: "Minutes for Starter" });
  await expect(stepper).toBeFocused();
  await expect(starter).toHaveAttribute("aria-expanded", "true");
  await page.waitForTimeout(500);
  await page.screenshot({ path: "/tmp/plan-review-2-phase-open.png" });
  await expectNoSeriousA11yViolations(page, "plan review: phase open");

  // Retime it: the strip's block grows, the total warns, Shape reads "yours".
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("status").filter({ hasText: "of 60 minutes" })).toHaveText(
    "62 of 60 minutes, 2 over",
  );
  await expect(page.getByRole("button", { name: /^Starter, 7 minutes/ })).toBeVisible();
  // Escape closes the detail and returns focus to the block.
  await page.keyboard.press("Escape");
  await expect(starter).toBeFocused();
  await expect(starter).toHaveAttribute("aria-expanded", "false");
  // Alt+ArrowRight moves the block along the strip.
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.getByRole("button", { name: /^Starter, 7 minutes, phase 4/ })).toBeVisible();

  // An objective edit: two sections are now yours.
  const objective = page.getByRole("textbox", { name: "Objective 2" });
  await objective.fill("Explain melting, boiling, condensing and freezing using particles");
  await expect(page.getByTestId("yours-count")).toHaveText(
    "2 sections are yours: Objectives and Shape.",
  );
  await expect(page.locator("section[data-section] [data-slot=status-pill]")).toHaveText([
    "Yours",
    "Yours",
    "Suggested",
    "Suggested",
  ]);
  // Words and worksheet: a chip goes, a word comes, a tier goes.
  await page.getByRole("button", { name: "Remove Condensing" }).click();
  await page.getByRole("textbox", { name: "Add a word" }).fill("Freezing");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("list", { name: "Words" })).toContainText("Freezing");
  await page.getByRole("button", { name: "Support" }).click();
  await expect(page.getByTestId("yours-count")).toContainText("4 sections are yours");
  await page.waitForTimeout(500);
  await page.screenshot({ path: "/tmp/plan-review-3-yours.png" });
  await expectNoSeriousA11yViolations(page, "plan review: yours");

  // Cmd+Enter generates: the generating view with the confirmed outline's skeletons.
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByTestId("generating-banner")).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: "/tmp/plan-review-4-generating.png" });
});
