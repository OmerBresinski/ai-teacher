/** Integration: `/health` against the real test database (skips visibly when unreachable). */
import { afterAll, describe, expect, test } from "bun:test";
import { withTestDb } from "@tj/db/testing";
import { testApp } from "./test-helpers";

const t = await withTestDb({ max: 2 });
const describeDb = t.ok ? describe : describe.skip;
if (!t.ok) console.warn(`skipping /health db test: ${t.reason}`);

describeDb("GET /health (real database)", () => {
  if (!t.ok) return;
  afterAll(() => t.db.close());

  test("200 { ok: true, db: 'up' }", async () => {
    const res = await testApp(t.db).request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, db: "up" });
  });
});
