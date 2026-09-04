import { describe, expect, test } from "bun:test";
import { loadEventsConfig } from "./config";
import { parseLastEventId } from "./stream";

describe("parseLastEventId", () => {
  test("accepts non-negative integers", () => {
    expect(parseLastEventId("42")).toBe(42);
    expect(parseLastEventId(" 7 ")).toBe(7);
    expect(parseLastEventId("0")).toBe(0);
  });

  test("ignores anything else", () => {
    expect(parseLastEventId(undefined)).toBeUndefined();
    expect(parseLastEventId(null)).toBeUndefined();
    expect(parseLastEventId("")).toBeUndefined();
    expect(parseLastEventId("-1")).toBeUndefined();
    expect(parseLastEventId("1.5")).toBeUndefined();
    expect(parseLastEventId("abc")).toBeUndefined();
    expect(parseLastEventId("1e3")).toBeUndefined();
    expect(parseLastEventId("9".repeat(20))).toBeUndefined();
  });
});

describe("loadEventsConfig", () => {
  test("defaults", () => {
    expect(loadEventsConfig({})).toEqual({
      maxStreamsPerWorkspace: 20,
      replayLimit: 500,
      heartbeatMs: 15_000,
      pollMs: 1_000,
    });
  });

  test("env values are coerced; overrides win", () => {
    const cfg = loadEventsConfig(
      { EVENTS_HEARTBEAT_MS: "50", EVENTS_REPLAY_LIMIT: "10" },
      {
        pollMs: 5,
      },
    );
    expect(cfg.heartbeatMs).toBe(50);
    expect(cfg.replayLimit).toBe(10);
    expect(cfg.pollMs).toBe(5);
  });

  test("invalid values throw", () => {
    expect(() => loadEventsConfig({ EVENTS_POLL_MS: "nope" })).toThrow();
    expect(() => loadEventsConfig({ EVENTS_MAX_STREAMS_PER_WORKSPACE: "0" })).toThrow();
  });
});
