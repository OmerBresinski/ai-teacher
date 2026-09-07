import { WORD_SEARCH_MAX_SIZE, WORD_SEARCH_MIN_SIZE } from "@tj/domain/documents";
import { Label, Switch } from "@tj/ui";
import { Shuffle } from "lucide-react";
import { useId } from "react";
import { Segmented } from "../../kit/Segmented";
import { textToWords, wordsToText } from "../word-search";
import { useBlockWrites } from "../worksheet-context";
import { BarButton, type BlockOf, ICON_SM, LinesPopover, NumberField } from "./shared";

/*
 * The word-search controls (TeachDeck `BlockToolbar.tsx` word-search section): the word list in a
 * popover, the grid size, the directions, the word bank toggle and Shuffle. Every change writes the
 * block, and `WordSearchView` rebuilds the grid from `{ words, size, directions, seed }` — the grid
 * is derived, never stored, so it is always deterministic for the block as saved.
 */

type WordSearch = BlockOf<"word-search">;

const DIRECTIONS = [
  { value: "across-down", label: "Across & down" },
  { value: "all", label: "All directions" },
] as const;

export function WordSearchToolbar({ block }: { block: WordSearch }) {
  const { commit } = useBlockWrites();
  const bankId = useId();
  const count = block.words.filter((w) => w.trim()).length;
  return (
    <>
      <LinesPopover
        label={`${count} ${count === 1 ? "word" : "words"}`}
        title="Words to hide"
        hint="Separate with commas or new lines. Letters only; accents are dropped."
        value={wordsToText(block.words)}
        onCommit={(text) =>
          commit<WordSearch>(block.id, (b) => {
            b.words = textToWords(text);
          })
        }
      />
      <NumberField<WordSearch>
        id={block.id}
        label="Size"
        value={block.size}
        min={WORD_SEARCH_MIN_SIZE}
        max={WORD_SEARCH_MAX_SIZE}
        onValue={(size, b) => {
          b.size = size;
        }}
      />
      <Segmented
        aria-label="Directions"
        value={block.directions}
        options={DIRECTIONS.map((d) => ({ value: d.value, label: d.label }))}
        onChange={(directions) =>
          commit<WordSearch>(block.id, (b) => {
            b.directions = directions;
          })
        }
      />
      <span className="inline-flex items-center gap-1.5 pl-1">
        <Switch
          id={bankId}
          checked={block.showWordBank}
          onCheckedChange={(showWordBank) =>
            commit<WordSearch>(block.id, (b) => {
              b.showWordBank = showWordBank;
            })
          }
        />
        <Label htmlFor={bankId} className="text-body">
          Word bank
        </Label>
      </span>
      <BarButton
        onClick={() =>
          commit<WordSearch>(block.id, (b) => {
            b.seed = (b.seed + 1) % 1_000_000;
          })
        }
      >
        <Shuffle {...ICON_SM} aria-hidden />
        Shuffle
      </BarButton>
    </>
  );
}
