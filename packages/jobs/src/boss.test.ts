import { describe, expect, test } from "bun:test";
import { bossOptions } from "./boss";

const URL = "postgres://postgres:postgres@localhost:5432/teaching_journey";

describe("bossOptions", () => {
  test("worker (default) supervises and schedules", () => {
    const o = bossOptions(URL) as Record<string, unknown>;
    expect(o.connectionString).toBe(URL);
    expect(o.schema).toBe("pgboss");
    expect(o.application_name).toBe("tj-worker");
    expect(o.supervise).toBe(true);
    expect(o.schedule).toBe(true);
  });

  test("enqueue-only (the api, ADR 0006) turns maintenance and cron off", () => {
    const o = bossOptions(URL, { applicationName: "tj-api", role: "enqueue-only" }) as Record<
      string,
      unknown
    >;
    expect(o.application_name).toBe("tj-api");
    expect(o.supervise).toBe(false);
    expect(o.schedule).toBe(false);
  });

  test("requires a connection URL", () => {
    expect(() => bossOptions("")).toThrow(/connection URL/);
  });
});
