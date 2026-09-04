import { afterAll, describe, expect, test } from "bun:test";
import { createApiClient, jobEventsUrl, workspaceEventsUrl } from "./index";

const server = Bun.serve({
  port: 0,
  fetch: (req) =>
    Response.json({ message: "Hello, x", seenHeader: req.headers.get("x-test") }, { status: 200 }),
});
afterAll(() => server.stop(true));

describe("@tj/api-client", () => {
  test("createApiClient builds typed URLs", () => {
    const client = createApiClient("http://localhost:3001");
    expect(client.hello.$url({ query: { name: "x" } }).toString()).toBe(
      "http://localhost:3001/hello?name=x",
    );
    expect(client.health.$url().toString()).toBe("http://localhost:3001/health");
  });

  test("createApiClient forwards init (headers) to fetch", async () => {
    const client = createApiClient(`http://localhost:${server.port}`, {
      headers: { "x-test": "1" },
    });
    const res = await client.hello.$get({ query: { name: "x" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { message: string; seenHeader?: string };
    expect(body.message).toBe("Hello, x");
    expect(body.seenHeader).toBe("1");
  });

  test("SSE url helpers", () => {
    expect(jobEventsUrl("http://api.test/", "job 1")).toBe("http://api.test/jobs/job%201/events");
    expect(workspaceEventsUrl("http://api.test")).toBe("http://api.test/events");
  });
});
