/** Schema <-> contract parity for the worker (TEACH-26, see infra/env.contract.ts). */
import { describe, expect, test } from "bun:test";
import { ENV, namesForService, schemaNamesForService } from "../../../infra/env.contract";
import { EnvSchema } from "./env";

const schemaKeys = Object.keys(EnvSchema.shape);

describe("apps/worker env schema vs infra/env.contract.ts", () => {
  test("every schema key is a contract name for service worker", () => {
    const contract = new Set(namesForService("worker"));
    expect(schemaKeys.filter((k) => !contract.has(k))).toEqual([]);
  });

  test("every non-runtimeOnly contract name for worker is a schema key", () => {
    const keys = new Set(schemaKeys);
    expect(schemaNamesForService("worker").filter((n) => !keys.has(n))).toEqual([]);
  });

  test("ENV constants name the schema keys", () => {
    expect(EnvSchema.shape[ENV.WORKER_CONCURRENCY]).toBeDefined();
  });
});
