import { describe, expect, spyOn, test } from "bun:test";
import { DEFAULT_MODEL_IDS, DEFAULT_REGION } from "@tj/ai";
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
      AWS_BEARER_TOKEN_BEDROCK: undefined,
      AWS_REGION: DEFAULT_REGION,
      AI_MODEL_FRONTIER: DEFAULT_MODEL_IDS.frontier,
      AI_MODEL_STANDARD: DEFAULT_MODEL_IDS.standard,
      AI_MODEL_SMALL: DEFAULT_MODEL_IDS.small,
    });
  });

  test("accepts no key in development, treats a blank key as unset, and allows model overrides", () => {
    const blank = parseEnv({
      DATABASE_URL: DB,
      AWS_BEARER_TOKEN_BEDROCK: " ",
      AI_MODEL_SMALL: "custom-small",
    });
    expect(blank.AWS_BEARER_TOKEN_BEDROCK).toBeUndefined();
    expect(blank.AI_MODEL_SMALL).toBe("custom-small");
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

  test("requires the Bedrock key in production", () => {
    const exit = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => parseEnv({ DATABASE_URL: DB, NODE_ENV: "production" })).toThrow("exit");
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining("AWS_BEARER_TOKEN_BEDROCK: required in production (ADR 0018)"),
      );
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      exit.mockRestore();
      error.mockRestore();
    }
  });
});
