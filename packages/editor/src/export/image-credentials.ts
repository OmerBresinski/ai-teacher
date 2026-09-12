/**
 * The `credentials` mode for fetching an image `src` (TEACH-272 §1; ADR 0023 amendment
 * 2026-09-12). Every stored image is `/files/:key` on the api origin behind the session cookie, so
 * that origin gets `include`; any other URL (an imported document's foreign picture) gets `omit` —
 * our cookie must not go to a third party, and CORS would refuse `include` there anyway. The api
 * origin reaches the exporters as a prop (`imageOrigin`), never from the environment (ADR 0022).
 * Shared by the PPTX and PNG exporters; E3's DOCX joins them.
 */
export function imageCredentials(src: string, imageOrigin: string | undefined): RequestCredentials {
  return imageOrigin && src.startsWith(imageOrigin) ? "include" : "omit";
}
