/*
 * Vercel Edge Function (TEACH-33 part b): the visitor's country as Vercel's edge geolocates it,
 * as an ISO hint ("IN", or "GB-SCT" for the UK nations). The SPA posts it to the API once for a
 * new account (`POST /me/settings/country-hint`). The address is never read or returned; only
 * Vercel's country and region codes are. Served before the SPA rewrite in `vercel.json`, since
 * functions take precedence over rewrites. In `vite dev` the path proxies to the API and 404s,
 * so a local account stays England.
 */
export const config = { runtime: "edge" };

/** "GB" + "SCT" → "GB-SCT"; any other country alone; nothing without a country. */
export function geoHint(headers: Headers): string | null {
  const country = headers.get("x-vercel-ip-country")?.trim().toUpperCase();
  if (!country) return null;
  const region = headers.get("x-vercel-ip-country-region")?.trim().toUpperCase();
  return country === "GB" && region ? `GB-${region}` : country;
}

export default function handler(request: Request): Response {
  return Response.json(
    { hint: geoHint(request.headers) },
    { headers: { "cache-control": "private, no-store" } },
  );
}
