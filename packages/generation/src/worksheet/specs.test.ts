import { describe, expect, test } from "bun:test";
import { isEditorialIssue } from "@tj/slides";
import { assignFactIds } from "../specs";
import { FIXTURES } from "../testing";
import { worksheetFillSchemaFor } from "./specs";

describe("worksheetFillSchemaFor (ADR 0030 item 3)", () => {
  const facts = assignFactIds(FIXTURES.planSkeleton, FIXTURES.planFacts, 60);
  const fillSlots = [
    { index: 3, allowedTypes: ["multiple-choice" as const], count: [1, 3] as [number, number] },
  ];
  const context = { fillSlots, facts, practised: ["o1", "o2"] };
  const strict = worksheetFillSchemaFor(context);
  const soft = worksheetFillSchemaFor(context, { soft: true });
  const blocks = FIXTURES.worksheetFill.slots[0]?.blocks ?? [];
  const issuesOf = (value: unknown) =>
    (strict.safeParse(value).error?.issues ?? []) as { message: string; params?: unknown }[];

  test("the fixture answer validates in both builds", () => {
    expect(strict.safeParse(FIXTURES.worksheetFill).success).toBe(true);
    expect(soft.safeParse(FIXTURES.worksheetFill).success).toBe(true);
  });

  test("shape: an unknown, repeated or missing slot, a type the slot does not allow, a count outside its range", () => {
    for (const [value, message] of [
      [{ slots: [{ index: 9, blocks: [blocks[0]] }] }, "There is no slot 9"],
      [{ slots: [] }, "Slot 3 was not filled"],
      [
        {
          slots: [
            { index: 3, blocks: [blocks[0]] },
            { index: 3, blocks: [blocks[1]] },
          ],
        },
        "answered twice",
      ],
      [{ slots: [{ index: 3, blocks: [...blocks, ...blocks] }] }, "takes 1–3 blocks, not 6"],
      [
        {
          slots: [
            {
              index: 3,
              blocks: [{ type: "paragraph", text: "Read this.", factRefs: ["o1"] }],
            },
          ],
        },
        '"paragraph" is not one of them',
      ],
    ] as const) {
      expect(strict.safeParse(value).success).toBe(false);
      expect(soft.safeParse(value).success).toBe(false);
      const issues = issuesOf(value);
      expect(issues.some((i) => i.message.includes(message))).toBe(true);
      expect(issues.some((i) => !isEditorialIssue(i))).toBe(true);
    }
  });

  test("editorial: tier order, every objective practised, and a picture reference", () => {
    // Stretch (q10) before easy (q6): the soft build accepts it.
    const reordered = { slots: [{ index: 3, blocks: [...blocks].reverse() }] };
    expect(strict.safeParse(reordered).success).toBe(false);
    expect(issuesOf(reordered).every((i) => isEditorialIssue(i))).toBe(true);
    expect(soft.safeParse(reordered).success).toBe(true);
    // o3 practised by no block (the frame covers o1 and o2 only).
    const partial = { slots: [{ index: 3, blocks: [blocks[0]] }] };
    const partialIssues = issuesOf(partial);
    expect(partialIssues.map((i) => i.message)).toEqual([
      "Objective o3 is practised by no block; every objective needs at least one.",
    ]);
    expect(soft.safeParse(partial).success).toBe(true);
    // A worksheet has no photographs (TEACH-223).
    const picture = {
      slots: [{ index: 3, blocks: [{ ...blocks[0], text: "Look at the photo: which state?" }] }],
    };
    expect(issuesOf(picture).some((i) => i.message.includes("no photograph"))).toBe(true);
    expect(issuesOf(picture).every((i) => isEditorialIssue(i))).toBe(true);
    expect(soft.safeParse(picture).success).toBe(true);
  });
});
