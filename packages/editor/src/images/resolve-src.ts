/**
 * Where a stored picture lives (TEACH-275; ADR 0026 amendment 2026-09-12).
 *
 * A document stores its own files as the api path `/files/<key>` and nothing more: the api origin
 * changes with the deployment, so it is a render-time input (`imageOrigin`, threaded as a prop —
 * `@tj/editor` never reads the environment, ADR 0022), never data. Documents written before this
 * rule carry the absolute form `<origin>/files/<key>`; both are "ours" and both resolve.
 */

const FILES_PREFIX = "/files/";

const trimSlash = (origin: string) => origin.replace(/\/+$/, "");

/** Whether `src` is one of our stored files, relative or absolute on `imageOrigin`. */
export function isOwnFile(src: string, imageOrigin: string | undefined): boolean {
  if (src.startsWith(FILES_PREFIX)) return true;
  if (!imageOrigin) return false;
  // A path boundary, so `https://api.example` does not also match `https://api.example.evil`.
  return src.startsWith(`${trimSlash(imageOrigin)}${FILES_PREFIX}`);
}

/**
 * The URL to load `src` from. A relative `/files/` path is prefixed with `imageOrigin` (in dev the
 * Vite proxy path `/api`, so `/api/files/<key>`); anything else — a data URL, a third party's
 * picture, an already-absolute legacy src — is returned as it is. Without an origin the path is
 * returned bare, which is right for same-origin tests and wrong nowhere that matters.
 */
export function resolveImageSrc(src: string, imageOrigin: string | undefined): string {
  if (!imageOrigin || !src.startsWith(FILES_PREFIX)) return src;
  return `${trimSlash(imageOrigin)}${src}`;
}
