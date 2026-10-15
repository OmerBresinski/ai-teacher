import type { Theme } from "@tj/domain/documents";

/**
 * The installed face PowerPoint shows for a theme face the file does not embed (UX ruling 213),
 * measured in the theme v2 pilot against one sentence. Each is as wide or narrower, so text never
 * overflows its box; never Verdana for Lexend (+5%). Keyed by family, then role; written into a
 * v2 deck by `withFallbackFaces` below. It lives here, not in `pptx.ts`, so this click-loaded
 * module never imports the exporter statically (ADR 0023 §4, ADR 0028).
 */
export const PPTX_FALLBACK_FACE: Record<
  string,
  { body: string; display: string; italic?: string }
> = {
  // +1%, and it keeps the single-storey a and g.
  Andika: { body: "Comic Sans MS", display: "Comic Sans MS" },
  // Body -6%, display -10%.
  Lexend: { body: "Trebuchet MS", display: "Arial Bold" },
  // -3%.
  "Schibsted Grotesk": { body: "Arial", display: "Arial Bold" },
  // Italic +1%: the v2 quote voice.
  "Source Serif 4": { body: "Georgia", display: "Georgia", italic: "Georgia Italic" },
};

/*
 * Fallback faces in the written file (UX ruling 213, TEACH-152 part b). OOXML names one typeface
 * per run and PowerPoint substitutes its own choice when that face is missing, so a v2 deck opened
 * without Andika, Lexend, Schibsted Grotesk or Source Serif 4 would show Arial or Calibri. For a
 * face the file does not embed, the run names the measured fallback instead: the display face for
 * a bold run, the italic face for an italic one, the body face otherwise. Only v2 themes are
 * remapped, so the v1 themes' exports stay byte for byte as they were. Nothing embeds fonts yet,
 * so every v2 face is remapped.
 */

/** "Arial Bold" and "Georgia Italic" are styles of a family: the run's b/i attributes carry them. */
const familyOf = (face: string): string => face.replace(/ (Bold|Italic)$/, "");

/** The face a run of `family` names when the file does not embed it. */
export function fallbackFaceFor(
  family: string,
  run: { bold?: boolean; italic?: boolean },
): string | undefined {
  const fb = PPTX_FALLBACK_FACE[family];
  if (!fb) return undefined;
  if (run.italic && fb.italic) return familyOf(fb.italic);
  return familyOf(run.bold ? fb.display : fb.body);
}

const RUN_PROPS = /<a:(rPr|endParaRPr|defRPr)\b([^>]*?)(\/>|>([\s\S]*?)<\/a:\1>)/g;

/** One slide part's XML with every v2 face swapped for its fallback. */
export function withFallbackFacesXml(xml: string) {
  return xml.replace(
    RUN_PROPS,
    (whole, _tag: string, attrs: string, _end: string, body?: string) => {
      if (!body) return whole;
      const run = { bold: /\bb="1"/.test(attrs), italic: /\bi="1"/.test(attrs) };
      return whole.replace(/typeface="([^"]+)"/g, (t, family: string) => {
        const face = fallbackFaceFor(family, run);
        return face ? `typeface="${face}"` : t;
      });
    },
  );
}

/** The written deck with fallback faces in every slide, for a v2 theme; any other theme as is. */
export async function withFallbackFaces(buffer: ArrayBuffer, theme: Theme): Promise<ArrayBuffer> {
  if (!theme.v2) return buffer;
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(buffer);
  const parts = Object.keys(zip.files).filter((p) =>
    /^ppt\/(slides|slideLayouts|slideMasters)\/[^/]+\.xml$/.test(p),
  );
  for (const path of parts) {
    const file = zip.file(path);
    if (!file) continue;
    zip.file(path, withFallbackFacesXml(await file.async("string")));
  }
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}
