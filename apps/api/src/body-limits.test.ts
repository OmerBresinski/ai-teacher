import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { createApp } from "./app";
import type { Auth } from "./auth/auth";
import {
  boundedBodyLimit,
  MAX_REQUEST_BODY_BYTES,
  SMALL_JSON_BODY_BYTES,
  smallJsonBodyLimit,
} from "./body-limits";
import type { AppEnv } from "./context";
import { errorResponse } from "./errors";
import { DOCUMENT_BODY_LIMIT_BYTES } from "./routes/documents";
import { SOURCE_BODY_LIMIT_BYTES } from "./routes/sources";
import { fakeSql, silentLogger, TEST_ENV, TEST_ENV_NO_SHIM } from "./test-helpers";
import { WORKSPACE_HEADER } from "./workspace";

const WS = "0192f7a0-0000-7000-8000-000000000001";
const LESSON = "0192f7a0-0000-7000-8000-000000000042";
const paths = [
  "/jobs/ping",
  "/jobs/ai-ping",
  `/lessons/${LESSON}/cascade`,
  `/lessons/${LESSON}/regenerate`,
  "/images/pick",
  "/images/report",
  `/jobs/${LESSON}/cancel`,
  `/documents/${LESSON}/restore`,
];
const fresh = () => createApp({ env: TEST_ENV, db: fakeSql(true), logger: silentLogger });

function streamBody(total: number, chunkSize = 1024) {
  let emitted = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (emitted === total) {
          controller.close();
          return;
        }
        const size = Math.min(chunkSize, total - emitted);
        emitted += size;
        controller.enqueue(new Uint8Array(size).fill(120));
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { body, emitted: () => emitted, cancelled: () => cancelled };
}

describe("small-request limits before parsing", () => {
  test.each(paths)(
    "%s rejects oversized malformed JSON before schema/runtime work",
    async (path) => {
      const response = await fresh().request(path, {
        method: "POST",
        headers: { "content-type": "application/json", [WORKSPACE_HEADER]: WS },
        body: "x".repeat(SMALL_JSON_BODY_BYTES + 1),
      });
      expect(response.status).toBe(413);
      expect(await response.json()).toMatchObject({ error: { code: "payload_too_large" } });
    },
  );

  test.each([undefined, "1"])(
    "streamed bytes are bounded even with Content-Length=%s",
    async (length) => {
      const stream = streamBody(SMALL_JSON_BODY_BYTES * 4);
      const response = await fresh().request(
        new Request("http://localhost/jobs/ping", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [WORKSPACE_HEADER]: WS,
            ...(length ? { "content-length": length } : {}),
          },
          body: stream.body,
        }),
      );
      expect(response.status).toBe(413);
      expect(stream.emitted()).toBeLessThanOrEqual(SMALL_JSON_BODY_BYTES + 1024);
      expect(stream.cancelled()).toBe(true);
    },
  );

  test("declared over-limit length rejects without pulling the body", async () => {
    const stream = streamBody(2);
    const response = await fresh().request(
      new Request("http://localhost/jobs/ping", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(SMALL_JSON_BODY_BYTES + 1),
          [WORKSPACE_HEADER]: WS,
        },
        body: stream.body,
      }),
    );
    expect(response.status).toBe(413);
    expect(stream.emitted()).toBe(0);
    expect(stream.cancelled()).toBe(true);
  });

  test.each(["unauthenticated", "foreign-origin"])(
    "%s is rejected before protected-body reads",
    async (kind) => {
      const stream = streamBody(SMALL_JSON_BODY_BYTES * 4);
      const app = createApp({ env: TEST_ENV_NO_SHIM, db: fakeSql(true), logger: silentLogger });
      const response = await app.request(
        new Request("http://localhost/images/pick", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(kind === "foreign-origin" ? { Origin: "https://foreign.invalid" } : {}),
          },
          body: stream.body,
        }),
      );
      expect(response.status).toBe(kind === "foreign-origin" ? 403 : 401);
      expect(stream.emitted()).toBe(0);
      await stream.body.cancel();
    },
  );

  test("valid small JSON reaches the existing handler and GET/preflight stay compatible", async () => {
    const app = fresh();
    expect(
      (
        await app.request("/jobs/ping", {
          method: "POST",
          headers: { "content-type": "application/json", [WORKSPACE_HEADER]: WS },
          body: JSON.stringify({ message: "hello" }),
        })
      ).status,
    ).toBe(503);
    expect((await app.request("/hello?name=teacher")).status).toBe(200);
    expect(
      (
        await app.request("/auth/sign-in/magic-link", {
          method: "OPTIONS",
          headers: {
            Origin: TEST_ENV.WEB_ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
          },
        })
      ).status,
    ).toBe(204);
  });
});

describe("transport compatibility", () => {
  test.each([`/documents/${LESSON}`, `/sources/${LESSON}`])(
    "DELETE %s rejects an oversized unused body",
    async (path) => {
      const response = await fresh().request(path, {
        method: "DELETE",
        headers: { [WORKSPACE_HEADER]: WS },
        body: "x".repeat(SMALL_JSON_BODY_BYTES + 1),
      });
      expect(response.status).toBe(413);
    },
  );
  test("one-byte chunks round-trip without retaining a chunk list", async () => {
    const app = new Hono<AppEnv>().post("/", smallJsonBodyLimit(), async (c) =>
      c.text(await c.req.text()),
    );
    const stream = streamBody(SMALL_JSON_BODY_BYTES, 1);
    const response = await app.request("/", { method: "POST", body: stream.body });
    expect(response.status).toBe(200);
    expect((await response.text()).length).toBe(SMALL_JSON_BODY_BYTES);
  });

  test("UTF-8 bytes, rather than string character count, determine the cap", async () => {
    const response = await fresh().request("/jobs/ping", {
      method: "POST",
      headers: { "content-type": "application/json", [WORKSPACE_HEADER]: WS },
      body: JSON.stringify({ message: "界".repeat(24_000) }),
    });
    expect(response.status).toBe(413);
  });

  test("OAuth URL-encoded callbacks survive the auth wrapper byte-for-byte", async () => {
    const form = "code=synthetic%2Bcode&state=synthetic+state";
    let calls = 0;
    const auth = {
      handler: async (request: Request) => {
        calls++;
        return new Response(await request.text());
      },
    } as unknown as Auth;
    const app = createApp({ env: TEST_ENV, db: fakeSql(true), logger: silentLogger, auth });
    const response = await app.request("/auth/callback/google", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(form);
    const large = await app.request("/auth/callback/google", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `code=${"x".repeat(SMALL_JSON_BODY_BYTES)}`,
    });
    expect(large.status).toBe(413);
    expect(calls).toBe(1);
  });

  test("large-document and multipart ceilings are retained beneath the runtime ceiling", async () => {
    expect(DOCUMENT_BODY_LIMIT_BYTES).toBe(10 * 1024 * 1024);
    expect(SOURCE_BODY_LIMIT_BYTES).toBe(26 * 1024 * 1024);
    expect(MAX_REQUEST_BODY_BYTES).toBeGreaterThan(SOURCE_BODY_LIMIT_BYTES);
    const app = new Hono<AppEnv>().post(
      "/",
      boundedBodyLimit(DOCUMENT_BODY_LIMIT_BYTES, "too large"),
      async (c) => c.json({ bytes: (await c.req.arrayBuffer()).byteLength }),
    );
    app.onError((error, c) =>
      errorResponse(
        c,
        error instanceof HTTPException ? 413 : 500,
        "payload_too_large",
        "too large",
        false,
      ),
    );
    const response = await app.request("/", {
      method: "POST",
      body: new Uint8Array(SMALL_JSON_BODY_BYTES + 1),
    });
    expect(response.status).toBe(200);
  });
});
