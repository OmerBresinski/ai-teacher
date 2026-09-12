/**
 * `GET /mail-assets/:file` — the handful of images the transactional emails embed (TEACH-35
 * follow-up). Gmail rewrites `<img>` sources through its proxy and strips inline SVG, so the
 * arrow on the magic-link button has to be a PNG at a public URL; the api is the one origin the
 * mail code already knows (`BETTER_AUTH_URL`). Unauthenticated by design (a mail client fetches
 * it with no cookie), immutable and long-cached, and `app.ts` exempts the prefix from the
 * `same-origin` CORP header so Apple Mail's WebView may render it. Node APIs only: this module is
 * part of `AppType`, which `apps/web` typechecks without Bun's types.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import type { AppEnv } from "../context";
import { errorResponse } from "../errors";

export const MAIL_ASSETS_PREFIX = "/mail-assets";

const ASSETS: Record<string, { file: string; type: string }> = {
  "arrow-up-right.png": {
    file: fileURLToPath(new URL("../mail/assets/arrow-up-right.png", import.meta.url)),
    type: "image/png",
  },
};

export function mailAssetRoutes() {
  return new Hono<AppEnv>().get(`${MAIL_ASSETS_PREFIX}/:file`, async (c) => {
    const asset = ASSETS[c.req.param("file")];
    if (!asset) return errorResponse(c, 404, "not_found", "That asset does not exist.", false);
    const body = await readFile(asset.file);
    return c.body(new Uint8Array(body), 200, {
      "Content-Type": asset.type,
      "Cache-Control": "public, max-age=31536000, immutable",
    });
  });
}
