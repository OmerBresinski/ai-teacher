/**
 * axe-core helper (F18-R09, ADR 0014): every visited page must have zero `serious`/`critical`
 * violations. `moderate` and `minor` findings are printed so they stay visible without blocking.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export const BLOCKING_IMPACTS = new Set(["serious", "critical"]);

interface Violation {
  id: string;
  impact?: string | null;
  help: string;
  helpUrl: string;
  nodes: { target: unknown[] }[];
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
 * Scan `page` with axe. Fails the test on serious/critical violations; logs the rest to the
 * console with the page `label` so they can be tracked down in the report.
 */
export async function expectNoSeriousA11yViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  const violations = results.violations as Violation[];
  const blocking = violations.filter((v) => BLOCKING_IMPACTS.has(v.impact ?? ""));
  const advisory = violations.filter((v) => !BLOCKING_IMPACTS.has(v.impact ?? ""));
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
