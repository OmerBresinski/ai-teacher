import { memo, type PointerEvent as ReactPointerEvent } from "react";
import { SheetMeta } from "./BlockContent";
import { SheetField } from "./EditableBlocks";
import { HEADER_KEY } from "./paginate";
import { setHeader, setTitle } from "./reducers";
import { useTypingSession, useWorksheet, useWorksheetHistoryApi } from "./worksheet-context";

/*
 * The page-1 header, typed into (TeachDeck `components/v2/worksheet/EditableHeader.tsx`). The
 * markup is `SheetHeader`'s — the printed one that the measuring column paginates from — with the
 * two texts (title, objective) replaced by `SheetField`s so nothing moves when the header is
 * selected. Every control that would add height — the name / date / class rules, the objective
 * line — lives in the `HeaderToolbar`, so the header on screen is always exactly the header the
 * paginator measured. The success criteria are typed into the self-assessment strip at the foot
 * (`EditableRagStrip`, TEACH-196), not here.
 *
 * The title on the sheet is `header.title` when the header carries one, else the document's
 * `title` (the library card, the tab); in that case `setTitle` writes both, so a teacher renaming
 * the sheet renames it everywhere.
 */

const HEADER_FIELDS = [
  ["showName", "Name", "ws-field-name"],
  ["showDate", "Date", "ws-field-date"],
  ["showClass", "Class", "ws-field-class"],
] as const;

export type EditableHeaderProps = {
  selected: boolean;
  onSelect: (event: ReactPointerEvent<HTMLElement>) => void;
  registerRef: (el: HTMLElement | null) => void;
};

export const EditableHeader = memo(function EditableHeader({
  selected,
  onSelect,
  registerRef,
}: EditableHeaderProps) {
  const worksheet = useWorksheet();
  const { dispatch } = useWorksheetHistoryApi();
  const typing = useTypingSession();
  const { header } = worksheet;
  const fields = HEADER_FIELDS.filter(([flag]) => header[flag]);

  const patchHeader = (patch: Partial<typeof header>) =>
    typing.run(() => dispatch(setHeader, patch));

  // A header with its own title (the demo sheet) edits that alone; otherwise the sheet shows the
  // document title and `setTitle` keeps the library and the paper together (the reducer's rule).
  const commitTitle = (title: string) =>
    typing.run(() =>
      header.title !== undefined ? dispatch(setHeader, { title }) : dispatch(setTitle, title),
    );

  return (
    <header
      ref={registerRef}
      className="ws-header ws-shell"
      data-block-id={HEADER_KEY}
      onPointerDown={onSelect}
    >
      {selected ? <div className="ws-selected-ring" /> : null}
      {fields.length > 0 ? (
        <>
          <div className="ws-header-fields">
            {fields.map(([flag, label, className]) => (
              <div key={flag} className={`ws-field ${className}`}>
                <span>{label}</span>
                <span className="ws-field-rule" />
              </div>
            ))}
          </div>
          <div className="ws-header-line" />
        </>
      ) : null}
      <h1 className="ws-title">
        <SheetField
          label="Sheet title"
          value={header.title ?? worksheet.title}
          onChange={commitTitle}
        />
      </h1>
      {/* Same rule as the printed header: the objective line exists once the toolbar adds it. */}
      {header.subtitle !== undefined ? (
        <p className="ws-objective">
          <SheetField
            label="Learning objective"
            value={header.subtitle}
            onChange={(subtitle) => patchHeader({ subtitle })}
          />
        </p>
      ) : null}
      <SheetMeta blocks={worksheet.blocks} showMarks={worksheet.showMarks} />
    </header>
  );
});
