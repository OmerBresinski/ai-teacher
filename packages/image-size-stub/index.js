/**
 * `image-size`, stubbed (see package.json). pptxgenjs calls it only when `addImage` is given a
 * file `path` under Node; the browser export hands it data URLs, so this is never reached.
 */
const unreachable = () => {
  throw new Error(
    "image-size is stubbed out (@tj/image-size-stub): pptxgenjs's file-path branch is not supported.",
  );
};
export const imageSize = unreachable;
export const imageSizeFromFile = unreachable;
export default unreachable;
