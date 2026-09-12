/**
 * `@tj/editor/export` — the export dialog and the pure export helpers (ADR 0023). PDF via the print
 * routes and JSON are direct; PPTX, PNG and DOCX are click-loaded behind `import()`.
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
export { docToRuns, type Run, type RunParagraph, runsToText } from "./runs";
// `./pptx`, `./png` and `./docx` are deliberately not re-exported: they are reached only through
// `await import()` from `ExportControl`, so pptxgenjs, modern-screenshot and docx stay out of every
// route chunk (ADR 0023 §4).
