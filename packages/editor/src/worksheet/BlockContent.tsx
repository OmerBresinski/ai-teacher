import type { RichDoc, Worksheet, WorksheetBlock } from "@tj/domain/documents";
import type { CSSProperties, ReactNode } from "react";
import { RichText } from "../slide/elements/RichText";
import { escapeHtml, isDocEmpty, renderDocHTML } from "../text/static";
import { type AnswerEntry, matchingOrder, optionLetter } from "./answers";
import { sheetSummary } from "./metrics";
import { WordSearchView } from "./WordSearch";

/**
 * The sheet itself (TeachDeck `components/worksheet/BlockContent.tsx`): one static renderer per
 * block type, shared by the editor, the hidden measuring column and the print route, so what a
 * teacher sees on screen is exactly what comes out of the printer.
 */

export type SheetMode = "edit" | "print";

/**
 * Lets the editor swap the one rich-text run of a block for the mounted Tiptap editor, keeping the
 * number, marks and ruled lines exactly where they were.
 */
export type StemRenderer = (args: { doc: RichDoc; className?: string }) => ReactNode;

/**
 * The editor's "Show answers" view for a question block (TEACH-195): the model answer under the
 * stem, with the field that edits it. Injected by `BlockShell`, so this static renderer — shared
 * with the print route and the measuring column — never imports the editing pieces.
 */
export type AnswerRenderer = (block: Extract<WorksheetBlock, { type: "question" }>) => ReactNode;

/** Static rich text on the sheet: `RichText` (the slide's static path) under the `ws-rt` rules. */
export function SheetText({
  doc,
  className,
  html,
  style,
}: {
  doc?: RichDoc;
  className?: string;
  html?: string;
  style?: CSSProperties;
}) {
  return (
    <RichText
      doc={doc}
      html={html}
      style={style}
      className={className ? `ws-rt ${className}` : "ws-rt"}
    />
  );
}

function Lines({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <div className="ws-lines">
      {Array.from({ length: count }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: ruled lines are positional and identical
        <div key={i} className="ws-line" />
      ))}
    </div>
  );
}

const marksLabel = (marks: number) => `(${marks} ${marks === 1 ? "mark" : "marks"})`;

/**
 * A plain-string field of the sheet as printed. An empty one still holds its line (a no-break
 * space), because the editor's `SheetField` holds one too (`min-height: 1lh`) — the measuring
 * column renders this markup, so the two must agree on every height or the page breaks the
 * teacher sees would not be the ones the printer makes.
 */
export const fieldText = (text: string | undefined) => text || "\u00a0";

/** An empty word in the bank keeps the 24pt the editor's field reserves, for the same reason. */
function BankWord({ word }: { word: string }) {
  return word ? <span>{word}</span> : <span className="ws-word-empty">{"\u00a0"}</span>;
}

/**
 * Blanks are sized to the answer, as on a printed cloze exercise. With the answers view on, the
 * answer sits inside its blank, out of flow (`.ws-gap-answer`), so the line keeps its height.
 */
function gapMarkup(block: Extract<WorksheetBlock, { type: "fill-gap" }>, showAnswers = false) {
  return renderDocHTML(block.doc).replace(/\[\[gap:([A-Za-z0-9_-]+)\]\]/g, (_match, id: string) => {
    const gap = block.gaps.find((g) => g.id === id);
    const width = Math.max(56, Math.round((gap?.answer.length ?? 8) * 6.4));
    const answer =
      showAnswers && gap?.answer
        ? `<span class="ws-gap-answer">${escapeHtml(gap.answer)}</span>`
        : "";
    return `<span class="ws-gap" style="width:${width}pt">${answer}</span>`;
  });
}

function EmptyHint({
  mode,
  label,
  className,
}: {
  mode: SheetMode;
  label: string;
  className?: string;
}) {
  if (mode === "print") {
    return (
      <p className={className} style={{ margin: 0 }}>
        &nbsp;
      </p>
    );
  }
  return (
    <p className={className} style={{ margin: 0, color: "var(--ws-muted)" }} data-empty-hint>
      {label}
    </p>
  );
}

function QuestionRow({ number, children }: { number?: number; children: ReactNode }) {
  return (
    <div className="ws-q">
      <div className="ws-q-no">{number}.</div>
      <div className="ws-q-main">{children}</div>
    </div>
  );
}

export function BlockContent({
  block,
  mode,
  renderStem,
  showAnswers = false,
  renderAnswer,
  showMarks = false,
}: {
  block: WorksheetBlock;
  mode: SheetMode;
  renderStem?: StemRenderer;
  /** The editor's answers view (TEACH-195). Edit mode only: print and the measuring column never pass it. */
  showAnswers?: boolean;
  renderAnswer?: AnswerRenderer;
  /** `Worksheet.showMarks`: the "(2 marks)" label prints only when the sheet counts marks. */
  showMarks?: boolean;
}) {
  const rich = (doc: RichDoc, className?: string, emptyLabel?: string) => {
    if (renderStem) return renderStem({ doc, className });
    if (emptyLabel && isDocEmpty(doc)) {
      return <EmptyHint mode={mode} label={emptyLabel} className={className} />;
    }
    return <SheetText doc={doc} className={className} />;
  };

  switch (block.type) {
    case "heading":
      return rich(block.doc, block.level === 1 ? "ws-h1" : "ws-h2", "Heading");

    case "paragraph":
      return rich(block.doc, undefined, "Type / to add a block");

    case "instructions":
      return rich(block.doc, "ws-instructions", "Instructions for the task");

    case "question":
      return (
        <QuestionRow number={block.number}>
          <div className="ws-q-head">
            {rich(block.doc, "ws-q-stem", "Write your question here")}
            {showMarks && block.marks ? (
              <div className="ws-marks">{marksLabel(block.marks)}</div>
            ) : null}
          </div>
          {showAnswers && renderAnswer ? renderAnswer(block) : null}
          <Lines count={block.answerLines} />
        </QuestionRow>
      );

    case "multiple-choice":
      return (
        <QuestionRow number={block.number}>
          <div className="ws-q-head">
            {rich(block.doc, "ws-q-stem", "Write your question here")}
          </div>
          <div className="ws-options">
            {block.options.map((option, i) => (
              <div key={option.id} className="ws-opt">
                <div className="ws-opt-box" />
                <div className="ws-opt-letter">{optionLetter(i)}</div>
                <div className="ws-opt-text">{fieldText(option.text)}</div>
              </div>
            ))}
          </div>
        </QuestionRow>
      );

    case "fill-gap":
      return (
        <QuestionRow number={block.number}>
          {renderStem ? (
            renderStem({ doc: block.doc })
          ) : (
            <SheetText html={gapMarkup(block, showAnswers)} />
          )}
        </QuestionRow>
      );

    case "matching": {
      const order = matchingOrder(block.id, block.pairs.length);
      return (
        <QuestionRow number={block.number}>
          <div className="ws-match">
            <div className="ws-match-col">
              {block.pairs.map((pair) => (
                <div key={pair.id} className="ws-match-row">
                  <div className="ws-match-term">{fieldText(pair.left)}</div>
                  <div className="ws-match-blank" />
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
                    <div className="ws-match-term">{fieldText(pair.right)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </QuestionRow>
      );
    }

    case "word-search":
      return (
        <QuestionRow number={block.number}>
          <WordSearchView block={block} rings={showAnswers} />
        </QuestionRow>
      );

    case "word-bank":
      return (
        <div>
          <div className="ws-wordbank-label">Word bank</div>
          <div className="ws-wordbank">
            {block.words.map((word, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: the same word may appear twice; position is the identity
              <BankWord key={`${word}-${i}`} word={word} />
            ))}
          </div>
        </div>
      );

    case "answer-box":
      return (
        <div>
          {block.label !== undefined ? (
            <div className="ws-answerbox-label">{fieldText(block.label)}</div>
          ) : null}
          <div className="ws-answerbox" style={{ height: `${block.heightPt}pt` }} />
        </div>
      );

    case "lines":
      return <Lines count={block.count} />;

    case "image":
      return (
        <figure className="ws-figure" style={{ width: `${block.widthPct}%` }}>
          <img src={block.src} alt={block.alt ?? ""} />
          {block.caption !== undefined ? (
            <figcaption className="ws-caption">{fieldText(block.caption)}</figcaption>
          ) : null}
        </figure>
      );

    case "table":
      return (
        <table className="ws-table">
          {block.header ? (
            <thead>
              <tr>
                {block.rows[0]?.map((cell, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: table cells are positional; a `string[][]` has no ids
                  <th key={i}>{fieldText(cell)}</th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody>
            {block.rows.slice(block.header ? 1 : 0).map((row, r) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: table cells are positional; a `string[][]` has no ids
              <tr key={r}>
                {row.map((cell, c) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: table cells are positional; a `string[][]` has no ids
                  <td key={c}>{fieldText(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );

    case "divider":
      return <div className="ws-divider" />;

    case "page-break":
      return mode === "edit" ? <div className="ws-pagebreak">Page break</div> : null;
  }
}

/* ------------------------------------------------------------------ */
/* Header strip and answer key                                         */
/* ------------------------------------------------------------------ */

const HEADER_FIELDS = [
  ["showName", "Name", "ws-field-name"],
  ["showDate", "Date", "ws-field-date"],
  ["showClass", "Class", "ws-field-class"],
] as const;

export function SheetHeader({ worksheet }: { worksheet: Worksheet }) {
  const { header } = worksheet;
  const fields = HEADER_FIELDS.filter(([flag]) => header[flag]);
  return (
    <header className="ws-header">
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
      <h1 className="ws-title">{header.title || worksheet.title}</h1>
      {header.subtitle !== undefined ? (
        <p className="ws-objective">{header.subtitle || "\u00a0"}</p>
      ) : null}
      <SheetMeta blocks={worksheet.blocks} showMarks={worksheet.showMarks} />
      <CriteriaList criteria={header.criteria} />
    </header>
  );
}

/** Success criteria, one printed checkbox line each (research/02 decision 15). */
export function CriteriaList({ criteria }: { criteria?: string[] }) {
  if (!criteria || criteria.length === 0) return null;
  return (
    <ul className="ws-criteria">
      {criteria.map((text, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: criteria are plain strings; two may be equal
        <li key={i} className="ws-criterion">
          <span className="ws-criterion-box" aria-hidden />
          <span className="ws-criterion-text">{text || "\u00a0"}</span>
        </li>
      ))}
    </ul>
  );
}

const RAG_STEPS = ["Red", "Amber", "Green"] as const;

/**
 * The self-assessment strip (research/02 decision 15). The three circles are told apart by outline
 * weight and dash, never by colour: the print route is greyscale-safe, and a photocopy of a
 * colour-only scale says nothing.
 */
export function RagStrip() {
  return (
    <section className="ws-rag" aria-label="Self-assessment">
      <div className="ws-rag-prompt">How confident do you feel?</div>
      <div className="ws-rag-scale">
        {RAG_STEPS.map((step) => (
          <div key={step} className="ws-rag-step">
            <span className={`ws-rag-dot ws-rag-${step.toLowerCase()}`} aria-hidden />
            <span className="ws-rag-label">{step}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function AnswerKeyTitle({ worksheet }: { worksheet: Worksheet }) {
  return (
    <div>
      <h2 className="ws-key-title">Answer key</h2>
      <p className="ws-key-sub">{worksheet.header.title || worksheet.title}</p>
      <div className="ws-key-rule" />
    </div>
  );
}

export function AnswerKeyEntry({ entry, showMarks }: { entry: AnswerEntry; showMarks?: boolean }) {
  return (
    <div className="ws-key-entry">
      <div className="ws-q-no">{entry.number}.</div>
      <div className="ws-q-main">
        {entry.search ? <WordSearchView block={entry.search} solved /> : null}
        {entry.lines.map((line, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: answer lines are positional
          <div key={i} className="ws-key-line">
            {line}
          </div>
        ))}
      </div>
      {showMarks && entry.marks ? <div className="ws-marks">{marksLabel(entry.marks)}</div> : null}
    </div>
  );
}

/** One flow item, whatever its kind. */
export function FlowItemContent({
  item,
  worksheet,
  mode,
  renderStem,
}: {
  item:
    | { kind: "block"; block: WorksheetBlock }
    | { kind: "rag" }
    | { kind: "key-title" }
    | { kind: "key-entry"; entry: AnswerEntry };
  worksheet: Worksheet;
  mode: SheetMode;
  renderStem?: StemRenderer;
}) {
  if (item.kind === "block") {
    return (
      <BlockContent
        block={item.block}
        mode={mode}
        renderStem={renderStem}
        showMarks={worksheet.showMarks}
      />
    );
  }
  if (item.kind === "rag") return <RagStrip />;
  if (item.kind === "key-title") return <AnswerKeyTitle worksheet={worksheet} />;
  return <AnswerKeyEntry entry={item.entry} showMarks={worksheet.showMarks} />;
}

/**
 * "12 marks · about 25 min" under the objective (TEACH-183), or "about 25 min" alone when the
 * sheet does not count marks (UX ruling 60). Nothing on an empty sheet, where it would only be noise.
 */
export function SheetMeta({
  blocks,
  showMarks,
}: {
  blocks: readonly WorksheetBlock[];
  showMarks?: boolean;
}) {
  if (blocks.length === 0) return null;
  return <p className="ws-meta">{sheetSummary(blocks, showMarks ?? false)}</p>;
}
