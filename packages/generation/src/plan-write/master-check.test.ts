import { describe, expect, test } from "bun:test";
import { MASTER_CHECK_VERSION } from "../prompts/master-check";
import { planWriteCheckerEffort, planWriteCheckerModel } from "./master-check";
import { planWriteRoute } from "./steps";

describe("master check model and effort switch", () => {
  test("the model: the asked one, else the fallback (the writer's)", () => {
    expect(planWriteCheckerModel("w", "openai/gpt-6.1-sol")).toBe("openai/gpt-6.1-sol");
    expect(planWriteCheckerModel("w", " ")).toBe("w");
  });

  test("the effort: a known one as asked, else low", () => {
    expect(planWriteCheckerEffort("medium")).toBe("medium");
    expect(planWriteCheckerEffort("max")).toBe("low");
  });

  test("the route sends only the master check to the checker model", () => {
    const route = planWriteRoute("p", "w", "c");
    expect(route(undefined, { promptVersion: MASTER_CHECK_VERSION })).toBe("c");
    expect(route(undefined, { promptVersion: "write-slides.v16" })).toBe("w");
    expect(route(undefined, { promptVersion: "verify-facts.v9" })).toBeUndefined();
  });
});
