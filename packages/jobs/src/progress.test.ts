import { describe, expect, test } from "bun:test";
import type { JobProgress } from "@tj/domain";
import { createProgressEmitter } from "./progress";

function harness(minIntervalMs = 250) {
  let clock = 1_000;
  const emitted: JobProgress[] = [];
  const emitter = createProgressEmitter({
    minIntervalMs,
    now: () => clock,
    emit: async (p) => {
      emitted.push(p);
    },
    onError: (err) => {
      throw err;
    },
  });
  return { emitter, emitted, tick: (ms: number) => (clock += ms) };
}

describe("progress rate limit", () => {
  test("first call emits at once; calls inside 250 ms coalesce into one trailing event", async () => {
    const { emitter, emitted } = harness();
    await emitter.emit(10, "a");
    expect(emitted).toEqual([{ percent: 10, message: "a" }]);
    void emitter.emit(20, "b");
    void emitter.emit(30, "c");
    void emitter.emit(40, "d");
    expect(emitted).toHaveLength(1);
    await Bun.sleep(300);
    expect(emitted).toEqual([
      { percent: 10, message: "a" },
      { percent: 40, message: "d" },
    ]);
  });

  test("calls spaced >= 250 ms apart all emit", async () => {
    const { emitter, emitted, tick } = harness();
    await emitter.emit(1);
    tick(250);
    await emitter.emit(2);
    tick(300);
    await emitter.emit(3);
    expect(emitted.map((p) => p.percent)).toEqual([1, 2, 3]);
  });

  test("flush writes the pending event without waiting for the window", async () => {
    const { emitter, emitted } = harness();
    await emitter.emit(1);
    void emitter.emit(2);
    await emitter.flush();
    expect(emitted.map((p) => p.percent)).toEqual([1, 2]);
    await emitter.flush(); // idempotent
    expect(emitted).toHaveLength(2);
  });

  test("omits undefined fields (strict JobProgressSchema)", async () => {
    const { emitter, emitted } = harness();
    await emitter.emit();
    expect(emitted).toEqual([{}]);
  });

  test("a failing write is reported to onError, not thrown at the handler", async () => {
    const errors: unknown[] = [];
    const emitter = createProgressEmitter({
      minIntervalMs: 250,
      emit: async () => {
        throw new Error("db down");
      },
      onError: (err) => errors.push(err),
    });
    await emitter.emit(1);
    expect(errors).toHaveLength(1);
  });
});
