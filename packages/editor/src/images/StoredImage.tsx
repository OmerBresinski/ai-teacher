import type { ImgHTMLAttributes } from "react";
import { useResolvedImageSrc } from "./image-origin";

/**
 * An `<img>` for a stored picture: `src` is the document's value (normally `/files/<key>`,
 * TEACH-275) and the element loads it from the ambient api origin. Everything else passes through.
 * The one place worksheet blocks and the crop layer write an image tag; `ImageView` has its own
 * because it also measures the picture.
 */
export function StoredImage({
  src,
  alt = "",
  ...rest
}: ImgHTMLAttributes<HTMLImageElement> & { src: string }) {
  const resolved = useResolvedImageSrc(src);
  return <img src={resolved} alt={alt} {...rest} />;
}
