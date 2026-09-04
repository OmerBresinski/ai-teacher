/**
 * `VITE_API_URL` may be relative in development (`/api`, served by the Vite proxy). better-auth's
 * client requires an absolute `baseURL`, so resolve against the page origin. Absolute values pass
 * through unchanged; a trailing slash is dropped either way.
 */
export function resolveApiBaseUrl(value: string, origin: string): string {
  const url = new URL(value, origin).toString();
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
