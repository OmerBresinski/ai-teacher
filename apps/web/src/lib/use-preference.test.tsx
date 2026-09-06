import { afterEach, describe, expect, it } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { usePreference, writePreference } from "./use-preference";

const KEY = "tj:test:pref";
const VALUES = ["grid", "list"] as const;

afterEach(() => {
  cleanup();
  localStorage.removeItem(KEY);
  // Drop the in-memory read cache by announcing a write from "another tab".
  window.dispatchEvent(new Event(`tj:${KEY}`));
});

describe("usePreference", () => {
  it("falls back when storage holds an unknown value", () => {
    localStorage.setItem(KEY, "table");
    window.dispatchEvent(new Event(`tj:${KEY}`));
    const { result } = renderHook(() => usePreference(KEY, VALUES, "grid"));
    expect(result.current[0]).toBe("grid");
  });

  it("writes, persists and notifies every subscriber in the same tab", () => {
    const first = renderHook(() => usePreference(KEY, VALUES, "grid"));
    const second = renderHook(() => usePreference(KEY, VALUES, "grid"));

    act(() => first.result.current[1]("list"));

    expect(first.result.current[0]).toBe("list");
    expect(second.result.current[0]).toBe("list");
    expect(localStorage.getItem(KEY)).toBe("list");
  });

  it("picks up writes from other tabs through the storage event", () => {
    const { result } = renderHook(() => usePreference(KEY, VALUES, "grid"));
    act(() => {
      localStorage.setItem(KEY, "list");
      window.dispatchEvent(new StorageEvent("storage", { key: KEY, newValue: "list" }));
    });
    expect(result.current[0]).toBe("list");
  });

  it("does not re-read storage on every render", () => {
    writePreference(KEY, "list");
    const { result, rerender } = renderHook(() => usePreference(KEY, VALUES, "grid"));
    localStorage.setItem(KEY, "grid"); // silent write: no event, so the cache stands
    rerender();
    expect(result.current[0]).toBe("list");
  });
});
