import type { WorksheetBlock } from "@tj/domain/documents";
import { pageMetrics } from "./metrics";
import { buildWordSearch, type WordSearchPlacement, wordSearchLead } from "./word-search";

/**
 * The word search grid, on the sheet and on the answer key (TeachDeck
 * `components/worksheet/WordSearch.tsx`).
 *
 * The grid is built from the block every time it renders. That is cheap and it is the reason the
 * editor, the measuring column and the print route always show the same letters: there is one
 * deterministic generator and no cached copy to fall out of step.
 */

type WordSearchBlock = Extract<WorksheetBlock, { type: "word-search" }>;

/** Cell side in points. 26pt is 9mm — a letter a child can ring with a pen. */
const CELL = 26;

/**
 * The block sits in the numbered-question row, so the grid gets the text column less the number's
 * lane: `.ws-q` is a 8pt flex gap after a 20pt `.ws-q-no`. Sized against A4, which is the narrower
 * of the two papers, so a grid built on one page size still sits inside the column on the other.
 */
const QUESTION_GUTTER = 28;
const GRID_MAX_W = pageMetrics("A4").contentW - QUESTION_GUTTER;

/**
 * The ring drawn round a found word on the answer key. It is an outline, never a fill or a colour,
 * so a photocopy still shows the answer.
 */
function Ring({
  placement,
  cell,
  view,
}: {
  placement: WordSearchPlacement;
  cell: number;
  /** The editor's answers view draws the ring in accent; the printed key keeps ink. */
  view?: boolean;
}) {
  const length = placement.word.length;
  const startX = (placement.col + 0.5) * cell;
  const startY = (placement.row + 0.5) * cell;
  const endX = (placement.col + placement.dCol * (length - 1) + 0.5) * cell;
  const endY = (placement.row + placement.dRow * (length - 1) + 0.5) * cell;
  const dx = endX - startX;
  const dy = endY - startY;
  const span = Math.hypot(dx, dy) + cell;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  return (
    <span
      className={view ? "ws-search-ring ws-search-ring-view" : "ws-search-ring"}
      aria-hidden
      style={{
        left: `${(startX + endX) / 2}pt`,
        top: `${(startY + endY) / 2}pt`,
        width: `${span}pt`,
        height: `${cell}pt`,
        borderRadius: `${cell / 2}pt`,
        transform: `translate(-50%, -50%) rotate(${angle}deg)`,
      }}
    />
  );
}

export function WordSearchView({
  block,
  solved = false,
  rings = solved,
}: {
  block: WordSearchBlock;
  /** The answer key rings every word it placed. */
  solved?: boolean;
  /**
   * Ring the words without dropping the lead: the editor's "Show answers" view (TEACH-195). The
   * rings are out of flow, so the block keeps the height the paginator measured.
   */
  rings?: boolean;
}) {
  const { grid, error } = buildWordSearch(block);

  if (!grid) {
    return <p className="ws-search-note">{error}</p>;
  }

  // The word bank is the list of words that are actually in the grid. A word the generator could
  // not place is not on the paper, so printing it would send a class hunting for something that is
  // not there.
  const words = grid.placements.map((placement) => placement.word);
  const cell = Math.min(CELL, GRID_MAX_W / grid.size);
  const side = cell * grid.size;

  return (
    <div className="ws-search">
      {/* The task, in the pupil's words. The answer key does not repeat it. */}
      {solved ? null : (
        <p className="ws-search-lead">
          {wordSearchLead(block.directions, words.length, block.showWordBank)}
        </p>
      )}
      {/* The letters are a picture of a puzzle: read one cell at a time they say nothing, and a
          screen reader would spell out two hundred of them. The word bank below is the text
          alternative. */}
      <div
        className="ws-search-frame"
        style={{ width: `${side}pt`, height: `${side}pt` }}
        aria-hidden
      >
        <table className="ws-search-grid" style={{ fontSize: `${cell * 0.5}pt` }}>
          <tbody>
            {grid.rows.map((row, r) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: grid cells have no identity beyond their position
              <tr key={r}>
                {row.map((letter, c) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: grid cells have no identity beyond their position
                  <td key={c} style={{ width: `${cell}pt`, height: `${cell}pt` }}>
                    {letter}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rings
          ? grid.placements.map((p) => (
              <Ring key={p.word} placement={p} cell={cell} view={!solved} />
            ))
          : null}
      </div>

      {block.showWordBank && words.length > 0 ? (
        <ul className="ws-search-words">
          {words.map((word) => (
            <li key={word}>{word}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
