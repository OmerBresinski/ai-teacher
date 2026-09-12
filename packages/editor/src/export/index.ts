/**
 * `@tj/editor/export` — the export dialog and the pure export helpers (ADR 0023). E1: PDF via the
 * print routes and JSON; E2 (PPTX, PNG) and E3 (DOCX) add their modules here behind `import()`.
 */

export { downloadBlob } from "./download";
export { ExportControl, type ExportControlProps, type ExportFormat } from "./ExportControl";
export {
  documentJsonBlob,
  downloadLessonJSON,
  downloadWorksheetJSON,
  lessonFilename,
  readDocumentFile,
  readLessonFile,
  readWorksheetFile,
  slugify,
  worksheetFilename,
} from "./json";
export { CAPTURE_READY_ATTR, waitForSlidePaint } from "./paint";
export {
  type PrintLayout,
  type PrintViewOptions,
  printViewHref,
  worksheetPrintHref,
} from "./pdf";
export { ALL_SLIDES, parseSlideRange, type SlideRangeResult, slideRangeParam } from "./range";
