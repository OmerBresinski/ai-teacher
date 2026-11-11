import { describe, expect, test } from "bun:test";
import { GRID_NAMES } from "../templates/cards-grid";
import { FIGURE_NAMES } from "../templates/figure";
import { HINGE_NAMES } from "../templates/hinge";
import { ROW_NAMES } from "../templates/items-row";
import { PANEL_NAMES } from "../templates/panel-list";
import { PT_NAMES } from "../templates/picture-text";
import { WA_NAMES } from "../templates/practice";
import { QUICK_NAMES } from "../templates/question-set";
import { REASON_NAMES } from "../templates/reasons";
import { STAGES_NAMES } from "../templates/stages";
import { WORKED_NAMES } from "../templates/worked";
import { DIGEST_NAMES } from "./digest";

/*
 * The digest finds a slide's content by the element names the templates own. A rename there would
 * empty the digest without an error (plan v2 §8 risk 3), so each name is pinned to its template's
 * constant here.
 */
describe("the digest's element names match the templates", () => {
  const pairs = DIGEST_NAMES.pairs.map((p) => [p.name, p.meaning]);

  test("name and meaning pairs", () => {
    expect(pairs).toContainEqual([PANEL_NAMES.name, PANEL_NAMES.line]);
    expect(pairs).toContainEqual([ROW_NAMES.name, ROW_NAMES.text]);
    expect(pairs).toContainEqual([STAGES_NAMES.name, STAGES_NAMES.line]);
    expect(pairs).toContainEqual([REASON_NAMES.head, REASON_NAMES.text]);
    expect(pairs).toContainEqual([PT_NAMES.term, PT_NAMES.meaning]);
    expect(pairs).toContainEqual([GRID_NAMES.label, GRID_NAMES.body]);
  });

  test("headings, multiple choice, tasks and worked rows", () => {
    expect(DIGEST_NAMES.heading).toContain(PT_NAMES.title);
    expect(DIGEST_NAMES.heading).toContain(FIGURE_NAMES.title);
    expect(DIGEST_NAMES.heading).toContain(PANEL_NAMES.title);
    expect(DIGEST_NAMES.headingFallback).toContain(REASON_NAMES.question);
    expect(DIGEST_NAMES.option).toBe(HINGE_NAMES.card);
    expect(DIGEST_NAMES.optionText).toBe(HINGE_NAMES.text);
    expect(DIGEST_NAMES.tasks).toContain(WA_NAMES.task);
    expect(DIGEST_NAMES.tasks).toContain(QUICK_NAMES.question);
    expect(DIGEST_NAMES.labels).toContain(WA_NAMES.kicker);
    expect(DIGEST_NAMES.labels).toContain(PT_NAMES.label);
    expect(DIGEST_NAMES.labels).toContain(WORKED_NAMES.checkLabel);
    expect(DIGEST_NAMES.labels).toContain(ROW_NAMES.badge);
    expect(DIGEST_NAMES.labels).toContain(ROW_NAMES.numeral);
    expect([DIGEST_NAMES.eqLeft, DIGEST_NAMES.eqSign, DIGEST_NAMES.eqRight]).toEqual([
      WORKED_NAMES.left,
      WORKED_NAMES.sign,
      WORKED_NAMES.right,
    ]);
    expect(DIGEST_NAMES.move).toBe(WORKED_NAMES.move);
  });
});
