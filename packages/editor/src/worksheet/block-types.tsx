import type { RichDoc, WorksheetBlock } from "@tj/domain/documents";
import {
  AlignJustify,
  ArrowLeftRight,
  CircleHelp,
  Grid3x3,
  Heading1,
  Heading2,
  Image as ImageIcon,
  Info,
  ListChecks,
  Minus,
  Pilcrow,
  Rows3,
  Scissors,
  SpellCheck,
  Square,
  Table as TableIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { newBlock, type WorksheetBlockType } from "../model/worksheet-factories";

/**
 * The insert catalogue (TeachDeck `components/worksheet/block-types.tsx`), grouped as research/06
 * §1 recommends: Text, Questions, Answer space, Layout. One entry per thing a teacher would say
 * out loud. The slash menu and the block toolbar (the worksheet editor) read it.
 */

export type BlockGroup = "Text" | "Questions" | "Answer space" | "Layout";

export type BlockSpec = {
  id: string;
  type: WorksheetBlockType;
  label: string;
  description: string;
  group: BlockGroup;
  icon: ReactNode;
  keywords?: string[];
  create: () => WorksheetBlock;
};

const size = { size: 16, strokeWidth: 1.5 } as const;

function heading(level: 1 | 2): WorksheetBlock {
  const block = newBlock("heading");
  if (block.type === "heading") block.level = level;
  return block;
}

export const BLOCK_SPECS: BlockSpec[] = [
  {
    id: "heading-1",
    type: "heading",
    label: "Heading",
    description: "A section title on the sheet",
    group: "Text",
    icon: <Heading1 {...size} />,
    keywords: ["title", "section"],
    create: () => heading(1),
  },
  {
    id: "heading-2",
    type: "heading",
    label: "Subheading",
    description: "A smaller heading inside a section",
    group: "Text",
    icon: <Heading2 {...size} />,
    keywords: ["title"],
    create: () => heading(2),
  },
  {
    id: "paragraph",
    type: "paragraph",
    label: "Paragraph",
    description: "Text for pupils to read",
    group: "Text",
    icon: <Pilcrow {...size} />,
    keywords: ["text", "body"],
    create: () => newBlock("paragraph"),
  },
  {
    id: "instructions",
    type: "instructions",
    label: "Instructions",
    description: "How to do the task, in one line",
    group: "Text",
    icon: <Info {...size} />,
    keywords: ["task", "rubric"],
    create: () => newBlock("instructions"),
  },
  {
    id: "question",
    type: "question",
    label: "Question",
    description: "Numbered, with marks and ruled lines",
    group: "Questions",
    icon: <CircleHelp {...size} />,
    keywords: ["short answer", "marks"],
    create: () => newBlock("question"),
  },
  {
    id: "multiple-choice",
    type: "multiple-choice",
    label: "Multiple choice",
    description: "Lettered options with a box to tick",
    group: "Questions",
    icon: <ListChecks {...size} />,
    keywords: ["mcq", "options", "abcd"],
    create: () => newBlock("multiple-choice"),
  },
  {
    id: "fill-gap",
    type: "fill-gap",
    label: "Fill the gap",
    description: "A sentence with blanks to complete",
    group: "Questions",
    icon: <SpellCheck {...size} />,
    keywords: ["cloze", "blank", "missing word"],
    create: () => newBlock("fill-gap"),
  },
  {
    id: "matching",
    type: "matching",
    label: "Matching",
    description: "Two columns to match up by letter",
    group: "Questions",
    icon: <ArrowLeftRight {...size} />,
    keywords: ["pairs", "link"],
    create: () => newBlock("matching"),
  },
  {
    id: "word-search",
    type: "word-search",
    label: "Word search",
    description: "A letter grid with the words to find",
    group: "Questions",
    icon: <Grid3x3 {...size} />,
    keywords: ["puzzle", "grid", "wordsearch", "find"],
    create: () => newBlock("word-search"),
  },
  {
    id: "word-bank",
    type: "word-bank",
    label: "Word bank",
    description: "A bordered box of words to choose from",
    group: "Questions",
    icon: <Rows3 {...size} />,
    keywords: ["vocabulary", "bank"],
    create: () => newBlock("word-bank"),
  },
  {
    id: "answer-box",
    type: "answer-box",
    label: "Answer box",
    description: "An empty box for working out",
    group: "Answer space",
    icon: <Square {...size} />,
    keywords: ["working", "space"],
    create: () => newBlock("answer-box"),
  },
  {
    id: "lines",
    type: "lines",
    label: "Lines",
    description: "Ruled lines to write on",
    group: "Answer space",
    icon: <AlignJustify {...size} />,
    keywords: ["ruled", "writing"],
    create: () => newBlock("lines"),
  },
  {
    id: "image",
    type: "image",
    label: "Image",
    description: "A picture with an optional caption",
    group: "Layout",
    icon: <ImageIcon {...size} />,
    keywords: ["picture", "diagram"],
    create: () => newBlock("image"),
  },
  {
    id: "table",
    type: "table",
    label: "Table",
    description: "Rows and columns to fill in",
    group: "Layout",
    icon: <TableIcon {...size} />,
    keywords: ["grid", "columns"],
    create: () => newBlock("table"),
  },
  {
    id: "divider",
    type: "divider",
    label: "Divider",
    description: "A hairline between sections",
    group: "Layout",
    icon: <Minus {...size} />,
    keywords: ["rule", "line"],
    create: () => newBlock("divider"),
  },
  {
    id: "page-break",
    type: "page-break",
    label: "Page break",
    description: "Start the next page here",
    group: "Layout",
    icon: <Scissors {...size} />,
    keywords: ["new page", "split"],
    create: () => newBlock("page-break"),
  },
];

export const BLOCK_GROUPS: BlockGroup[] = ["Text", "Questions", "Answer space", "Layout"];

/** Blocks whose text is edited with Tiptap. */
export const RICH_TYPES: WorksheetBlockType[] = [
  "heading",
  "paragraph",
  "instructions",
  "question",
  "multiple-choice",
  "fill-gap",
];

export const isRich = (block: WorksheetBlock) => RICH_TYPES.includes(block.type);

/** Types whose seeded prompt text should be cleared when a teacher inserts one. */
const BLANK_ON_INSERT: WorksheetBlockType[] = [
  "heading",
  "paragraph",
  "instructions",
  "question",
  "multiple-choice",
];

/**
 * A block inserted by hand starts empty, so the teacher types rather than deletes. The seeded
 * prompts stay where they belong: the starter worksheet. Fill-the-gap keeps its text, because the
 * gap tokens live inside it. A multiple choice block also starts with no option marked correct —
 * the factory ticks option A so the starter worksheet's demo key has an answer, but a hand-inserted
 * block has no answer yet and should not claim one.
 */
export function blankStem<T extends WorksheetBlock>(block: T): T {
  if (BLANK_ON_INSERT.includes(block.type)) {
    (block as { doc?: RichDoc }).doc = { type: "doc", content: [{ type: "paragraph" }] };
  }
  if (block.type === "multiple-choice") {
    for (const option of block.options) option.correct = false;
  }
  return block;
}

/** The spec a block was made from; every `WorksheetBlock["type"]` has one, headings two. */
export function specForBlock(block: WorksheetBlock): BlockSpec {
  const id =
    block.type === "heading" ? (block.level === 2 ? "heading-2" : "heading-1") : block.type;
  const spec = BLOCK_SPECS.find((s) => s.id === id);
  if (!spec) throw new Error(`No block spec for ${block.type}`);
  return spec;
}

/** Substring match on label, description and keywords (BlockNote's rule). */
export function filterSpecs(query: string): BlockSpec[] {
  const q = query.trim().toLowerCase();
  if (!q) return BLOCK_SPECS;
  return BLOCK_SPECS.filter((spec) =>
    [spec.label, spec.description, ...(spec.keywords ?? [])].some((text) =>
      text.toLowerCase().includes(q),
    ),
  );
}
