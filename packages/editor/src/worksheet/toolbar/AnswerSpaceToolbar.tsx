import { Plus, X } from "lucide-react";
import { useBlockWrites } from "../worksheet-context";
import { BarButton, type BlockOf, ICON_SM, NumberField } from "./shared";

/*
 * The answer-space family (TeachDeck `BlockToolbar.tsx` answer-box / lines / word-bank sections):
 * the box height, the line count, add / remove a word. The words themselves are typed on the sheet.
 */

type AnswerBox = BlockOf<"answer-box">;
type Lines = BlockOf<"lines">;
type WordBank = BlockOf<"word-bank">;

const MAX_WORDS = 16;

export function AnswerSpaceToolbar({ block }: { block: AnswerBox | Lines | WordBank }) {
  const { commit } = useBlockWrites();
  switch (block.type) {
    case "answer-box":
      return (
        <NumberField<AnswerBox>
          id={block.id}
          label="Height"
          unit="pt"
          value={block.heightPt}
          min={40}
          max={600}
          step={10}
          onValue={(heightPt, b) => {
            b.heightPt = heightPt;
          }}
        />
      );
    case "lines":
      return (
        <NumberField<Lines>
          id={block.id}
          label="Lines"
          value={block.count}
          min={1}
          max={30}
          onValue={(count, b) => {
            b.count = count;
          }}
        />
      );
    case "word-bank":
      return (
        <>
          <BarButton
            disabled={block.words.length >= MAX_WORDS}
            onClick={() =>
              commit<WordBank>(block.id, (b) => {
                b.words.push("");
              })
            }
          >
            <Plus {...ICON_SM} aria-hidden />
            Word
          </BarButton>
          <BarButton
            disabled={block.words.length <= 1}
            aria-label="Remove last word"
            onClick={() =>
              commit<WordBank>(block.id, (b) => {
                b.words.pop();
              })
            }
          >
            <X {...ICON_SM} aria-hidden />
            Word
          </BarButton>
        </>
      );
  }
}
