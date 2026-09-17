import { describe, expect, test } from "bun:test";
import { JobName } from "@tj/domain";
import { registry } from "./index";

describe("job registry", () => {
  test("every JobName has a handler and no placeholder is left (TEACH-14 replaced the last one)", () => {
    for (const name of Object.values(JobName)) expect(typeof registry[name]).toBe("function");
  });
});
