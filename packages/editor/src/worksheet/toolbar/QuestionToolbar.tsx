import { BLOCK_GUIDES } from "@tj/domain/documents";
import { Plus, X } from "lucide-react";
import { uid } from "../../model/factories";
import { answerLinesForMarks } from "../../model/worksheet-factories";
import { docToPlainText } from "../../text/static";
import { useBlockWrites, useWorksheetSession } from "../worksheet-context";
import { BarButton, type BlockOf, ICON_SM, LinesPopover, NumberField } from "./shared";

/*
 * The question family (TeachDeck `BlockToolbar.tsx` question / multiple-choice / fill-gap /
 * matching sections): marks and answer lines; add / remove options; the gap answers; add / remove
 * matching pairs.
 */

type Question = BlockOf<"question">;
type MC = BlockOf<"multiple-choice">;
type FillGap = BlockOf<"fill-gap">;
type Matching = BlockOf<"matching">;

/** Marks drive the default line count (AQA convention); the teacher can still set lines by hand. */
export function QuestionToolbar({ block }: { block: Question | MC | FillGap | Matching }) {
  switch (block.type) {
    case "question":
      return <QuestionFields block={block} />;
    case "multiple-choice":
      return <OptionFields block={block} />;
    case "fill-gap":
      return <GapFields block={block} />;
    case "matching":
      return <PairFields block={block} />;
  }
}

function QuestionFields({ block }: { block: Question }) {
  const { showAnswers } = useWorksheetSession();
  return (
    <>
      <NumberField<Question>
        id={block.id}
        label="Marks"
        value={block.marks ?? 0}
        min={0}
        max={20}
        onValue={(marks, b) => {
          // Lines follow marks unless the teacher has already pulled them away from the default.
          const followed = b.answerLines === answerLinesForMarks(b.marks);
          b.marks = marks || undefined;
          if (followed) b.answerLines = answerLinesForMarks(b.marks);
        }}
      />
      <NumberField<Question>
        id={block.id}
        label="Lines"
        value={block.answerLines}
        min={0}
        max={30}
        onValue={(answerLines, b) => {
          b.answerLines = answerLines;
        }}
      />
      <span className="pl-1 text-meta text-ink-3">
        {showAnswers
          ? "The model answer is under the question"
          : "Turn on Show answers to see and edit the model answer"}
      </span>
    </>
  );
}

// The guide's shape (TEACH-194): 2 to 4 options, 3 to 6 pairs.
const MAX_OPTIONS = BLOCK_GUIDES["multiple-choice"].shape.options?.[1] ?? 4;

function OptionFields({ block }: { block: MC }) {
  const { commit } = useBlockWrites();
  return (
    <>
      <BarButton
        disabled={block.options.length >= MAX_OPTIONS}
        onClick={() =>
          commit<MC>(block.id, (b) => {
            b.options.push({ id: uid(), text: "", correct: false });
          })
        }
      >
        <Plus {...ICON_SM} aria-hidden />
        Option
      </BarButton>
      <BarButton
        disabled={block.options.length <= 2}
        aria-label="Remove last option"
        onClick={() =>
          commit<MC>(block.id, (b) => {
            b.options.pop();
          })
        }
      >
        <X {...ICON_SM} aria-hidden />
        Option
      </BarButton>
      <span className="pl-1 text-meta text-ink-3">Click the marker beside the correct option</span>
    </>
  );
}

/**
 * The gap answers, one per line in the order the tokens appear in the text. A token with no line
 * keeps its old answer; extra lines are ignored — the text owns which gaps exist.
 */
function GapFields({ block }: { block: FillGap }) {
  const { commit } = useBlockWrites();
  const tokens = [...docToPlainText(block.doc).matchAll(/\[\[gap:([A-Za-z0-9_-]+)\]\]/g)].map(
    (m) => m[1] ?? "",
  );
  const ordered = tokens.map((id) => block.gaps.find((g) => g.id === id)?.answer ?? "");
  return (
    <>
      <LinesPopover
        label={`${block.gaps.length} ${block.gaps.length === 1 ? "gap" : "gaps"}`}
        title="Gap answers"
        hint="One answer per line, in the order the gaps appear. Add a gap by typing [[gap:new]] in the text."
        value={ordered.join("\n")}
        onCommit={(text) => {
          const lines = text.split("\n");
          commit<FillGap>(block.id, (b) => {
            b.gaps = tokens.map((id, i) => ({
              id,
              answer: (lines[i] ?? b.gaps.find((g) => g.id === id)?.answer ?? "").trim(),
            }));
          });
        }}
      />
      <BarButton
        onClick={() =>
          commit<FillGap>(block.id, (b) => {
            const id = uid().slice(0, 6);
            b.gaps.push({ id, answer: "" });
            const last = b.doc.content?.at(-1);
            if (last?.type === "paragraph") {
              last.content = [...(last.content ?? []), { type: "text", text: ` [[gap:${id}]]` }];
            }
          })
        }
      >
        <Plus {...ICON_SM} aria-hidden />
        Gap
      </BarButton>
    </>
  );
}

const MAX_PAIRS = BLOCK_GUIDES.matching.shape.pairs?.[1] ?? 6;

function PairFields({ block }: { block: Matching }) {
  const { commit } = useBlockWrites();
  return (
    <>
      <BarButton
        disabled={block.pairs.length >= MAX_PAIRS}
        onClick={() =>
          commit<Matching>(block.id, (b) => {
            b.pairs.push({ id: uid(), left: "", right: "" });
          })
        }
      >
        <Plus {...ICON_SM} aria-hidden />
        Pair
      </BarButton>
      <BarButton
        disabled={block.pairs.length <= 2}
        aria-label="Remove last pair"
        onClick={() =>
          commit<Matching>(block.id, (b) => {
            b.pairs.pop();
          })
        }
      >
        <X {...ICON_SM} aria-hidden />
        Pair
      </BarButton>
    </>
  );
}
