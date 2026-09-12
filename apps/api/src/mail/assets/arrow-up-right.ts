/**
 * The magic-link button arrow (thin long shaft, short arms; white on transparent), 32px at 3x.
 * Embedded as base64 because the production image ships only the `bun build` bundle
 * (`Dockerfile`: `apps/api/dist`), so a file next to the source would not be there at runtime.
 *
 * Source SVG (re-render with Chrome at deviceScaleFactor 3 if it changes):
 *   <svg viewBox="0 0 32 32" fill="none" stroke="#fff" stroke-width="1.6"
 *        stroke-linecap="round" stroke-linejoin="round">
 *     <path d="M5 27 27 5"/><path d="M18.5 5H27v8.5"/></svg>
 */
const ARROW_UP_RIGHT_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAAC5UlEQVR4nOydTWoVQRSF7wtOnDp2A4LoEpKxZgWCS9AdiBFX4BYU3IEZZ+ZcBDfg2KnDl1uhLzRNJ69/bvepuvd8UDTkhQzOd7q6U130OxMC5UwIFAoAQwFgKAAMBYChADAUAIYCwFAAGAoAQwFgHklgjsfjhR4uZFue6/hzOBw+yAIOEhAN/koPH2VffqmElzITTkF+vFDxn2UmUaegc8HwTGYS9Qz4JBh+y0xCngE6F9+UQ3ct8OKxjjc6noojoe+CVMSVOKAin+jhiziHXwgtwIMu/K86XssG8C7oAbrwy+3sWPh/xQEKuIde89+PfHyt47s4QAEjdOG/k/Hml/Df6vgvDvAaMODEnH8Xvl7c/+nviQcU0GNK80v44ggFdExtvjhDAYJpvpFeAKr5RmoByOYbaQWgm2+kFFBD8410AmppvpFKQE3NN9IIONH8nwIIv5BiLWhC8y8R4RfCnwG1zflDou8Lqm7OHxJWQO3NN0IKaKH5RjgBrTTfCHUXtHPzb8SBMHtDEc0/Dh6L6d+fnWeIKQg459sOvHNZuBuv+TOgtTl/SNNnQEt3O/fRrIDWm280KaALv2yYajr8QnMCuvC/6Xg18nFT4ReaEtBrfojwC80IiNZ8owkBEZtvVC8gavONqgVEbr5RrYDozTeqFJCh+UZ1ArI036hKQKbmG9UIyNZ8owoBGZtvwAVkbb4BFZC5+QZMQJT1/LVABERaz1/L7gKyz/lDdhXQm3YYfsduuyIm7M+/zBZ+YZedcRMuuCnDL2w+BfFu52E2FcDwT7OZAIY/jU0EMPzpuAtg+PNwFcDw5+MmgOEvw0UAw1/OagEMfx2rBDD89SwWwPB9WCSA4fuxaDVUBfwQLim7MPsM0PDLK9zHwoe98qVlvP4PSLuev5bZzwM05PLS6uvej1Kv569l8ROxbioyIWQhIb/GqiX4+nowFACGAsBQABgKAEMBYCgADAWAoQAwFACGAsDcAgAA///OCqYyAAAABklEQVQDADhrl4AUxwAcAAAAAElFTkSuQmCC";

/** Decoded once at import; an `ArrayBuffer` because that is what `c.body()` accepts. */
export const ARROW_UP_RIGHT_PNG: ArrayBuffer = Uint8Array.from(
  atob(ARROW_UP_RIGHT_PNG_BASE64),
  (ch) => ch.charCodeAt(0),
).buffer as ArrayBuffer;
