import { describe, expect, test } from "bun:test";
import pino from "pino";
import { createWorkerDeps } from "./deps";
import { effortOverride } from "./effort";
import { parseEnv } from "./env";

const DB = "postgres://postgres:postgres@localhost:5432/teaching_journey";
const quiet = pino({ level: "silent" });
const noDb = {} as never;

describe("effortOverride (AI_REASONING_EFFORT, TEACH-72)", () => {
  test("unset adds no effortFor, so each stage keeps its own effort", () => {
    expect(effortOverride(undefined)).toEqual({});
    expect("effortFor" in effortOverride(undefined)).toBe(false);
  });

  test("set, every call runs at that effort whatever the stage asked for", () => {
    const { effortFor } = effortOverride("low") as { effortFor: () => string };
    expect(effortFor()).toBe("low");
  });

  test("createWorkerDeps carries the env value, and nothing when unset", () => {
    const set = createWorkerDeps(
      parseEnv({ DATABASE_URL: DB, AI_REASONING_EFFORT: "xhigh" }),
      quiet,
      noDb,
    );
    expect(set.reasoningEffort).toBe("xhigh");
    const unset = createWorkerDeps(parseEnv({ DATABASE_URL: DB }), quiet, noDb);
    expect("reasoningEffort" in unset).toBe(false);
  });
});
