import type { RichDoc, WorksheetBlock } from "@tj/domain/documents";
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useLayoutEffect,
  useRef,
} from "react";
import { isDocEmpty } from "../text/static";
import { matchingLetters, matchingOrder, optionLetter } from "./answers";
import { SheetText, type StemRenderer } from "./BlockContent";
import { setCorrectOption } from "./reducers";
import { useBlockWrites, useTypingSession, useWorksheetHistoryApi } from "./worksheet-context";

/**
 * Edit-mode variants of the blocks whose content is plain strings rather than rich text (TeachDeck
 * `components/v2/worksheet/EditableBlocks.tsx`). The markup matches the printed markup exactly —
 * only the text nodes become fields — so nothing moves when a block is selected, and the measured
 * height stays true. That contract has two halves, and `BlockContent` keeps the other: an empty
 * string prints as a no-break space (`fieldText`) where a `SheetField` holds `min-height: 1lh`, an
 * empty bank word prints 24pt wide (`.ws-word-empty`) where `.ws-input-inline` reserves 24pt, and
 * an optional label or caption exists on both sides only while it is defined.
 */

/**
 * A field typed straight onto the paper.
 *
 * It is a `contentEditable` span rather than an `<input>` so that a long option or table cell wraps
 * in the flow exactly as the printed `<div>` does: screen and the hidden measuring column then agree
 * about the block's height, and so about where the page breaks. `plaintext-only` keeps pasted
 * markup out.
 *
 * React never rewrites the DOM text while the teacher is typing — the layout effect writes only when
 * the node genuinely disagrees with the document — so the caret cannot jump.
 */
export function SheetField({
  value,
  onChange,
  label,
  className,
  style,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const typing = useTypingSession();

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && el.textContent !== value) el.textContent = value;
  }, [value]);

  const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    // One line of the sheet is one field; Enter finishes it rather than pushing a newline into a
    // string the printed markup would not honour.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.blur();
      return;
    }
    if (event.key === "Escape") event.currentTarget.blur();
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: an <input> cannot wrap in the printed flow; the measured height must match the paper (header comment)
    <span
      ref={ref}
      className={className ? `ws-input ${className}` : "ws-input"}
      style={style}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      role="textbox"
      tabIndex={0}
      aria-multiline="true"
      aria-label={label}
      spellCheck={false}
      onInput={(e) => onChange(e.currentTarget.textContent ?? "")}
      onKeyDown={onKeyDown}
      onBlur={typing.end}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}

/** Block types whose plain-string content is typed straight onto the sheet. */
export const INLINE_EDIT_TYPES: WorksheetBlock["type"][] = [
  "multiple-choice",
  "matching",
  "word-bank",
  "table",
  "answer-box",
  "image",
];

type Question = Extract<WorksheetBlock, { type: "question" }>;
type MC = Extract<WorksheetBlock, { type: "multiple-choice" }>;
type Matching = Extract<WorksheetBlock, { type: "matching" }>;
type WordBank = Extract<WorksheetBlock, { type: "word-bank" }>;
type TableBlock = Extract<WorksheetBlock, { type: "table" }>;
type AnswerBox = Extract<WorksheetBlock, { type: "answer-box" }>;
type ImageBlock = Extract<WorksheetBlock, { type: "image" }>;

/**
 * Returns the editable rendering for a block, or null when the printed one is already editable
 * (rich text) or has nothing to type into.
 */
export function EditableBlock({
  block,
  renderStem,
  selected = false,
  showAnswers = false,
}: {
  block: WorksheetBlock;
  /** The mounted editor for the rich-text run, when this block is the one being edited. */
  renderStem?: StemRenderer;
  /** The block is the selected one: a multiple-choice block shows its answer markers. */
  selected?: boolean;
  /** The top bar's "Show answers" (TEACH-195). */
  showAnswers?: boolean;
}): ReactNode | null {
  const { patch } = useBlockWrites();
  const { dispatch } = useWorksheetHistoryApi();
  const typing = useTypingSession();
  const stem = (doc: RichDoc, className: string, emptyLabel: string) => {
    if (renderStem) return renderStem({ doc, className });
    if (isDocEmpty(doc)) {
      return (
        <p className={className} style={{ margin: 0, color: "var(--ws-muted)" }} data-empty-hint>
          {emptyLabel}
        </p>
      );
    }
    return <SheetText doc={doc} className={className} />;
  };

  switch (block.type) {
    case "multiple-choice":
      return (
        <div className="ws-q">
          <div className="ws-q-no">{block.number}.</div>
          <div className="ws-q-main">
            <div className="ws-q-head">
              {stem(block.doc, "ws-q-stem", "Write your question here")}
            </div>
            <div className="ws-options">
              {block.options.map((option, i) => (
                <div key={option.id} className="ws-opt">
                  {/* The pupil's box, empty on screen as on paper (TEACH-195). */}
                  <div className="ws-opt-box" />
                  <div className="ws-opt-letter">{optionLetter(i)}</div>
                  <SheetField
                    className="ws-opt-text"
                    label={`Option ${optionLetter(i)}`}
                    value={option.text}
                    onChange={(text) =>
                      patch<MC>(block.id, (b) => {
                        const target = b.options.find((o) => o.id === option.id);
                        if (target) target.text = text;
                      })
                    }
                  />
                  {/* The answer marker: outside the printed markup, in the row's margin, and
                      absolutely positioned so the row keeps the height the paginator measured.
                      Exactly one option is correct: the reducer clears the others. */}
                  {selected || showAnswers ? (
                    <button
                      type="button"
                      className={
                        option.correct ? "ws-opt-answer ws-opt-answer-on" : "ws-opt-answer"
                      }
                      aria-pressed={option.correct}
                      aria-label={`Answer: option ${optionLetter(i)}`}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => {
                        typing.end();
                        dispatch(setCorrectOption, block.id, option.id);
                      }}
                    />
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      );

    case "matching": {
      const order = matchingOrder(block.id, block.pairs.length);
      const letters = matchingLetters(block.id, block.pairs.length);
      return (
        <div className="ws-q">
          <div className="ws-q-no">{block.number}.</div>
          <div className="ws-q-main">
            <div className="ws-match">
              <div className="ws-match-col">
                {block.pairs.map((pair, i) => (
                  <div key={pair.id} className="ws-match-row">
                    <SheetField
                      className="ws-match-term"
                      label="Term"
                      value={pair.left}
                      onChange={(left) =>
                        patch<Matching>(block.id, (b) => {
                          const target = b.pairs.find((p) => p.id === pair.id);
                          if (target) target.left = left;
                        })
                      }
                    />
                    <div className="ws-match-blank">
                      {/* The answer letter, inside the blank and out of flow (TEACH-195). */}
                      {showAnswers ? <span className="ws-match-answer">{letters[i]}</span> : null}
                    </div>
                  </div>
                ))}
              </div>
              <div className="ws-match-col">
                {order.map((pairIndex, position) => {
                  const pair = block.pairs[pairIndex];
                  if (!pair) return null;
                  return (
                    <div key={pair.id} className="ws-match-row">
                      <div className="ws-match-letter">{optionLetter(position)}</div>
                      <SheetField
                        className="ws-match-term"
                        label={`Match ${optionLetter(position)}`}
                        value={pair.right}
                        onChange={(right) =>
                          patch<Matching>(block.id, (b) => {
                            const target = b.pairs.find((p) => p.id === pair.id);
                            if (target) target.right = right;
                          })
                        }
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      );
    }

    case "word-bank":
      return (
        <div>
          <div className="ws-wordbank-label">Word bank</div>
          <div className="ws-wordbank">
            {block.words.map((word, i) => (
              <SheetField
                // biome-ignore lint/suspicious/noArrayIndexKey: the words are positional strings; the field at index i edits index i
                key={i}
                className="ws-input-inline"
                label={`Word ${i + 1}`}
                value={word}
                onChange={(next) =>
                  patch<WordBank>(block.id, (b) => {
                    b.words[i] = next;
                  })
                }
              />
            ))}
          </div>
        </div>
      );

    case "table":
      return (
        <table className="ws-table">
          {block.header ? (
            <thead>
              <tr>
                {block.rows[0]?.map((cell, c) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: table cells are positional; a `string[][]` has no ids
                  <th key={c}>
                    <SheetField
                      label={`Column ${c + 1} heading`}
                      value={cell}
                      onChange={(next) =>
                        patch<TableBlock>(block.id, (b) => {
                          const row = b.rows[0];
                          if (row) row[c] = next;
                        })
                      }
                    />
                  </th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody>
            {block.rows.slice(block.header ? 1 : 0).map((row, r) => {
              const rowIndex = r + (block.header ? 1 : 0);
              return (
                <tr key={rowIndex}>
                  {row.map((cell, c) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: table cells are positional; a `string[][]` has no ids
                    <td key={c}>
                      <SheetField
                        label={`Row ${rowIndex + 1}, column ${c + 1}`}
                        value={cell}
                        onChange={(next) =>
                          patch<TableBlock>(block.id, (b) => {
                            const target = b.rows[rowIndex];
                            if (target) target[c] = next;
                          })
                        }
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      );

    case "answer-box":
      // The label exists (and takes its line) only once the toolbar has added it — the same
      // condition `BlockContent` prints and the measuring column paginates from.
      return (
        <div>
          {block.label !== undefined ? (
            <SheetField
              className="ws-answerbox-label"
              label="Answer box label"
              value={block.label}
              onChange={(label) =>
                patch<AnswerBox>(block.id, (b) => {
                  b.label = label;
                })
              }
            />
          ) : null}
          <div className="ws-answerbox" style={{ height: `${block.heightPt}pt` }} />
        </div>
      );

    case "image":
      return (
        <figure className="ws-figure" style={{ width: `${block.widthPct}%` }}>
          <img src={block.src} alt={block.alt ?? ""} />
          {block.caption !== undefined ? (
            <figcaption className="ws-caption">
              <SheetField
                label="Caption"
                value={block.caption}
                onChange={(caption) =>
                  patch<ImageBlock>(block.id, (b) => {
                    b.caption = caption;
                  })
                }
              />
            </figcaption>
          ) : null}
        </figure>
      );

    default:
      return null;
  }
}

/**
 * A question block's model answer, shown and edited on the sheet while "Show answers" is on
 * (TEACH-195). The slot is zero height and the answer is drawn over the first ruled line, so the
 * row measures as the printed one and the page breaks stay where they are. The key prints
 * "No answer recorded." for a blank; here the blank reads "No answer yet".
 */
export function QuestionAnswer({ block }: { block: Question }) {
  const { patch } = useBlockWrites();
  const answer = block.answer ?? "";
  return (
    <div
      className="ws-answer-slot"
      data-answer-view
      data-reserve={block.answerLines === 0 ? "" : undefined}
    >
      <div className="ws-answer">
        <span className="ws-answer-label" aria-hidden>
          Answer
        </span>
        <span className="ws-answer-field">
          <SheetField
            className="ws-answer-text"
            label="Model answer"
            value={answer}
            onChange={(next) =>
              patch<Question>(block.id, (b) => {
                b.answer = next || undefined;
              })
            }
          />
          {answer ? null : (
            <span className="ws-answer-empty" aria-hidden>
              No answer yet
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

/** The rich-text doc of a block that carries one, for callers holding the union. */
export const docOf = (block: WorksheetBlock): RichDoc | undefined =>
  "doc" in block ? block.doc : undefined;
