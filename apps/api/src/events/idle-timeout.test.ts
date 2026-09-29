import { afterAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { keepConnectionOpen } from "./stream";

// A real Bun.serve with a 1 s idle timeout (production default is 10 s): a stream that stays quiet
// for 2.5 s must survive when `keepConnectionOpen` turns the timeout off for its request. (No
// negative control: when Bun enforces the idle timeout depends on the machine, so it flakes in CI.)
const QUIET_MS = 2_500;

const app = new Hono();
app.get("/kept", (c) => {
  keepConnectionOpen(c);
  return streamSSE(c, async (stream) => {
    await stream.writeSSE({ event: "hello", data: "1" });
    await stream.sleep(QUIET_MS);
    await stream.writeSSE({ event: "late", data: "2" });
  });
});

const server = Bun.serve({ port: 0, idleTimeout: 1, fetch: app.fetch });
afterAll(() => server.stop(true));

async function readAll(path: string): Promise<string> {
  const res = await fetch(`http://localhost:${server.port}${path}`);
  try {
    return await res.text();
  } catch {
    return "<closed>";
  }
}

describe("keepConnectionOpen", () => {
  test("a quiet SSE stream outlives Bun's idle timeout", async () => {
    const body = await readAll("/kept");
    expect(body).toContain("event: hello");
    expect(body).toContain("event: late");
  });

  test("is a no-op outside Bun.serve", async () => {
    const res = await app.request("/kept");
    expect(await res.text()).toContain("event: late");
  });
});
