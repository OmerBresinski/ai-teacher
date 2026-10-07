import { describe, expect, test } from "bun:test";
import { sendCountryHint } from "./account-settings";

const json =
  (body: unknown, status = 200) =>
  async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("sendCountryHint (TEACH-33 part b)", () => {
  test("a hint is posted and the API's answer returned", async () => {
    const posted: string[] = [];
    const result = await sendCountryHint(json({ hint: "IN" }), async (hint) => {
      posted.push(hint);
      return { country: "india", chosen: true };
    });
    expect(posted).toEqual(["IN"]);
    expect(result).toEqual({ country: "india", chosen: true });
  });

  test.each([
    ["no hint", json({ hint: null })],
    ["a bad hint", json({ hint: "<script>" })],
    ["an address", json({ hint: "203.0.113.9" })],
    ["a 404 (vite dev)", json({ error: "not found" }, 404)],
    [
      "a failed fetch",
      async () => {
        throw new TypeError("offline");
      },
    ],
  ] as const)("%s: nothing is posted", async (_label, fetchGeo) => {
    let posted = false;
    const result = await sendCountryHint(fetchGeo, async () => {
      posted = true;
      return { country: "india", chosen: true };
    });
    expect(posted).toBe(false);
    expect(result).toBeUndefined();
  });
});
