import { describe, expect, test } from "bun:test";
import { createApp } from "../app";
import { fakeSql, TEST_ENV } from "../test-helpers";

describe("GET /mail-assets/:file", () => {
  test("serves the arrow PNG publicly, cached, without same-origin CORP", async () => {
    const app = createApp({ env: TEST_ENV, db: fakeSql(true) });
    const res = await app.request("/mail-assets/arrow-up-right.png", {
      headers: { "Sec-Fetch-Site": "cross-site" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("cross-origin-resource-policy")).toBeNull();
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes.subarray(1, 4))).toEqual([0x50, 0x4e, 0x47]); // "PNG"
  });

  test("unknown assets, including prototype keys, are a 404 envelope", async () => {
    const app = createApp({ env: TEST_ENV, db: fakeSql(true) });
    for (const file of ["nope.png", "constructor", "toString", "__proto__"]) {
      const res = await app.request(`/mail-assets/${file}`);
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: { code: "not_found" } });
    }
  });
});
