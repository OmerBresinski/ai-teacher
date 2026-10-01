import { describe, expect, it } from "bun:test";
import { parseEnv, slotPlaceholdersEnabled } from "./env";

describe("parseEnv", () => {
  it("applies defaults in development", () => {
    expect(parseEnv({}, false)).toEqual({
      VITE_API_URL: "/api",
      VITE_APP_ENV: "development",
      VITE_TURNSTILE_SITE_KEY: undefined,
      VITE_SHOW_SLOT_PLACEHOLDERS: "1",
    });
  });

  it("rejects an unknown VITE_APP_ENV with a readable message", () => {
    expect(() => parseEnv({ VITE_APP_ENV: "staging" }, false)).toThrow(/VITE_APP_ENV/);
  });

  it("requires an absolute API url in a production build", () => {
    expect(() => parseEnv({ VITE_API_URL: "/api" }, true)).toThrow(/absolute http\(s\) URL/);
    expect(
      parseEnv(
        {
          VITE_API_URL: "https://api.example.test",
          VITE_APP_ENV: "production",
          VITE_TURNSTILE_SITE_KEY: "0x4AAA",
        },
        true,
      ),
    ).toMatchObject({ VITE_API_URL: "https://api.example.test" });
  });

  it("requires a Turnstile site key in a production build only (TEACH-243)", () => {
    const prod = { VITE_API_URL: "https://api.example.test", VITE_APP_ENV: "production" };
    expect(() => parseEnv(prod, true)).toThrow(/VITE_TURNSTILE_SITE_KEY: required/);
    expect(() => parseEnv({ ...prod, VITE_TURNSTILE_SITE_KEY: "  " }, true)).toThrow(
      /VITE_TURNSTILE_SITE_KEY/,
    );
    expect(parseEnv({ ...prod, VITE_APP_ENV: "preview" }, true).VITE_TURNSTILE_SITE_KEY).toBe(
      undefined,
    );
    expect(parseEnv({ VITE_TURNSTILE_SITE_KEY: "1x00000000000000000000AA" }, false)).toMatchObject({
      VITE_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
    });
  });
});

describe("slot placeholders (look/image-slot)", () => {
  it("are on by default, in production too, and off when set to 0", () => {
    expect(slotPlaceholdersEnabled(parseEnv({}, false))).toBe(true);
    expect(slotPlaceholdersEnabled(parseEnv({ VITE_SHOW_SLOT_PLACEHOLDERS: "0" }, false))).toBe(
      false,
    );
    expect(
      slotPlaceholdersEnabled(
        parseEnv(
          {
            VITE_APP_ENV: "production",
            VITE_API_URL: "https://api.example.test",
            VITE_TURNSTILE_SITE_KEY: "0x4AAA",
          },
          true,
        ),
      ),
    ).toBe(true);
  });
});
