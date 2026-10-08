/**
 * axe-core helper (F18-R09, ADR 0014): every visited page must have zero `serious`/`critical`
 * violations. `moderate` and `minor` findings are printed so they stay visible without blocking.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export const BLOCKING_IMPACTS = new Set(["serious", "critical"]);

/**
 * The axe rules a theme can change. The app theme only swaps colours (`data-theme` on `<html>`),
 * so structure is scanned once in the light theme and dark and high contrast run these alone.
 */
export const COLOUR_RULES = ["color-contrast", "link-in-text-block"] as const;

interface Violation {
  id: string;
  impact?: string | null;
  help: string;
  helpUrl: string;
  nodes: { target: unknown[]; html: string }[];
}

export function formatViolations(violations: Violation[]): string {
  return violations
    .map((v) => {
      const targets = v.nodes
        .slice(0, 3)
        .map((n) => n.target.join(" "))
        .join(", ");
      return `- [${v.impact ?? "unknown"}] ${v.id}: ${v.help} (${v.nodes.length} node(s): ${targets}) ${v.helpUrl}`;
    })
    .join("\n");
}

/**
 * ADR 0019 §4 (amended 2026-09-06): filled primary controls carry `data-primary-fill` and use
 * TeachDeck's white-on-terracotta (3.71:1) by decision. Their `color-contrast` findings are logged,
 * not failed. Any other element or rule still blocks.
 */
function isRecordedContrastException(violation: Violation): boolean {
  return (
    violation.id === "color-contrast" &&
    violation.nodes.every((node) => node.html.includes("data-primary-fill"))
  );
}

/**
 * Scan `page` with axe. Fails the test on serious/critical violations; logs the rest to the
 * console with the page `label` so they can be tracked down in the report. With `rules`, only
 * those rules run (`COLOUR_RULES` for the dark and high-contrast passes).
 */
export async function expectNoSeriousA11yViolations(
  page: Page,
  label: string,
  selector?: string,
  options: { rules?: readonly string[] } = {},
): Promise<void> {
  const builder = new AxeBuilder({ page });
  if (options.rules) builder.withRules([...options.rules]);
  else builder.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]);
  if (selector) builder.include(selector);
  const results = await builder.analyze();
  const violations = results.violations as Violation[];
  const blocking = violations.filter(
    (v) => BLOCKING_IMPACTS.has(v.impact ?? "") && !isRecordedContrastException(v),
  );
  const advisory = violations.filter((v) => !blocking.includes(v));
  if (advisory.length > 0) {
    console.log(
      `axe (${label}): ${advisory.length} non-blocking finding(s)\n${formatViolations(advisory)}`,
    );
  }
  expect(
    blocking,
    `axe (${label}): ${blocking.length} serious/critical violation(s)\n${formatViolations(blocking)}`,
  ).toEqual([]);
}

/**
 * Waits for the animations under the last open dialog or menu (or under `selector`; `"html"` for
 * the whole page) to finish: axe reads contrast through a fade, so it scans after the motion, not
 * after a fixed delay. A finished fade can start another (a staggered entrance), so it looks again
 * until none is left, a few rounds at most. Infinite animations (spinners, idle loops) are left
 * out, since they never finish.
 */
export async function settled(page: Page, selector = '[role="dialog"], [role="menu"]') {
  await page
    .locator(selector)
    .last()
    .evaluate(async (el) => {
      for (let round = 0; round < 5; round++) {
        const running = el
          .getAnimations({ subtree: true })
          .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
          .filter((animation) => animation.playState !== "finished");
        if (running.length === 0) return;
        await Promise.all(running.map((animation) => animation.finished.catch(() => undefined)));
        await new Promise(requestAnimationFrame);
      }
    });
}

export type AppTheme = "light" | "dark" | "high-contrast";

/**
 * Switch the open page to `theme` without a reload, the way another tab would: store it, set
 * `data-theme` and send the `storage` event the theme provider mirrors. Then wait for the colour
 * transitions to finish, so the next scan reads the final colours.
 */
export async function switchTheme(page: Page, theme: AppTheme): Promise<void> {
  await page.evaluate((value) => {
    localStorage.setItem("tj-theme", value);
    document.documentElement.setAttribute("data-theme", value);
    window.dispatchEvent(new StorageEvent("storage", { key: "tj-theme", newValue: value }));
  }, theme);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await settled(page, "html");
}
