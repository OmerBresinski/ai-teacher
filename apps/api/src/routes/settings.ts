import { zValidator } from "@hono/zod-validator";
import { getWorkspaceCountry, type ScopableDb, setWorkspaceCountry } from "@tj/db";
import { CountrySchema } from "@tj/domain/documents";
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

export function settingsRoutes(unsafeDb: ScopableDb) {
  return new Hono<AppEnv>()
    .get("/me/settings", async (c) => {
      const workspaceId = getWorkspaceId(c, { allowHeaderShim: false });
      return c.json({ country: await getWorkspaceCountry(unsafeDb, workspaceId) }, 200);
    })
    .patch(
      "/me/settings",
      requireJsonBody(),
      zValidator("json", AccountSettingsSchema, validationHook),
      async (c) => {
        const workspaceId = getWorkspaceId(c, { allowHeaderShim: false });
        const { country } = c.req.valid("json");
        await setWorkspaceCountry(unsafeDb, workspaceId, country);
        c.get("logger")?.info({ country }, "account country set");
        return c.json({ country }, 200);
      },
    );
}
