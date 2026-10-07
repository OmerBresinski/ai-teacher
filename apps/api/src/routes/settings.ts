import { zValidator } from "@hono/zod-validator";
import {
  applyCountryHint,
  getWorkspaceSettings,
  type ScopableDb,
  setWorkspaceCountry,
} from "@tj/db";
import { CountrySchema, countryFromGeo } from "@tj/domain/documents";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context";
import { requireJsonBody, validationHook } from "../validation";
import { getWorkspaceId } from "../workspace";

/**
 * Account settings (TEACH-33 part b, ruling 183): today only the country, stored on the personal
 * Workspace. `/me/*` sits behind the CSRF and session guards; anonymous sessions may read but not
 * write (the anonymous guard's default deny).
 */
export const AccountSettingsSchema = z.strictObject({ country: CountrySchema });

/**
 * The web's geolocation of the visitor (Vercel's `x-vercel-ip-country`, plus its region for the
 * UK), as an ISO 3166 code: "IN", "GB-SCT". Only the code travels; never an address.
 */
export const CountryHintSchema = z.strictObject({
  hint: z.string().regex(/^[A-Za-z]{2}(?:-[A-Za-z0-9]{1,3})?$/),
});

/** "GB-SCT" → Scotland, "IN" → India; a country Dayback does not cover is England. */
export function countryFromHint(hint: string) {
  const [iso, region] = hint.split("-");
  return countryFromGeo(iso, region);
}

export function settingsRoutes(unsafeDb: ScopableDb) {
  return (
    new Hono<AppEnv>()
      .get("/me/settings", async (c) => {
        const workspaceId = getWorkspaceId(c, { allowHeaderShim: false });
        return c.json(await getWorkspaceSettings(unsafeDb, workspaceId), 200);
      })
      // A new account's first visit: set the country from the web's geolocation, only while none
      // is set (TEACH-33 part b). Open to anonymous sessions (anonymous-guard allow-list).
      .post(
        "/me/settings/country-hint",
        requireJsonBody(),
        zValidator("json", CountryHintSchema, validationHook),
        async (c) => {
          const workspaceId = getWorkspaceId(c, { allowHeaderShim: false });
          const hinted = countryFromHint(c.req.valid("json").hint);
          const country = await applyCountryHint(unsafeDb, workspaceId, hinted);
          c.get("logger")?.info({ hinted, country }, "account country hint");
          return c.json({ country, chosen: true }, 200);
        },
      )
      .patch(
        "/me/settings",
        requireJsonBody(),
        zValidator("json", AccountSettingsSchema, validationHook),
        async (c) => {
          const workspaceId = getWorkspaceId(c, { allowHeaderShim: false });
          const { country } = c.req.valid("json");
          await setWorkspaceCountry(unsafeDb, workspaceId, country);
          c.get("logger")?.info({ country }, "account country set");
          return c.json({ country, chosen: true }, 200);
        },
      )
  );
}
