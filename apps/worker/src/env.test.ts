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
      OPENAI_API_KEY: undefined,
      AWS_BEARER_TOKEN_BEDROCK: undefined,
      AWS_REGION: DEFAULT_REGION,
      AI_GATEWAY_API_KEY: undefined,
      AI_MODEL_FRONTIER: DEFAULT_MODEL_IDS.frontier,
      AI_MODEL_STANDARD: DEFAULT_MODEL_IDS.standard,
      AI_MODEL_SMALL: DEFAULT_MODEL_IDS.small,
      AI_LESSON_COST_CAP_USD: 0.5,
      AI_LESSON_TOKEN_CAP: 300_000,
      AI_WORKSHEET_COST_CAP_USD: 0.1,
      MASTRA_TELEMETRY_DISABLED: undefined,
      PEXELS_API_KEY: undefined,
      AI_FAKE_SCRIPT: undefined,
      AI_FAKE_DELAY_MS: 0,
    });
  });

  test("the scripted fake is accepted in test and refused in production (ADR 0025 §22)", () => {
    const env = parseEnv({
      DATABASE_URL: DB,
      NODE_ENV: "test",
      AI_FAKE_SCRIPT: "pipeline",
      AI_FAKE_DELAY_MS: "300",
    });
    expect(env.AI_FAKE_SCRIPT).toBe("pipeline");
    expect(env.AI_FAKE_DELAY_MS).toBe(300);
    const exit = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() =>
        parseEnv({
          DATABASE_URL: DB,
          NODE_ENV: "production",
          AWS_BEARER_TOKEN_BEDROCK: "k",
          AI_FAKE_SCRIPT: "pipeline",
        }),
      ).toThrow("exit");
      expect(error).toHaveBeenCalledWith(expect.stringContaining("AI_FAKE_SCRIPT: refused"));
      expect(() => parseEnv({ DATABASE_URL: DB, AI_FAKE_SCRIPT: "other" })).toThrow("exit");
    } finally {
      exit.mockRestore();
      error.mockRestore();
    }
  });

  test("coerces the budget caps and refuses a non-numeric cap (ADR 0025 §15)", () => {
    const env = parseEnv({
      DATABASE_URL: DB,
      AI_LESSON_COST_CAP_USD: "1.25",
      AI_LESSON_TOKEN_CAP: "50000",
    });
    expect(env.AI_LESSON_COST_CAP_USD).toBe(1.25);
    expect(env.AI_LESSON_TOKEN_CAP).toBe(50_000);
    const exit = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => parseEnv({ DATABASE_URL: DB, AI_LESSON_COST_CAP_USD: "abc" })).toThrow("exit");
      expect(error.mock.calls[0]?.[0]).toContain("apps/worker: invalid environment");
      expect(error.mock.calls[0]?.[0]).toContain("AI_LESSON_COST_CAP_USD");
    } finally {
      exit.mockRestore();
      error.mockRestore();
    }
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

  test("requires an OpenAI or Bedrock key in production (ADR 0031)", () => {
    // Either key alone boots (A15: production on Bedrock still validates).
    expect(
      parseEnv({ DATABASE_URL: DB, NODE_ENV: "production", OPENAI_API_KEY: "k" }).OPENAI_API_KEY,
    ).toBe("k");
    expect(
      parseEnv({ DATABASE_URL: DB, NODE_ENV: "production", AWS_BEARER_TOKEN_BEDROCK: "b" })
        .AWS_BEARER_TOKEN_BEDROCK,
    ).toBe("b");

    const exit = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      // A17: a blank OpenAI key is unset, so with no Bedrock key the readable message names it.
      expect(() =>
        parseEnv({ DATABASE_URL: DB, NODE_ENV: "production", OPENAI_API_KEY: " " }),
      ).toThrow("exit");
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining(
          "OPENAI_API_KEY: required in production unless AWS_BEARER_TOKEN_BEDROCK is set (ADR 0031)",
        ),
      );
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      exit.mockRestore();
      error.mockRestore();
    }
  });

  test("keeps the OpenAI and gateway keys so @tj/ai can route to them", () => {
    const env = parseEnv({
      DATABASE_URL: DB,
      OPENAI_API_KEY: "openai-key",
      AI_GATEWAY_API_KEY: "gateway-key",
    });
    expect(env.OPENAI_API_KEY).toBe("openai-key");
    expect(env.AI_GATEWAY_API_KEY).toBe("gateway-key");
    const blank = parseEnv({ DATABASE_URL: DB, OPENAI_API_KEY: " ", AI_GATEWAY_API_KEY: "" });
    expect(blank.OPENAI_API_KEY).toBeUndefined();
    expect(blank.AI_GATEWAY_API_KEY).toBeUndefined();
  });

  describe("AI_REASONING_EFFORT (TEACH-72)", () => {
    test("unset or blank leaves every stage at its own effort", () => {
      expect(parseEnv({ DATABASE_URL: DB }).AI_REASONING_EFFORT).toBeUndefined();
      expect(parseEnv({ DATABASE_URL: DB, AI_REASONING_EFFORT: "  " }).AI_REASONING_EFFORT).toBe(
        undefined,
      );
    });

    test("accepts each of none | low | medium | high | xhigh", () => {
      for (const effort of ["none", "low", "medium", "high", "xhigh"] as const) {
        expect(
          parseEnv({ DATABASE_URL: DB, AI_REASONING_EFFORT: effort }).AI_REASONING_EFFORT,
        ).toBe(effort);
      }
    });

    test("an invalid value stops the worker at boot, naming the variable and the allowed values", () => {
      const exit = spyOn(process, "exit").mockImplementation((() => {
        throw new Error("exit");
      }) as never);
      const error = spyOn(console, "error").mockImplementation(() => {});
      try {
        expect(() => parseEnv({ DATABASE_URL: DB, AI_REASONING_EFFORT: "minimal" })).toThrow(
          "exit",
        );
        expect(exit).toHaveBeenCalledWith(1);
        const message = String(error.mock.calls[0]?.[0]);
        expect(message).toContain("AI_REASONING_EFFORT");
        expect(message).toContain("xhigh");
      } finally {
        exit.mockRestore();
        error.mockRestore();
      }
    });
  });
});
