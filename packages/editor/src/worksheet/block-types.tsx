import type { Id, RichDoc, WorksheetBlock } from "@tj/domain/documents";
import {
  BLOCK_GUIDES,
  defaultInstruction,
  SORTING_TABLE_INSTRUCTION,
  TASK_BLOCK_TYPES,
} from "@tj/domain/documents";
import {
  AlignJustify,
  ArrowLeftRight,
  CircleHelp,
  Columns2,
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
  ToggleLeft,
} from "lucide-react";
import type { ReactNode } from "react";
import { docFromText, uid } from "../model/factories";
import { newBlock, type WorksheetBlockType } from "../model/worksheet-factories";

/**
 * The insert catalogue (TeachDeck `components/worksheet/block-types.tsx`), grouped as research/06
 * §1 recommends: Text, Questions, Answer space, Layout. One entry per thing a teacher would say
 * out loud. The slash menu and the block toolbar (the worksheet editor) read it. Labels, lines
 * and default instructions come from `BLOCK_GUIDES` (TEACH-194), so the Blocks tab, the slash
 * menu, the recipes and the generator's guide say the same thing; the entries that are a shape of
 * a type rather than the type itself (Subheading, True or false, Sorting table) carry their own.
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
  /**
   * The line an `instructions` block carries when one is inserted before this block
   * (`instructionBefore`), or `null` when the block prints its own lead or needs none.
   */
  instruction: string | null;
  create: () => WorksheetBlock;
};

const size = { size: 16, strokeWidth: 1.5 } as const;

/** Label, line and default instruction for a plain entry of `type`. */
const guided = (type: WorksheetBlockType) => ({
  type,
  label: BLOCK_GUIDES[type].label,
  description: BLOCK_GUIDES[type].line,
  instruction: defaultInstruction(type),
});

function heading(level: 1 | 2): WorksheetBlock {
  const block = newBlock("heading");
  if (block.type === "heading") block.level = level;
  return block;
}

/** A statement with True and False to tick; none correct until the teacher marks one. */
function trueFalse(): WorksheetBlock {
  const block = newBlock("multiple-choice");
  // No stem of its own: `blankStem` empties it on insert, as for any multiple choice block.
  if (block.type === "multiple-choice") {
    block.options = [
      { id: uid(), text: "True", correct: false },
      { id: uid(), text: "False", correct: false },
    ];
  }
  return block;
}

/** Two category columns and four blank rows; the items to sort go in the instruction. */
function sortingTable(): WorksheetBlock {
  const block = newBlock("table");
  if (block.type === "table") {
    block.rows = [
      ["Category one", "Category two"],
      ["", ""],
      ["", ""],
      ["", ""],
      ["", ""],
    ];
    block.header = true;
  }
  return block;
}

export const BLOCK_SPECS: BlockSpec[] = [
  {
    id: "heading-1",
    ...guided("heading"),
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
    instruction: null,
    group: "Text",
    icon: <Heading2 {...size} />,
    keywords: ["title"],
    create: () => heading(2),
  },
  {
    id: "paragraph",
    ...guided("paragraph"),
    group: "Text",
    icon: <Pilcrow {...size} />,
    keywords: ["text", "body"],
    create: () => newBlock("paragraph"),
  },
  {
    id: "instructions",
    ...guided("instructions"),
    group: "Text",
    icon: <Info {...size} />,
    keywords: ["task", "rubric"],
    create: () => newBlock("instructions"),
  },
  {
    id: "question",
    ...guided("question"),
    group: "Questions",
    icon: <CircleHelp {...size} />,
    keywords: ["short answer", "marks"],
    create: () => newBlock("question"),
  },
  {
    id: "multiple-choice",
    ...guided("multiple-choice"),
    group: "Questions",
    icon: <ListChecks {...size} />,
    keywords: ["mcq", "options", "abcd"],
    create: () => newBlock("multiple-choice"),
  },
  {
    id: "true-false",
    type: "multiple-choice",
    label: "True or false",
    description: "A statement with True and False to tick",
    instruction: BLOCK_GUIDES["multiple-choice"].instruction,
    group: "Questions",
    icon: <ToggleLeft {...size} />,
    keywords: ["claim", "statement", "tf"],
    create: trueFalse,
  },
  {
    id: "fill-gap",
    ...guided("fill-gap"),
    group: "Questions",
    icon: <SpellCheck {...size} />,
    keywords: ["cloze", "blank", "missing word"],
    create: () => newBlock("fill-gap"),
  },
  {
    id: "matching",
    ...guided("matching"),
    group: "Questions",
    icon: <ArrowLeftRight {...size} />,
    keywords: ["pairs", "link"],
    create: () => newBlock("matching"),
  },
  {
    id: "word-search",
    ...guided("word-search"),
    group: "Questions",
    icon: <Grid3x3 {...size} />,
    keywords: ["puzzle", "grid", "wordsearch", "find"],
    create: () => newBlock("word-search"),
  },
  {
    id: "word-bank",
    ...guided("word-bank"),
    group: "Questions",
    icon: <Rows3 {...size} />,
    keywords: ["vocabulary", "bank"],
    create: () => newBlock("word-bank"),
  },
  {
    id: "sorting-table",
    type: "table",
    label: "Sorting table",
    description: "Two columns with headings, items to sort",
    instruction: SORTING_TABLE_INSTRUCTION,
    group: "Questions",
    icon: <Columns2 {...size} />,
    keywords: ["sort", "categories", "columns", "classify"],
    create: sortingTable,
  },
  {
    id: "answer-box",
    ...guided("answer-box"),
    group: "Answer space",
    icon: <Square {...size} />,
    keywords: ["working", "space"],
    create: () => newBlock("answer-box"),
  },
  {
    id: "lines",
    ...guided("lines"),
    group: "Answer space",
    icon: <AlignJustify {...size} />,
    keywords: ["ruled", "writing"],
    create: () => newBlock("lines"),
  },
  {
    id: "image",
    ...guided("image"),
    group: "Layout",
    icon: <ImageIcon {...size} />,
    keywords: ["picture", "diagram"],
    create: () => newBlock("image"),
  },
  {
    id: "table",
    ...guided("table"),
    // A plain table may be reference (all cells filled), so no line is inserted before it; the
    // guide's "Complete the table." is for the generator. Sorting table carries its own.
    instruction: null,
    group: "Layout",
    icon: <TableIcon {...size} />,
    keywords: ["grid", "columns"],
    create: () => newBlock("table"),
  },
  {
    id: "divider",
    ...guided("divider"),
    group: "Layout",
    icon: <Minus {...size} />,
    keywords: ["rule", "line"],
    create: () => newBlock("divider"),
  },
  {
    id: "page-break",
    ...guided("page-break"),
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

/** A multiple choice block whose only options are True and False, in that order. */
export const isTrueFalse = (block: WorksheetBlock): boolean =>
  block.type === "multiple-choice" &&
  block.options.length === 2 &&
  block.options[0]?.text.trim() === "True" &&
  block.options[1]?.text.trim() === "False";

/**
 * The spec a block was made from; every `WorksheetBlock["type"]` has one, headings two and a
 * multiple choice block with the options True and False the "True or false" entry.
 */
export function specForBlock(block: WorksheetBlock): BlockSpec {
  const id =
    block.type === "heading"
      ? block.level === 2
        ? "heading-2"
        : "heading-1"
      : isTrueFalse(block)
        ? "true-false"
        : block.type;
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

/**
 * The `instructions` block to put before `spec`'s block when it lands after `afterId` (`null`
 * appends), or `null` when the spec needs none or an instructions block already stands since the
 * last heading (ruling 61: a task block never prints without an instruction). A word bank inserted
 * directly above a fill-gap block needs none either: the fill-gap line covers it.
 */
/** A block a pupil acts on, by the guides' list; a table is not (it may be reference). */
const isTaskBlock = (block: WorksheetBlock): boolean => TASK_BLOCK_TYPES.includes(block.type);

/** Word bank and fill-gap share one instruction line, so they count as one kind of task. */
const taskKind = (type: WorksheetBlock["type"]): WorksheetBlock["type"] =>
  type === "word-bank" ? "fill-gap" : type;

export function instructionBefore(
  spec: BlockSpec,
  blocks: WorksheetBlock[],
  afterId: Id | null,
): WorksheetBlock | null {
  if (!spec.instruction) return null;
  const at = afterId ? blocks.findIndex((b) => b.id === afterId) : -1;
  // The index the new block takes; everything before it is what the pupil has read so far.
  const insertAt = at === -1 ? blocks.length : at + 1;
  for (let i = insertAt - 1; i >= 0; i--) {
    const block = blocks[i];
    if (!block || block.type === "heading") break;
    if (block.type === "instructions") return null;
    // A task block of another kind between the line and the insert point: that line was written
    // for it, not for the new block, so the new block brings its own. The same kind (a second
    // matching block, a fill-gap under its word bank) is still covered by the standing line.
    if (isTaskBlock(block) && taskKind(block.type) !== taskKind(spec.type)) break;
  }
  if (spec.type === "word-bank" && blocks[insertAt]?.type === "fill-gap") return null;
  return { id: uid(), type: "instructions", doc: docFromText(spec.instruction) };
}
