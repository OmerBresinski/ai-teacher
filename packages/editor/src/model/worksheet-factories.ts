// Moved to `@tj/slides` (ADR 0030 item 4): the worksheet block and sheet factories. Re-exported
// here so every `../model/worksheet-factories` import in the editor keeps resolving.
export {
  answerLinesForMarks,
  isNumbered,
  MAX_CRITERIA,
  newBlock,
  newWorksheet,
  numberQuestions,
  starterWorksheet,
  WORD_SEARCH_DEFAULT_SIZE,
  type WorksheetBlockType,
} from "@tj/slides/worksheet";
