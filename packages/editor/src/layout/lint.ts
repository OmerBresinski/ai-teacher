/**
 * Text fitting engine — the linter. Moved to `@tj/slides` (`lint.ts`) so generation's planning
 * and save gate (`fitsPlanned`) and the editor's Tidy measure with one ruler; re-exported here so
 * every `./lint` import in the editor keeps resolving.
 */
export {
  findLaneOverflow,
  findOverflow,
  findOverlaps,
  findStruckThrough,
  isBleed,
  isDecorative,
  isOffSlide,
  lintAsDrawn,
  lintSlide,
  type OverlapPair,
  type SlideLint,
} from "@tj/slides";
