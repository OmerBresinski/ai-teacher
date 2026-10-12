import type { Theme } from "@tj/domain/documents";

/*
 * TEACH-310 part b: the drawn icon library (`@tj/slides/icons`, about 30 KB gz) is loaded on
 * demand, only when a slide holds an icon with a `concept`, so no route chunk pays for it
 * otherwise. Once loaded it stays: later renders draw synchronously.
 */
type IconsModule = typeof import("@tj/slides/icons");

let loading: Promise<IconsModule> | undefined;
let loaded: IconsModule | undefined;

export function loadIconLibrary(): Promise<IconsModule> {
  loading ??= import("@tj/slides/icons").then((m) => {
    loaded = m;
    return m;
  });
  return loading;
}

/** The library module if it has already loaded, else undefined. */
export const iconLibraryIfLoaded = (): IconsModule | undefined => loaded;

/** The concept's SVG for this theme at a drawn box of `boxPt`, or null when the library lacks it. */
export const libraryIconSvg = (
  icons: IconsModule,
  concept: string,
  theme: Theme,
  boxPt: number,
  px?: number,
): string | null => icons.iconSvgForTheme(concept, theme, boxPt, px);

export const svgDataUrl = (svg: string): string =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
