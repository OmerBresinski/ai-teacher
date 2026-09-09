import { normaliseQuery } from "./query";

/**
 * Query blocklist (Images project, "Safety").
 *
 * Checked before every Pexels call (the api search route and the pipeline's illustrate step).
 * Deliberately short and unambiguous: words with legitimate classroom uses (`sex`, `nude`,
 * `murder`, `suicide`, `drugs`, `gun`) are NOT here — a false positive costs a teacher a
 * search, and Pexels' own moderation covers the rest. To extend: append lower-case single
 * words or short phrases; matching is whole-word, so substrings never hit.
 */
export const QUERY_BLOCKLIST: readonly string[] = [
  "porn",
  "pornography",
  "xxx",
  "hentai",
  "erotic",
  "fetish",
  "bdsm",
  "orgy",
  "bestiality",
  "rape",
  "incest",
  "gore",
  "torture",
];

/** True when the normalised query contains a blocklisted term as a whole word or phrase. */
export function isBlockedQuery(query: string): boolean {
  const normalised = ` ${normaliseQuery(query)} `;
  return QUERY_BLOCKLIST.some((term) => normalised.includes(` ${term} `));
}
