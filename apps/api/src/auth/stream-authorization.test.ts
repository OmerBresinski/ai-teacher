import { describe, expect, test } from "bun:test";
import { streamAuthorizationLease } from "./stream-authorization";

describe("stream authorization lease", () => {
  test("revalidates before use, detects revocation and cannot restart after stop", async () => {
    let allowed = true;
    let closed = 0;
    const lease = streamAuthorizationLease(
      {
        kind: "session",
        sessionId: "s",
        expiresAt: Date.now() + 10_000,
        revalidate: async () => allowed,
      },
      () => {
        closed++;
      },
    );
    expect(lease.valid()).toBe(false);
    expect(await lease.revalidate()).toBe(true);
    expect(lease.valid()).toBe(true);
    allowed = false;
    expect(await lease.revalidate()).toBe(false);
    expect(lease.valid()).toBe(false);
    allowed = true;
    expect(await lease.revalidate()).toBe(false);
    lease.stop();
    expect(closed).toBe(1);
  });

  test("an expiry earlier than the periodic check closes the lease", async () => {
    let close!: () => void;
    const done = new Promise<void>((resolve) => {
      close = resolve;
    });
    const lease = streamAuthorizationLease(
      { kind: "session", sessionId: "s", expiresAt: Date.now() + 40, revalidate: async () => true },
      close,
    );
    await lease.revalidate();
    await done;
    expect(lease.valid()).toBe(false);
    lease.stop();
  });

  test("a stalled recheck cannot extend the last successful deadline", async () => {
    let close!: () => void;
    const done = new Promise<void>((resolve) => {
      close = resolve;
    });
    let answer!: (allowed: boolean) => void;
    const held = new Promise<boolean>((resolve) => {
      answer = resolve;
    });
    let calls = 0;
    const lease = streamAuthorizationLease(
      {
        kind: "session",
        sessionId: "s",
        expiresAt: Date.now() + 10_000,
        revalidate: () => (++calls === 1 ? Promise.resolve(true) : held),
      },
      close,
      { maxAgeMs: 80, recheckMs: 20 },
    );
    await lease.revalidate();
    await done;
    answer(true);
    await held;
    expect(lease.valid()).toBe(false);
    expect(calls).toBe(2); // stalled lookups are serialized, not started on every timer tick
    lease.stop();
  });

  test("a lookup failure fails closed without forwarding its error", async () => {
    let closed = 0;
    const lease = streamAuthorizationLease(
      {
        kind: "session",
        sessionId: "s",
        expiresAt: Date.now() + 10_000,
        revalidate: async () => {
          throw new Error("private-canary");
        },
      },
      () => {
        closed++;
      },
    );
    expect(await lease.revalidate()).toBe(false);
    expect(closed).toBe(1);
    lease.stop();
  });
});
