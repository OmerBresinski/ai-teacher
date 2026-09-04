/**
 * Schema <-> contract parity (TEACH-26): every key the api's boot schema (and the SSE knobs
 * schema) declares is in `infra/env.contract.ts` for service `api`, and every contract name for
 * `api` that is not `runtimeOnly` is declared by one of those schemas.
 */
import { describe, expect, test } from "bun:test";
import { ENV, namesForService, schemaNamesForService } from "../../../infra/env.contract";
import { EnvSchema } from "./env";
import { EventsConfigSchema } from "./events/config";

const schemaKeys = [...Object.keys(EnvSchema.shape), ...Object.keys(EventsConfigSchema.shape)];

describe("apps/api env schema vs infra/env.contract.ts", () => {
  test("every schema key is a contract name for service api", () => {
    const contract = new Set(namesForService("api"));
    expect(schemaKeys.filter((k) => !contract.has(k))).toEqual([]);
  });

  test("every non-runtimeOnly contract name for api is a schema key", () => {
    const keys = new Set(schemaKeys);
    expect(schemaNamesForService("api").filter((n) => !keys.has(n))).toEqual([]);
  });

  test("ENV constants name the schema keys", () => {
    expect(EnvSchema.shape[ENV.DATABASE_URL]).toBeDefined();
    expect(EnvSchema.shape[ENV.BETTER_AUTH_SECRET]).toBeDefined();
    expect(EventsConfigSchema.shape[ENV.EVENTS_POLL_MS]).toBeDefined();
  });
});
