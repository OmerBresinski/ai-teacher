/** Schema <-> contract parity for the web app (TEACH-26, see infra/env.contract.ts). */
import { describe, expect, test } from "bun:test";
import { ENV, namesForService, schemaNamesForService } from "../../../infra/env.contract";
import { EnvSchema } from "./env";

const schemaKeys = Object.keys(EnvSchema.shape);

describe("apps/web env schema vs infra/env.contract.ts", () => {
  test("every schema key is a contract name for service web", () => {
    const contract = new Set(namesForService("web"));
    expect(schemaKeys.filter((k) => !contract.has(k))).toEqual([]);
  });

  test("every non-runtimeOnly contract name for web is a schema key", () => {
    const keys = new Set(schemaKeys);
    expect(schemaNamesForService("web").filter((n) => !keys.has(n))).toEqual([]);
  });

  test("ENV constants name the schema keys and only VITE_* reach the bundle", () => {
    expect(EnvSchema.shape[ENV.VITE_API_URL]).toBeDefined();
    for (const key of schemaKeys) expect(key.startsWith("VITE_")).toBe(true);
  });
});
