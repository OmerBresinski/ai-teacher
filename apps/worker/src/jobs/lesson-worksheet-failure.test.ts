import { describe, expect, test } from "bun:test";
import { NonRetryableError } from "@tj/jobs";
import { worksheetFailureCode } from "./lesson-worksheet";

/* R4 review (12 Nov): a sheet job that finds the lesson still held by a lesson job stops as changed. */
describe("worksheetFailureCode", () => {
  test("a lesson still being written or repaired is lesson-changed", () => {
    expect(worksheetFailureCode(new NonRetryableError("lesson changed"))).toBe("lesson-changed");
    expect(worksheetFailureCode(new NonRetryableError("revision moved"))).toBe("lesson-changed");
  });
  test("a lost worksheet lock saves nothing", () => {
    expect(worksheetFailureCode(new NonRetryableError("lock lost"))).toBeNull();
  });
});
