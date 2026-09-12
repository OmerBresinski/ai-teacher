/**
 * `GET /mail-assets/:file` — the handful of images the transactional emails embed (TEACH-35
 * follow-up). Gmail rewrites `<img>` sources through its proxy and strips inline SVG, so the
 * arrow on the magic-link button has to be a PNG at a public URL; the api is the one origin the
 * mail code already knows (`BETTER_AUTH_URL`). Unauthenticated by design (a mail client fetches
 * it with no cookie), immutable and long-cached, and `app.ts` exempts the prefix from the
 * `same-origin` CORP header so Apple Mail's WebView may render it. No Bun-only APIs: this module is
 * part of `AppType`, which `apps/web` typechecks without Bun's types.
 */
import { Hono } from "hono";
import type { AppEnv } from "../context";
import { errorResponse } from "../errors";
import { ARROW_UP_RIGHT_PNG } from "../mail/assets/arrow-up-right";

export const MAIL_ASSETS_PREFIX = "/mail-assets";

/** Bytes are embedded (see `../mail/assets`): the runtime image carries the bundle only. */
const ASSETS: Record<string, { bytes: ArrayBuffer; type: string }> = {
  "arrow-up-right.png": { bytes: ARROW_UP_RIGHT_PNG, type: "image/png" },
};

export function mailAssetRoutes() {
  return new Hono<AppEnv>().get(`${MAIL_ASSETS_PREFIX}/:file`, (c) => {
    const file = c.req.param("file");
    // `Object.hasOwn`: a plain lookup would find `constructor` / `toString` on the prototype.
    const asset = Object.hasOwn(ASSETS, file) ? ASSETS[file] : undefined;
    if (!asset) return errorResponse(c, 404, "not_found", "That asset does not exist.", false);
    return c.body(asset.bytes, 200, {
      "Content-Type": asset.type,
      "Cache-Control": "public, max-age=31536000, immutable",
    });
  });
}
