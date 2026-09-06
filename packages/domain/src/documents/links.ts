/*
 * Link addresses (ADR 0021). Only `normaliseHref` lives here: the schema uses it to refuse an
 * image `creditUrl` an imported document could carry. The doc-walking link helpers stay with
 * the editor. Behavioural reference: TeachDeck `lib/text/links.ts:16-53`.
 */

/** Schemes a slide may link to. Anything else (`javascript:`, `data:`) is refused. */
const ALLOWED = ["http:", "https:", "mailto:"];

/** `head@school.sch.uk`, or several of those separated by commas. */
const EMAIL = /^[^\s@,]+@[^\s@,]+$/;

/**
 * A typed address as a URL, or null when it is not one. A teacher types `bbc.co.uk`, not
 * `https://bbc.co.uk`, so a bare host gets https. The text is otherwise kept verbatim:
 * `new URL().toString()` adds a trailing slash and re-encodes, and a link the teacher cannot
 * recognise in the field is worse.
 *
 * A slide has no site of its own to be relative to, so a path (`/handbook`) is not an address,
 * and neither is a scheme-relative `//host` — prepending https to either silently invents a
 * destination the teacher did not type. Both are refused rather than guessed at.
 */
export function normaliseHref(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (value.startsWith("/")) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  const protocol = url.protocol.toLowerCase();
  if (!ALLOWED.includes(protocol)) return null;
  if (protocol === "mailto:") {
    // `mailto:` on its own opens an empty message to nobody.
    const to = url.pathname.split(",");
    return to.length > 0 && to.every((address) => EMAIL.test(address)) ? withScheme : null;
  }
  if (!url.hostname) return null;
  return withScheme;
}

/** An address safe to hang off an `href`: http or https, nothing else. */
export const isLinkableHref = (value: string): boolean => {
  const href = normaliseHref(value);
  return href !== null && /^https?:/i.test(href);
};
