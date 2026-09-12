import { createContext, type ReactNode, useContext } from "react";
import { resolveImageSrc } from "./resolve-src";

/**
 * The api origin stored `/files/<key>` pictures are loaded from (TEACH-275). One ambient input for
 * the whole tree, provided once by each entry (`LessonEditor`, `LessonViewer`, `LessonPrint`,
 * `SlideStatic`, `WorksheetEditor`, `WorksheetPrint`, the export stage) from its `imageOrigin`
 * prop, and read where an `<img>` is written. A context rather than a prop because sixteen
 * components mount a slide and none of them has any other reason to know about pictures; a
 * static string, never document state (ADR 0022 §4).
 */
const ImageOriginContext = createContext<string | undefined>(undefined);

export function ImageOriginProvider({
  origin,
  children,
}: {
  origin: string | undefined;
  children: ReactNode;
}) {
  // An entry mounted without an origin (tests, a nested provider) inherits the one above it.
  const inherited = useContext(ImageOriginContext);
  return (
    <ImageOriginContext.Provider value={origin ?? inherited}>
      {children}
    </ImageOriginContext.Provider>
  );
}

export const useImageOrigin = () => useContext(ImageOriginContext);

/** `src` as the browser should load it: the stored path resolved against the ambient origin. */
export function useResolvedImageSrc(src: string): string {
  return resolveImageSrc(src, useImageOrigin());
}
