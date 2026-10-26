import { describe, expect, test } from "bun:test";
import { ITEM_NAMES, LABEL_NAMES } from "@tj/domain/documents";
import { WA_NAMES } from "./practice";
import { QUICK_NAMES } from "./question-set";

/*
 * `@tj/domain`'s quality checks find a question list's task lines and the exit ticket's eyebrow by
 * element name, as literals (domain imports nothing internal). Renaming a template element here
 * would silently send the "asks nothing" check back to reading headings and labels as tasks
 * (TEACH-247 part ak), so the literals are pinned to the template constants.
 */
describe("quality-check element names match the templates", () => {
  test("practice and exit-ticket task lines and question-set questions are task lines", () => {
    expect(ITEM_NAMES.has(WA_NAMES.task)).toBe(true);
    expect(ITEM_NAMES.has(QUICK_NAMES.question)).toBe(true);
  });

  test("the practice and exit-ticket eyebrow is a label, not a task", () => {
    expect(LABEL_NAMES.has(WA_NAMES.kicker)).toBe(true);
    expect(ITEM_NAMES.has(WA_NAMES.kicker)).toBe(false);
  });
});
