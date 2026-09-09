/** Sheet-level reducers: title, header, theme, answer key, paper, self-assessment. */

import { MAX_CRITERIA, type PageSize, type Worksheet } from "@tj/domain/documents";
import { edit } from "./core";

/** Renames the sheet and, when the header carries its own title, that too. */
export const setTitle = (worksheet: Worksheet, title: string): Worksheet =>
  edit(worksheet, (w) => {
    w.title = title;
    if (w.header.title !== undefined) w.header.title = title;
  });

/**
 * Patch the header. The schema caps the criteria at four; clamped here too, or a patch that sets
 * five would write a document that will not load.
 */
export const setHeader = (worksheet: Worksheet, patch: Partial<Worksheet["header"]>): Worksheet =>
  edit(worksheet, (w) => {
    Object.assign(w.header, patch);
    const list = w.header.criteria;
    if (list && list.length > MAX_CRITERIA) w.header.criteria = list.slice(0, MAX_CRITERIA);
  });

export const setTheme = (worksheet: Worksheet, themeId: string): Worksheet =>
  edit(worksheet, (w) => {
    w.themeId = themeId;
  });

export const setIncludeAnswerKey = (worksheet: Worksheet, include: boolean): Worksheet =>
  edit(worksheet, (w) => {
    w.includeAnswerKey = include;
  });

/** UX ruling 60: the per-sheet marks switch. Off is stored as `false`, never unset again. */
export const setShowMarks = (worksheet: Worksheet, on: boolean): Worksheet =>
  edit(worksheet, (w) => {
    w.showMarks = on;
  });

export const setPageSize = (worksheet: Worksheet, size: PageSize): Worksheet =>
  edit(worksheet, (w) => {
    w.pageSize = size;
  });
