import { IconButton } from "@tj/ui";
import { X } from "lucide-react";
import { memo, useEffect, useRef } from "react";
import { RagStrip } from "./BlockContent";
import { SheetField } from "./EditableBlocks";
import { RAG_KEY } from "./paginate";
import { pruneEmptyCriteria, removeCriterion, setCriterion } from "./reducers";
import { useTypingSession, useWorksheet, useWorksheetHistoryApi } from "./worksheet-context";

/*
 * The self-assessment strip, typed into (TEACH-196). The markup is `RagStrip`'s — the printed one
 * the measuring column paginates from — with each criterion's text replaced by a `SheetField`, so
 * the strip on screen is exactly the strip the paginator measured. The per-criterion remove button
 * is out of flow and shows while the pointer or focus is in the strip; a new line comes from the
 * "Criterion" button beside the Self-assessment switch in the header toolbar.
 */

export const CRITERION_PLACEHOLDER = "I can …";

export const EditableRagStrip = memo(function EditableRagStrip() {
  const worksheet = useWorksheet();
  const { dispatch } = useWorksheetHistoryApi();
  const typing = useTypingSession();
  const criteria = worksheet.header.criteria ?? [];
  const rootRef = useRef<HTMLDivElement | null>(null);
  const seen = useRef(0);

  // A line the teacher just added (the switch going on, or the Criterion button) takes the caret,
  // so they type straight into it. Only a fresh blank line is focused: a sheet that opens with its
  // criteria filled in is left alone.
  useEffect(() => {
    if (criteria.length > seen.current) {
      const blank = criteria.indexOf("");
      if (blank >= 0) {
        rootRef.current?.querySelectorAll<HTMLElement>(".ws-criterion-text")[blank]?.focus();
      }
    }
    seen.current = criteria.length;
  }, [criteria]);

  // Blank criteria print as a bare checkbox: when focus leaves the strip altogether they go.
  const onBlurCapture = (e: React.FocusEvent<HTMLElement>) => {
    const next = e.relatedTarget as Node | null;
    if (next && rootRef.current?.contains(next)) return;
    typing.end();
    dispatch(pruneEmptyCriteria);
  };

  return (
    <div
      ref={rootRef}
      className="ws-block ws-rag-slot"
      data-block-id={RAG_KEY}
      onBlurCapture={onBlurCapture}
    >
      <RagStrip criteria={criteria}>
        <ul className="ws-criteria">
          {criteria.map((text, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: criteria are positional strings; the field at index i edits index i
            <li key={i} className="ws-criterion">
              <span className="ws-criterion-box" aria-hidden />
              <SheetField
                className="ws-criterion-text"
                label={`Success criterion ${i + 1}`}
                value={text}
                onChange={(next) => typing.run(() => dispatch(setCriterion, i, next))}
              />
              {text === "" ? (
                <span className="ws-criterion-placeholder" aria-hidden>
                  {CRITERION_PLACEHOLDER}
                </span>
              ) : null}
              <IconButton
                label={`Remove criterion ${i + 1}`}
                size="sm"
                className="ws-criterion-remove"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => {
                  typing.end();
                  dispatch(removeCriterion, i);
                }}
              >
                <X size={12} strokeWidth={1.5} aria-hidden />
              </IconButton>
            </li>
          ))}
        </ul>
      </RagStrip>
    </div>
  );
});
