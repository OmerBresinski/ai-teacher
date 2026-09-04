import { describe, expect, spyOn, test } from "bun:test";
import { parseEnv } from "./env";

const DB = "postgres://postgres:postgres@localhost:5432/teaching_journey";

describe("worker env", () => {
  test("applies defaults", () => {
    expect(parseEnv({ DATABASE_URL: DB })).toEqual({
      DATABASE_URL: DB,
      WORKER_CONCURRENCY: 4,
      LOG_LEVEL: "info",
      PORT: 3002,
      NODE_ENV: "development",
    });
  });

  test("coerces numbers from strings", () => {
    const env = parseEnv({ DATABASE_URL: DB, WORKER_CONCURRENCY: "8", PORT: "3022" });
    expect(env.WORKER_CONCURRENCY).toBe(8);
    expect(env.PORT).toBe(3022);
  });

  test("exits 1 with a readable message when DATABASE_URL is missing or invalid", () => {
    const exit = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => parseEnv({})).toThrow("exit");
      expect(() => parseEnv({ DATABASE_URL: "mysql://nope" })).toThrow("exit");
      expect(() => parseEnv({ DATABASE_URL: DB, WORKER_CONCURRENCY: "0" })).toThrow("exit");
      expect(exit).toHaveBeenCalledWith(1);
      const message = String(error.mock.calls[0]?.[0]);
      expect(message).toContain("apps/worker: invalid environment");
      expect(message).toContain("DATABASE_URL");
      expect(message).toContain(".env.example");
    } finally {
      exit.mockRestore();
      error.mockRestore();
    }
  });
});
